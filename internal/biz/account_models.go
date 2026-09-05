package biz

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"cpa-console/internal/cpa"
	"cpa-console/internal/store"
)

// ModelAliasRow 某账号下单个已加入模型的名称与 alias 映射信息。
type ModelAliasRow struct {
	Name           string `json:"name"`
	Alias          string `json:"alias"`
	SuggestedAlias string `json:"suggestedAlias"`
	Excluded       bool   `json:"excluded"`
}

// AccountModelsDetail 某账号在 CPA 中已加入的全部模型及其 alias 映射。
type AccountModelsDetail struct {
	Account       Account         `json:"account"`
	SupportsAlias bool            `json:"supportsAlias"`
	Models        []ModelAliasRow `json:"models"`
}

// GetAccountModelsDetail 返回指定账号当前在 CPA 中已加入的模型与 alias：
// - openai-compatibility：条目 models 清单即路由清单（alias 的唯一生效位置）；
// - 其余 Key 型：channel 静态目录 + 条目 excluded-models 屏蔽标记；
// - OAuth 凭据：凭据可用模型清单。
func (b *Biz) GetAccountModelsDetail(ctx context.Context, key string) (*AccountModelsDetail, error) {
	c, err := b.Client()
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(key, "auth:") {
		files, err := c.GetAuthFiles(ctx)
		if err != nil {
			return nil, err
		}
		for _, f := range files {
			a := oauthAccountFrom(f)
			if a.Key != key {
				continue
			}
			names, err := c.GetAuthFileModels(ctx, a.AuthFile)
			if err != nil {
				return nil, err
			}
			detail := &AccountModelsDetail{Account: a, Models: make([]ModelAliasRow, 0, len(names))}
			for _, n := range names {
				detail.Models = append(detail.Models, ModelAliasRow{Name: n, SuggestedAlias: SuggestAlias(n)})
			}
			return detail, nil
		}
		return nil, fmt.Errorf("凭据不存在")
	}
	typ, _, err := splitKey(key)
	if err != nil {
		return nil, err
	}
	def, ok := defByType(typ)
	if !ok {
		return nil, fmt.Errorf("不支持的账号类型: %s", typ)
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return nil, err
	}
	displayNames, _ := b.Store.AccountDisplayNames()
	for _, entry := range items {
		acct := keyAccountFrom(def, entry)
		if acct.Key != key {
			continue
		}
		if dn := displayNames[acct.Key]; dn != "" {
			acct.Name = dn
		}
		return accountModelsDetailFromEntry(ctx, c, def, entry, acct)
	}
	return nil, fmt.Errorf("账号不存在")
}

// SetAccountModelAlias 修改 OpenAI 兼容账号下某模型的 alias（空串表示清除映射）：
// 定位 CPA 条目后修改 models 数组并全量 PUT 写回，再同步本地快照与变更记录，
// 使收敛还原与页面展示使用同一份自定义值。
func (b *Biz) SetAccountModelAlias(ctx context.Context, accountKey, model, alias string) error {
	typ, _, err := splitKey(accountKey)
	if err != nil {
		return err
	}
	def, ok := defByType(typ)
	if !ok {
		return fmt.Errorf("不支持的账号类型: %s", typ)
	}
	if def.Type != "openai-compatibility" {
		return fmt.Errorf("该账号类型不涉及 alias 映射")
	}
	alias = strings.TrimSpace(alias)
	c, err := b.Client()
	if err != nil {
		return err
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return err
	}
	entry := -1
	for i, it := range items {
		if keyAccountFrom(def, it).Key == accountKey {
			entry = i
			break
		}
	}
	if entry < 0 {
		return fmt.Errorf("账号不存在或标识已变更，请刷新后重试")
	}
	arr, _ := items[entry]["models"].([]any)
	found := false
	for _, it := range arr {
		m, isObj := it.(map[string]any)
		if !isObj {
			continue
		}
		if name, _ := cpa.GetStr(m, "name", "id"); name == model {
			if alias == "" {
				delete(m, "alias")
			} else {
				m["alias"] = alias
			}
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("该模型不在账号的模型清单中，请刷新后重试")
	}
	if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
		return err
	}
	// 同步本地快照，避免后续收敛还原模型时用旧映射覆盖自定义值。
	if err := b.Store.UpdateModelAlias(accountKey, model, alias); err != nil {
		slog.Warn("更新本地别名快照失败", "account", accountKey, "model", model, "err", err)
	}
	acct := keyAccountFrom(def, items[entry])
	displayNames, _ := b.Store.AccountDisplayNames()
	if dn := displayNames[acct.Key]; dn != "" {
		acct.Name = dn
	}
	if err := b.Store.InsertChangeRecords([]store.ChangeRecord{{
		AccountKey: acct.Key, AccountType: acct.Type, AccountName: acct.Name,
		Model: model, Action: "alias",
	}}); err != nil {
		slog.Warn("写入别名变更记录失败", "err", err)
	}
	return nil
}

// accountModelsDetailFromEntry 从单个 CPA 条目构建模型与 alias 明细。
func accountModelsDetailFromEntry(ctx context.Context, c *cpa.Client, def collectionDef, entry map[string]any, acct Account) (*AccountModelsDetail, error) {
	detail := &AccountModelsDetail{Account: acct, SupportsAlias: def.Type == "openai-compatibility"}
	if def.Type == "openai-compatibility" {
		arr, _ := entry["models"].([]any)
		detail.Models = make([]ModelAliasRow, 0, len(arr))
		for _, it := range arr {
			switch m := it.(type) {
			case map[string]any:
				name, _ := cpa.GetStr(m, "name", "id")
				if name == "" {
					continue
				}
				detail.Models = append(detail.Models, ModelAliasRow{
					Name:           name,
					Alias:          aliasOf(m),
					SuggestedAlias: SuggestAlias(name),
				})
			case string:
				if m = strings.TrimSpace(m); m != "" {
					detail.Models = append(detail.Models, ModelAliasRow{Name: m, SuggestedAlias: SuggestAlias(m)})
				}
			}
		}
		return detail, nil
	}
	if def.Channel == "" {
		return detail, nil
	}
	// 非 openai-compatibility：模型来自 channel 静态目录，alias 概念不适用；
	// 屏蔽状态取条目 excluded-models。
	excluded := map[string]bool{}
	for _, m := range cpa.StrSlice(entry["excluded-models"]) {
		excluded[m] = true
	}
	names, err := c.GetModelDefinitions(ctx, def.Channel)
	if err != nil {
		return nil, err
	}
	detail.Models = make([]ModelAliasRow, 0, len(names))
	for _, n := range names {
		detail.Models = append(detail.Models, ModelAliasRow{Name: n, Excluded: excluded[n]})
	}
	return detail, nil
}
