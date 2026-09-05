package biz

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"cpa-console/internal/cpa"
	"cpa-console/internal/store"
)

// LibraryRow 模型库：某账号当前已加入 CPA 路由的一个模型。
type LibraryRow struct {
	Model       string `json:"model"`
	Alias       string `json:"alias,omitempty"`
	AccountKey  string `json:"accountKey"`
	AccountName string `json:"accountName"`
	AccountType string `json:"accountType"`
}

// Library 聚合全部账号当前已加入 CPA 的模型（前端按模型分组统计提供方）：
// - openai-compatibility：条目 models 清单即路由清单（含 alias）；
// - 其余 Key 型：channel 静态目录减去条目 excluded-models；
// - OAuth 凭据：凭据可用模型清单。
func (b *Biz) Library(ctx context.Context) ([]LibraryRow, error) {
	c, err := b.Client()
	if err != nil {
		return nil, err
	}
	snap, err := b.discover(ctx, c, true, nil)
	if err != nil {
		return nil, err
	}
	out := make([]LibraryRow, 0, len(snap.Models))
	displayNames, _ := b.Store.AccountDisplayNames()
	for _, def := range keyCollections {
		for _, entry := range snap.keyItems[def.Collection] {
			acct := keyAccountFrom(def, entry)
			if dn := displayNames[acct.Key]; dn != "" {
				acct.Name = dn
			}
			if def.Type == "openai-compatibility" {
				arr, _ := entry["models"].([]any)
				for _, it := range arr {
					m, ok := it.(map[string]any)
					if !ok {
						continue
					}
					name, _ := cpa.GetStr(m, "name", "id")
					if name == "" {
						continue
					}
					alias, _ := cpa.GetStr(m, "alias")
					out = append(out, LibraryRow{
						Model: name, Alias: alias,
						AccountKey: acct.Key, AccountName: acct.Name, AccountType: acct.Type,
					})
				}
				continue
			}
			excluded := map[string]bool{}
			for _, m := range cpa.StrSlice(entry["excluded-models"]) {
				excluded[m] = true
			}
			for _, m := range keyEntryModels(ctx, c, def, entry) {
				if excluded[m.name] {
					continue
				}
				out = append(out, LibraryRow{
					Model: m.name, Alias: m.alias,
					AccountKey: acct.Key, AccountName: acct.Name, AccountType: acct.Type,
				})
			}
		}
	}
	files, err := c.GetAuthFiles(ctx)
	if err != nil {
		snap.addErr("读取 OAuth 凭据失败: %v", err)
	} else {
		for _, f := range files {
			a := oauthAccountFrom(f)
			if a.AuthFile == "" {
				continue
			}
			names, err := c.GetAuthFileModels(ctx, a.AuthFile)
			if err != nil {
				snap.addErr("读取 %s 模型失败: %v", a.Name, err)
				continue
			}
			for _, n := range names {
				out = append(out, LibraryRow{
					Model: n,
					AccountKey: a.Key, AccountName: a.Name, AccountType: a.Type,
				})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Model != out[j].Model {
			return out[i].Model < out[j].Model
		}
		return out[i].AccountName < out[j].AccountName
	})
	return out, nil
}

// RemoveAccountModel 从指定账号移除一个已加入的模型：
// - openai-compatibility：从条目 models 清单真正删除，并清除本地审批状态（避免收敛时被还原）；
// - 其余 Key 型 / OAuth：模型来自上游目录无法删除，标记为 rejected 由收敛写入屏蔽清单。
// 返回移除方式："deleted"（真删除）或 "excluded"（屏蔽）。
func (b *Biz) RemoveAccountModel(ctx context.Context, accountKey, model string) (string, error) {
	if strings.HasPrefix(accountKey, "auth:") {
		if err := b.rejectModel(accountKey, model); err != nil {
			return "", err
		}
		go b.enforceAfterReview()
		return "excluded", nil
	}
	typ, _, err := splitKey(accountKey)
	if err != nil {
		return "", err
	}
	def, ok := defByType(typ)
	if !ok {
		return "", fmt.Errorf("不支持的账号类型: %s", typ)
	}
	c, err := b.Client()
	if err != nil {
		return "", err
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return "", err
	}
	entry := -1
	for i, it := range items {
		if keyAccountFrom(def, it).Key == accountKey {
			entry = i
			break
		}
	}
	if entry < 0 {
		return "", fmt.Errorf("账号不存在或标识已变更，请刷新后重试")
	}
	if def.Type == "openai-compatibility" {
		arr, _ := items[entry]["models"].([]any)
		kept := make([]any, 0, len(arr))
		removed := false
		for _, it := range arr {
			name := ""
			if m, ok := it.(map[string]any); ok {
				name, _ = cpa.GetStr(m, "name", "id")
			} else if s, ok := it.(string); ok {
				name = s
			}
			if name == model && !removed {
				removed = true
				continue
			}
			kept = append(kept, it)
		}
		if !removed {
			return "", fmt.Errorf("该模型不在账号的模型清单中")
		}
		items[entry]["models"] = kept
		if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
			return "", err
		}
		// 清除本地审批状态，否则收敛会按已放行记录把模型还原回清单。
		if removedRows, err := b.Store.DeleteStatusModels(accountKey, []string{model}); err == nil {
			_ = b.recordRemoved(removedRows)
		}
		return "deleted", nil
	}
	// 非 openai-compatibility：无法删除目录模型，标记 rejected 让收敛写入屏蔽清单。
	if err := b.rejectModel(accountKey, model); err != nil {
		return "", err
	}
	go b.enforceAfterReview()
	return "excluded", nil
}

// rejectModel 将账号下某模型置为 rejected 并记录变更（用于"从账号移除"的屏蔽路径）。
func (b *Biz) rejectModel(accountKey, model string) error {
	changed, err := b.Store.SetStatus([]store.ModelRef{{AccountKey: accountKey, Model: model}}, StatusRejected)
	if err != nil {
		return err
	}
	if len(changed) == 0 {
		return fmt.Errorf("本地没有该模型的审批记录，请先同步")
	}
	recs := make([]store.ChangeRecord, 0, len(changed))
	for _, r := range changed {
		recs = append(recs, store.ChangeRecord{
			AccountKey: r.AccountKey, AccountType: r.AccountType, AccountName: r.AccountName,
			Model: r.Model, Action: "rejected",
		})
	}
	if err := b.Store.InsertChangeRecords(recs); err != nil {
		slog.Warn("写入拒绝记录失败", "err", err)
	}
	return nil
}
