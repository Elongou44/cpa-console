package biz

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"cpa-console/internal/cpa"
	"cpa-console/internal/store"
)

// SyncResult 一次同步的结果摘要。
type SyncResult struct {
	Accounts   int      `json:"accounts"`
	Models     int      `json:"models"`
	NewPending int      `json:"newPending"`
	Enforced   int      `json:"enforced"`
	Removed    int      `json:"removed"`
	Errors     []string `json:"errors,omitempty"`
}

// Sync 执行一次完整同步：发现账号与模型 → diff 待审批 → 强管控收敛。
// auto 表示由后台周期同步触发：关闭自动同步的账号不参与 diff 与收敛
// （可用性快照仍刷新供展示）；手动触发（立即同步、账号保存后）传 false，处理全部账号。
func (b *Biz) Sync(ctx context.Context, auto bool) (*SyncResult, error) {
	b.mu.Lock()
	if b.syncing {
		b.mu.Unlock()
		return nil, fmt.Errorf("同步正在进行中，请稍候")
	}
	b.syncing = true
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		b.syncing = false
		b.mu.Unlock()
	}()

	c, err := b.Client()
	if err != nil {
		return nil, err
	}

	res := &SyncResult{}
	snap, err := b.discover(ctx, c, true)
	if err != nil {
		return nil, err
	}
	res.Errors = snap.Errors
	res.Accounts = len(snap.Accounts)
	res.Models = len(snap.Models)

	var disabled map[string]bool
	if auto {
		disabled, err = b.Store.AutoSyncDisabledAccounts()
		if err != nil {
			return nil, err
		}
	}

	// 1) 重建可用模型快照。
	if err := b.Store.ReplaceAccountModels(snap.Models); err != nil {
		return nil, err
	}

	// 2) 清理已消失账号的审批状态并记录 removed。
	current := map[string]bool{}
	for _, a := range snap.Accounts {
		current[a.Key] = true
	}
	if known, err := b.knownAccountKeys(); err == nil {
		var missing []string
		for _, k := range known {
			if !current[k] {
				missing = append(missing, k)
			}
		}
		if len(missing) > 0 {
			if removed, err := b.Store.DeleteByAccounts(missing); err == nil && len(removed) > 0 {
				res.Removed = len(removed)
				_ = b.recordRemoved(removed)
			}
		}
	}

	// 3) diff 新模型：openai-compatibility 中 CPA 已显式配置的模型自动放行，其余进入待审批。
	// 自动同步已关闭的账号不参与 diff（不产生新的待审批记录）。
	compatAccounts := map[string]bool{}
	for _, a := range snap.Accounts {
		if a.Kind == "key" && a.Type == "openai-compatibility" {
			compatAccounts[a.Key] = true
		}
	}
	models := snap.Models
	if len(disabled) > 0 {
		models = make([]store.AccountModel, 0, len(snap.Models))
		for _, m := range snap.Models {
			if !disabled[m.AccountKey] {
				models = append(models, m)
			}
		}
	}
	inserted, err := b.Store.InsertPending(models, func(accountKey string) string {
		if compatAccounts[accountKey] {
			return StatusApproved
		}
		return StatusPending
	})
	if err != nil {
		return nil, err
	}
	for _, ins := range inserted {
		if ins.Status == StatusPending {
			res.NewPending++
		}
	}
	if len(inserted) > 0 {
		recs := make([]store.ChangeRecord, 0, len(inserted))
		for _, ins := range inserted {
			action := "discovered"
			if ins.Status == StatusApproved {
				action = "approved"
			}
			recs = append(recs, store.ChangeRecord{
				AccountKey: ins.Row.AccountKey, AccountType: ins.Row.AccountType, AccountName: ins.Row.AccountName,
				Model: ins.Row.Model, Action: action,
			})
		}
		if err := b.Store.InsertChangeRecords(recs); err != nil {
			slog.Warn("写入发现记录失败", "err", err)
		}
	}

	// 4) 强管控收敛：未放行模型写入 CPA 屏蔽清单。
	enforced, errs := b.enforce(ctx, c, snap, nil, disabled)
	res.Enforced = enforced
	res.Errors = append(res.Errors, errs...)

	b.mu.Lock()
	b.lastSyncAt = time.Now()
	b.lastSyncErr = strings.Join(res.Errors, "; ")
	b.mu.Unlock()
	slog.Info("同步完成", "accounts", res.Accounts, "models", res.Models,
		"newPending", res.NewPending, "enforced", res.Enforced, "removed", res.Removed)
	return res, nil
}

// knownAccountKeys 返回本地已有审批状态的账号标识。
func (b *Biz) knownAccountKeys() ([]string, error) {
	rows, err := b.Store.AllStatuses()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []string
	for _, r := range rows {
		if !seen[r.AccountKey] {
			seen[r.AccountKey] = true
			out = append(out, r.AccountKey)
		}
	}
	return out, nil
}

func (b *Biz) recordRemoved(removed []store.ModelStatus) error {
	recs := make([]store.ChangeRecord, 0, len(removed))
	for _, r := range removed {
		recs = append(recs, store.ChangeRecord{
			AccountKey: r.AccountKey, AccountType: r.AccountType, AccountName: r.AccountName,
			Model: r.Model, Action: "removed",
		})
	}
	return b.Store.InsertChangeRecords(recs)
}

// enforce 将未放行模型写入 CPA 屏蔽配置：
// Key 型改条目 excluded-models（整体 PUT 合并提交）；OAuth 型按 provider 聚合写 oauth-excluded-models。
// statuses 传入时使用内存数据（避免重复查询），否则从本地库加载。
// skip 中的账号不参与收敛（自动同步已关闭的账号）；手动触发的全量收敛传 nil。
func (b *Biz) enforce(ctx context.Context, c *cpa.Client, snap *snapshot, statuses []store.ModelStatus, skip map[string]bool) (int, []string) {
	if statuses == nil {
		rows, err := b.Store.AllStatuses()
		if err != nil {
			return 0, []string{err.Error()}
		}
		statuses = rows
	}
	byAccount := map[string]map[string]string{}
	for _, r := range statuses {
		m, ok := byAccount[r.AccountKey]
		if !ok {
			m = map[string]string{}
			byAccount[r.AccountKey] = m
		}
		m[r.Model] = r.Status
	}
	blockedOf := func(accountKey string) []string {
		var out []string
		for m, st := range byAccount[accountKey] {
			if st == StatusPending || st == StatusRejected {
				out = append(out, m)
			}
		}
		sort.Strings(out)
		return out
	}

	var errs []string
	writes := 0

	// Key 型账号：openai-compatibility 重写 models 清单（未放行的移除、放行的还原）；
	// 其余类型写条目 excluded-models 字段（PUT 整体替换，先在内存中改好再统一提交）。
	for _, def := range keyCollections {
		items := snap.keyItems[def.Collection]
		if items == nil {
			continue
		}
		if def.Type == "openai-compatibility" {
			changed := false
			for i, entry := range items {
				acct := keyAccountFrom(def, entry)
				if skip[acct.Key] {
					continue
				}
				updated, err := b.enforceCompatEntry(byAccount, acct, entry)
				if err != nil {
					errs = append(errs, fmt.Sprintf("收敛 %s 模型清单失败: %v", acct.Name, err))
					continue
				}
				if updated != nil {
					items[i] = updated
					changed = true
				}
			}
			if changed {
				if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
					errs = append(errs, fmt.Sprintf("写入 %s 模型清单失败: %v", def.Type, err))
				} else {
					writes++
				}
			}
			continue
		}
		changed := false
		for i, entry := range items {
			acct := keyAccountFrom(def, entry)
			if skip[acct.Key] {
				continue
			}
			blocked := blockedOf(acct.Key)
			cur := cpa.StrSlice(entry["excluded-models"])
			sort.Strings(cur)
			if !cpa.EqualSet(cur, blocked) {
				entry["excluded-models"] = cpa.ToAnySlice(blocked)
				items[i] = entry
				changed = true
			}
		}
		if changed {
			if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
				errs = append(errs, fmt.Sprintf("写入 %s 屏蔽清单失败: %v", def.Type, err))
			} else {
				writes++
			}
		}
	}

	// OAuth 型账号：按 provider 聚合。模型只要有任一账号已放行即不屏蔽（避免跨凭据误伤）。
	// 自动同步已关闭的凭据不参与聚合与屏蔽。
	providerModels := map[string]map[string]bool{}
	for _, a := range snap.Accounts {
		if a.Kind != "oauth" || a.Provider == "" || a.Provider == "oauth" || skip[a.Key] {
			continue
		}
		if providerModels[a.Provider] == nil {
			providerModels[a.Provider] = map[string]bool{}
		}
		for m, st := range byAccount[a.Key] {
			if st == StatusApproved {
				providerModels[a.Provider][m] = true
			}
		}
	}
	for prov, approved := range providerModels {
		var blocked []string
		for _, a := range snap.Accounts {
			if a.Kind != "oauth" || a.Provider != prov || skip[a.Key] {
				continue
			}
			for m, st := range byAccount[a.Key] {
				if (st == StatusPending || st == StatusRejected) && !approved[m] {
					blocked = append(blocked, m)
				}
			}
		}
		sort.Strings(blocked)
		blocked = dedupe(blocked)
		if err := c.PatchOauthExcludedModels(ctx, prov, blocked); err != nil {
			errs = append(errs, fmt.Sprintf("同步 %s OAuth 屏蔽清单失败: %v", prov, err))
		} else {
			writes++
		}
	}
	return writes, errs
}

// enforceCompatEntry 将 openai-compatibility 条目的 models 收敛为"仅含已放行模型"：
// pending/rejected/未知状态的模型从清单移除；已放行但被移除的按 payload 完整还原写入。
// 返回 nil 表示条目无需变更。
func (b *Biz) enforceCompatEntry(byAccount map[string]map[string]string, acct Account, entry map[string]any) (map[string]any, error) {
	arr, _ := entry["models"].([]any)
	kept := make([]any, 0, len(arr))
	seen := map[string]bool{}
	changed := false
	for _, it := range arr {
		name := ""
		if m, ok := it.(map[string]any); ok {
			name, _ = cpa.GetStr(m, "name", "id")
		} else if s, ok := it.(string); ok {
			name = s
		}
		if byAccount[acct.Key][name] == StatusApproved {
			kept = append(kept, it)
			seen[name] = true
		} else {
			changed = true
		}
	}
	approved, err := b.Store.ApprovedModels(acct.Key)
	if err != nil {
		return nil, err
	}
	for _, r := range approved {
		if seen[r.Model] {
			continue
		}
		if r.Payload != "" {
			var obj map[string]any
			if json.Unmarshal([]byte(r.Payload), &obj) == nil && obj != nil {
				kept = append(kept, obj)
				seen[r.Model] = true
				changed = true
				continue
			}
		}
		obj := map[string]any{"name": r.Model}
		if r.Alias != "" {
			obj["alias"] = r.Alias
		}
		kept = append(kept, obj)
		seen[r.Model] = true
		changed = true
	}
	if !changed {
		return nil, nil
	}
	entry["models"] = kept
	return entry, nil
}

func dedupe(ss []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// ModelList 模型审批列表 + 状态计数。
type ModelList struct {
	Rows   []store.ModelStatus `json:"rows"`
	Counts map[string]int      `json:"counts"`
}

// ListModels 返回审批记录（status/q/account 过滤）。
func (b *Biz) ListModels(status, q, account string) (*ModelList, error) {
	rows, err := b.Store.AllStatuses()
	if err != nil {
		return nil, err
	}
	counts, err := b.Store.CountByStatus()
	if err != nil {
		return nil, err
	}
	if counts == nil {
		counts = map[string]int{}
	}
	needle := strings.ToLower(q)
	out := make([]store.ModelStatus, 0, len(rows))
	for _, r := range rows {
		if status != "" && r.Status != status {
			continue
		}
		if account != "" && r.AccountKey != account {
			continue
		}
		if needle != "" &&
			!strings.Contains(strings.ToLower(r.Model), needle) &&
			!strings.Contains(strings.ToLower(r.AccountName), needle) {
			continue
		}
		out = append(out, r)
	}
	return &ModelList{Rows: out, Counts: counts}, nil
}

// Changes 返回变更记录（可按账号过滤）。
func (b *Biz) Changes(limit int, account string) ([]store.ChangeRecord, error) {
	return b.Store.ListChangeRecords(limit, account)
}

// ApplyReview 执行审批动作（approve/reject/restore）并立即收敛屏蔽清单。
func (b *Biz) ApplyReview(ctx context.Context, action string, refs []store.ModelRef) (int, error) {
	var status, recAction string
	switch action {
	case "approve":
		status, recAction = StatusApproved, "approved"
	case "reject":
		status, recAction = StatusRejected, "rejected"
	case "restore":
		status, recAction = StatusPending, "restored"
	default:
		return 0, fmt.Errorf("不支持的操作: %s", action)
	}
	if len(refs) == 0 {
		return 0, fmt.Errorf("未选择任何模型")
	}
	changed, err := b.Store.SetStatus(refs, status)
	if err != nil {
		return 0, err
	}
	if len(changed) > 0 {
		recs := make([]store.ChangeRecord, 0, len(changed))
		for _, r := range changed {
			recs = append(recs, store.ChangeRecord{
				AccountKey: r.AccountKey, AccountType: r.AccountType, AccountName: r.AccountName,
				Model: r.Model, Action: recAction,
			})
		}
		if err := b.Store.InsertChangeRecords(recs); err != nil {
			slog.Warn("写入审批记录失败", "err", err)
		}
	}
	c, err := b.Client()
	if err != nil {
		return len(changed), err
	}
	snap, err := b.discover(ctx, c, false)
	if err != nil {
		return len(changed), err
	}
	// 手动审批动作触发全量收敛，不受账号级自动同步开关影响。
	if _, errs := b.enforce(ctx, c, snap, nil, nil); len(errs) > 0 {
		return len(changed), fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return len(changed), nil
}

// ---------- 小工具 ----------

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

// jsonMarshalString 序列化为字符串，失败返回空串。
func jsonMarshalString(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func unmarshal(data []byte, out any) error {
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("解析上游响应失败: %w", err)
	}
	return nil
}
