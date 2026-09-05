package biz

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"cpa-console/internal/cpa"
	"cpa-console/internal/store"
)

// collectionDef 描述一个 Key 型账号集合（与 CPA 管理端点一一对应）。
type collectionDef struct {
	Collection string // 管理端点路径段
	Type       string // 展示用类型
	Channel    string // model-definitions 的 channel（空表示不查询）
}

// DefaultUpstreamUA 控制台探测上游请求的默认 User-Agent（设置页可改，账号级 UA 优先）。
const DefaultUpstreamUA = "Codex Desktop/0.150.0-alpha.8 (Windows 10.0.19045; x86_64) unknown (Codex Desktop; 26.831.21537)"

var keyCollections = []collectionDef{
	{"gemini-api-key", "gemini", "gemini"},
	{"claude-api-key", "claude", "claude"},
	{"codex-api-key", "codex", "codex"},
	{"openai-compatibility", "openai-compatibility", ""},
	{"interactions-api-key", "interactions", "interactions"},
	{"xai-api-key", "xai", "xai"},
	{"vertex-api-key", "vertex", "vertex"},
}

func defByType(t string) (collectionDef, bool) {
	for _, d := range keyCollections {
		if d.Type == t {
			return d, true
		}
	}
	return collectionDef{}, false
}

// Account 归一化后的账号（Key 型或 OAuth 凭据）。
type Account struct {
	Key           string   `json:"key"`
	Kind          string   `json:"kind"` // key | oauth
	Type          string   `json:"type"`
	Name          string   `json:"name"`
	APIKeyMasked  string   `json:"apiKeyMasked,omitempty"`
	KeyCount      int      `json:"keyCount"` // 账号内 Key 总数（openai-compatibility 多 Key 时 > 1）
	BaseURL       string   `json:"baseUrl,omitempty"`
	Status        string   `json:"status"` // enabled | disabled | error
	Disabled      bool     `json:"disabled"`
	AutoSync      bool     `json:"autoSync"`           // 账号级自动同步开关（关闭后后台同步不处理该账号）
	Provider      string   `json:"provider,omitempty"` // OAuth 凭据所属 provider
	AuthFile      string   `json:"authFile,omitempty"` // OAuth 凭据文件名
	Group         string   `json:"group,omitempty"`    // 本地分组标记，仅存控制台，不写入 CPA
	Tags          []string `json:"tags,omitempty"`     // 本地标签列表，同样仅存控制台
	Priority      int      `json:"priority"`           // 路由优先级，写入 CPA 条目的 priority 字段
	UA            string   `json:"ua,omitempty"`       // 账号级 User-Agent，仅存控制台，覆盖默认 UA
	ModelCount    int               `json:"modelCount"`
	ApprovedCount int               `json:"approvedCount"` // 已放行（启用）模型数
	Conn          *store.ConnStatus `json:"conn,omitempty"` // 最近一次上游连通性检测（仅本控制台）
	PendingCount  int      `json:"pendingCount"`
	ExcludedCount int      `json:"excludedCount"`
	SuccessCount  int64    `json:"successCount"`
	FailureCount  int64    `json:"failureCount"`
}

// AccountInput 创建/编辑账号的输入。
type AccountInput struct {
	Type     string   `json:"type"`
	APIKey   string   `json:"apiKey"`  // 单 Key 输入（兼容旧前端）
	APIKeys  []string `json:"apiKeys"` // 多 Key 输入：兼容型写入同一条目轮询，其余类型每个 Key 一个条目
	BaseURL  string   `json:"baseUrl"`
	Name     string   `json:"name"`
	Models   []string `json:"models"`
	Group    string   `json:"group"`    // 本地分组标记，仅存控制台
	Tags     []string `json:"tags"`     // 本地标签列表，仅存控制台
	Priority *int     `json:"priority"` // 路由优先级，写入 CPA 条目；nil 表示不修改
	UA       string   `json:"ua"`       // 账号级 User-Agent，仅存控制台；空串表示清除
}

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:12]
}

func maskKey(k string) string {
	k = strings.TrimSpace(k)
	if k == "" {
		return ""
	}
	if len(k) <= 8 {
		return "****"
	}
	return k[:4] + "****" + k[len(k)-4:]
}

func hostOf(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		return u.Host
	}
	return raw
}

// ---------- 发现 ----------

// snapshot 一次发现流程的中间结果。
type snapshot struct {
	Accounts []Account
	Models   []store.AccountModel
	keyItems map[string][]map[string]any
	Errors   []string
}

func (s *snapshot) addErr(format string, args ...any) {
	s.Errors = append(s.Errors, fmt.Sprintf(format, args...))
}

// discover 拉取全部账号；withModels 时同时发现各账号可用模型。
func (b *Biz) discover(ctx context.Context, c *cpa.Client, withModels bool, skip map[string]bool) (*snapshot, error) {
	snap := &snapshot{keyItems: map[string][]map[string]any{}}
	uas, _ := b.Store.AccountUserAgents()
	for _, def := range keyCollections {
		items, err := c.GetKeyItems(ctx, def.Collection)
		if err != nil {
			snap.addErr("读取 %s 失败: %v", def.Type, err)
			continue
		}
		snap.keyItems[def.Collection] = items
		for _, entry := range items {
			acct := keyAccountFrom(def, entry)
			// skip 中的账号不拉取模型、不探测上游（已关闭自动同步的账号在周期同步中完全不动）。
			if withModels && !skip[acct.Key] {
				models := keyEntryModels(ctx, c, def, entry)
				// openai-compatibility：额外探测上游 /v1/models，条目清单之外的新模型并入发现结果
				//（进入待审批）。探测失败仅记录错误，不影响条目清单内的模型。
				if def.Type == "openai-compatibility" {
					configured := map[string]bool{}
					for _, m := range models {
						configured[m.name] = true
					}
					apiKey := compatEntryAPIKey(entry)
					base, _ := cpa.GetStr(entry, "base-url", "baseUrl", "base_url")
					if names, err := b.probeUpstream(ctx, def.Type, apiKey, base, uas[acct.Key]); err != nil {
						snap.addErr("探测 %s 上游模型失败: %v", acct.Name, err)
					} else {
						for _, n := range names {
							if !configured[n] {
								models = append(models, modelEntry{
									name:    n,
									payload: jsonMarshalString(map[string]any{"name": n}),
								})
							}
						}
					}
				}
				for _, m := range models {
					snap.Models = append(snap.Models, store.AccountModel{
						AccountKey: acct.Key, AccountType: acct.Type, AccountName: acct.Name,
						Model: m.name, Alias: m.alias, Payload: m.payload, FromConfig: m.fromConfig,
					})
				}
				acct.ModelCount = len(models)
			}
			snap.Accounts = append(snap.Accounts, acct)
		}
	}
	files, err := c.GetAuthFiles(ctx)
	if err != nil {
		snap.addErr("读取 OAuth 凭据失败: %v", err)
	} else {
		for _, f := range files {
			acct := oauthAccountFrom(f)
			if withModels {
				names, err := c.GetAuthFileModels(ctx, acct.AuthFile)
				if err != nil {
					snap.addErr("读取凭据 %s 模型失败: %v", acct.Name, err)
				} else {
					for _, n := range names {
						snap.Models = append(snap.Models, store.AccountModel{
							AccountKey: acct.Key, AccountType: acct.Type, AccountName: acct.Name, Model: n,
						})
					}
					acct.ModelCount = len(names)
				}
			}
			snap.Accounts = append(snap.Accounts, acct)
		}
	}
	if len(snap.Accounts) == 0 && len(snap.Errors) > 0 {
		return nil, fmt.Errorf("%s", strings.Join(snap.Errors, "; "))
	}
	// 控制台显示名（仅存本地库）优先于 CPA 名称/主机名，覆盖 codex 等无 name 字段的类型。
	if displayNames, err := b.Store.AccountDisplayNames(); err == nil && len(displayNames) > 0 {
		for i := range snap.Accounts {
			if dn := displayNames[snap.Accounts[i].Key]; dn != "" {
				snap.Accounts[i].Name = dn
			}
		}
	}
	return snap, nil
}

type modelEntry struct {
	name       string
	alias      string
	payload    string // 原始模型对象 JSON（openai-compatibility），放行时用于完整还原
	fromConfig bool   // 是否来自 CPA 条目显式配置（区别于上游探测发现；显式配置的模型同步时自动放行）
}

// keyEntryModels 计算单个 Key 型账号的可用模型：
// openai-compatibility 取条目内 models 数组（即 CPA 的路由清单）；其余类型查 model-definitions 静态目录。
// entrySupportsModels 该类型条目是否支持 models 路由清单（可手动添加/点选模型并写入 CPA）。
func entrySupportsModels(def collectionDef) bool {
	return def.Type == "openai-compatibility" || def.Type == "codex"
}

// parseEntryModels 解析条目内 models 数组（字符串或对象两种形态），标记为显式配置（发现即放行）。
func parseEntryModels(entry map[string]any) []modelEntry {
	var out []modelEntry
	arr, ok := entry["models"].([]any)
	if !ok {
		return out
	}
	for _, it := range arr {
		switch m := it.(type) {
		case string:
			out = append(out, modelEntry{name: m, fromConfig: true, payload: jsonMarshalString(map[string]any{"name": m})})
		case map[string]any:
			name, _ := cpa.GetStr(m, "name", "id")
			if name != "" {
				alias, _ := cpa.GetStr(m, "alias")
				out = append(out, modelEntry{name: name, alias: alias, fromConfig: true, payload: jsonMarshalString(m)})
			}
		}
	}
	return out
}

func keyEntryModels(ctx context.Context, c *cpa.Client, def collectionDef, entry map[string]any) []modelEntry {
	if entrySupportsModels(def) {
		// 路由清单以条目 models 为准（获取模型点选 / 手动添加），发现即放行。
		// 不并入 model-definitions 静态目录：目录里的模型上游未必真实提供，
		// 会产生「不存在的待审批」，模型是否存在由「获取模型」直连上游确认。
		return parseEntryModels(entry)
	}
	if def.Channel == "" {
		return nil
	}
	names, err := c.GetModelDefinitions(ctx, def.Channel)
	if err != nil {
		return nil
	}
	out := make([]modelEntry, 0, len(names))
	for _, n := range names {
		out = append(out, modelEntry{name: n})
	}
	return out
}

// compatEntryAPIKey 提取 openai-compatibility 条目的 API Key（api-key-entries 数组优先，兼容旧的顶层字段）。
func compatEntryAPIKey(entry map[string]any) string {
	if arr, ok := entry["api-key-entries"].([]any); ok {
		for _, it := range arr {
			if m, ok := it.(map[string]any); ok {
				if k, _ := cpa.GetStr(m, "api-key", "apiKey", "api_key"); k != "" {
					return k
				}
			}
		}
	}
	k, _ := cpa.GetStr(entry, "api-key", "apiKey", "api_key")
	return k
}

// compatEntryAPIKeys 提取条目的全部 API Key（兼容 api-key-entries 数组与单个 api-key 字段两种结构）。
func compatEntryAPIKeys(entry map[string]any) []string {
	var out []string
	if arr, ok := entry["api-key-entries"].([]any); ok {
		for _, it := range arr {
			if m, ok := it.(map[string]any); ok {
				if k, _ := cpa.GetStr(m, "api-key", "apiKey", "api_key"); k != "" {
					out = append(out, k)
				}
			}
		}
	}
	if len(out) == 0 {
		if k, _ := cpa.GetStr(entry, "api-key", "apiKey", "api_key"); k != "" {
			out = append(out, k)
		}
	}
	return out
}

// normalizeKeys 合并输入的 Key 列表：去空白、去重、保序；列表为空时回落到单 Key 字段。
func normalizeKeys(list []string, primary string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(list)+1)
	add := func(k string) {
		if k = strings.TrimSpace(k); k == "" || seen[k] {
			return
		}
		seen[k] = true
		out = append(out, k)
	}
	for _, k := range list {
		add(k)
	}
	if len(out) == 0 {
		add(primary)
	}
	return out
}

// setCompatKeys 把 Key 列表写回 openai-compatibility 条目的 api-key-entries：
// 数量不变或扩容时原位更新，保留逐 Key 自定义字段（weight / proxy-url）；缩容截断尾部。
func setCompatKeys(entry map[string]any, keys []string) {
	arr, _ := entry["api-key-entries"].([]any)
	if len(arr) == 0 {
		// 旧的顶层 api-key 结构：迁移为数组，避免丢失原 Key
		if old, _ := cpa.GetStr(entry, "api-key", "apiKey", "api_key"); old != "" {
			arr = []any{map[string]any{"api-key": old}}
		} else {
			arr = []any{}
		}
	}
	for i := 0; i < len(arr) && i < len(keys); i++ {
		m, _ := arr[i].(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		m["api-key"] = keys[i]
		arr[i] = m
	}
	if len(keys) > len(arr) {
		for _, k := range keys[len(arr):] {
			arr = append(arr, map[string]any{"api-key": k})
		}
	}
	if len(keys) < len(arr) {
		arr = arr[:len(keys)]
	}
	entry["api-key-entries"] = arr
	delete(entry, "api-key")
}

func keyAccountFrom(def collectionDef, entry map[string]any) Account {
	base, _ := cpa.GetStr(entry, "base-url", "baseUrl", "base_url")
	name, _ := cpa.GetStr(entry, "name")
	a := Account{Kind: "key", Type: def.Type, BaseURL: base}
	switch {
	case name != "":
		a.Name = name
	case base != "":
		a.Name = hostOf(base)
	}
	// 提取 API Key：openai-compatibility 为 api-key-entries 数组（多 Key），其余为单个 api-key 字段。
	keys := compatEntryAPIKeys(entry)
	firstKey := ""
	if len(keys) > 0 {
		firstKey = keys[0]
	}
	a.APIKeyMasked = maskKey(firstKey)
	a.KeyCount = len(keys)
	if a.Name == "" {
		a.Name = a.APIKeyMasked
	}
	// 身份标识：openai-compatibility 以 name 为唯一标识（CPA 按 name 定位条目），其余按密钥指纹。
	if def.Type == "openai-compatibility" {
		a.Key = def.Type + ":" + shortHash(a.Name)
	} else {
		a.Key = def.Type + ":" + shortHash(firstKey+"@"+base)
	}
	a.Status = "enabled"
	if cpa.GetBool(entry, "disabled") {
		a.Status = "disabled"
		a.Disabled = true
	}
	a.ExcludedCount = len(cpa.StrSlice(entry["excluded-models"]))
	a.Priority = int(cpa.GetInt64(entry, "priority"))
	return a
}

var knownProviders = map[string]bool{
	"claude": true, "codex": true, "gemini": true, "qwen": true, "iflow": true,
	"kimi": true, "xai": true, "antigravity": true, "cursor": true,
}

func oauthAccountFrom(f map[string]any) Account {
	name, _ := cpa.GetStr(f, "name", "file", "filename")
	if name == "" {
		raw, _ := jsonMarshal(f)
		name = "auth-" + shortHash(string(raw))
	}
	provider, _ := cpa.GetStr(f, "type", "provider", "auth_type", "channel")
	if provider == "" {
		base := strings.TrimSuffix(name, ".json")
		if i := strings.LastIndex(base, "-"); i >= 0 {
			cand := strings.ToLower(base[i+1:])
			if knownProviders[cand] {
				provider = cand
			}
		}
	}
	if provider == "" {
		provider = "oauth"
	}
	provider = strings.ToLower(provider)
	disabled := cpa.GetBool(f, "disabled")
	unavailable := cpa.GetBool(f, "unavailable")
	status, _ := cpa.GetStr(f, "status")
	a := Account{Kind: "oauth", Type: "oauth-" + provider, Provider: provider, AuthFile: name, Name: name, Disabled: disabled}
	a.Key = "auth:" + name
	switch {
	case disabled:
		a.Status = "disabled"
	case unavailable || strings.EqualFold(status, "error") || strings.Contains(strings.ToLower(status), "expired"):
		a.Status = "error"
	default:
		a.Status = "enabled"
	}
	a.SuccessCount = cpa.GetInt64(f, "success_count", "successCount", "success")
	a.FailureCount = cpa.GetInt64(f, "failure_count", "failureCount", "failure", "fail_count")
	return a
}

// ---------- 账号列表 / CRUD ----------

// ListAccounts 返回过滤后的账号列表（不做逐账号模型请求，模型数取本地快照）。
func (b *Biz) ListAccounts(ctx context.Context, q, status, typ string) ([]Account, error) {
	c, err := b.Client()
	if err != nil {
		return nil, err
	}
	snap, err := b.discover(ctx, c, false, nil)
	if err != nil {
		return nil, err
	}
	modelCounts, _ := b.Store.ModelCountsByAccount()
	approvedCounts, _ := b.Store.ApprovedCountsByAccount()
	pendingCounts, _ := b.Store.PendingCountsByAccount()
	blockedCounts, _ := b.Store.BlockedCountsByAccount()
	autoSyncOff, _ := b.Store.AutoSyncDisabledAccounts()
	groups, _ := b.Store.AccountGroups()
	tagsMap, _ := b.Store.AccountTags()
	uas, _ := b.Store.AccountUserAgents()
	conns, _ := b.Store.AccountConns()
	var out []Account
	needle := strings.ToLower(q)
	statusSet := map[string]bool{}
	for _, s := range strings.Split(status, ",") {
		if s = strings.TrimSpace(s); s != "" {
			statusSet[s] = true
		}
	}
	for _, a := range snap.Accounts {
		a.ModelCount = modelCounts[a.Key]
		a.ApprovedCount = approvedCounts[a.Key]
		a.PendingCount = pendingCounts[a.Key]
		a.AutoSync = !autoSyncOff[a.Key]
		a.Group = groups[a.Key]
		a.Tags = tagsMap[a.Key]
		a.UA = uas[a.Key]
		if cs, ok := conns[a.Key]; ok {
			a.Conn = &cs
		}
		if a.Type == "openai-compatibility" {
			// openai-compatibility 条目无 excluded-models 字段，屏蔽数 = 未放行模型数
			a.ExcludedCount = blockedCounts[a.Key]
		}
		if typ != "" && a.Type != typ {
			continue
		}
		if len(statusSet) > 0 && !statusSet[a.Status] {
			continue
		}
		if needle != "" &&
			!strings.Contains(strings.ToLower(a.Name), needle) &&
			!strings.Contains(strings.ToLower(a.Type), needle) &&
			!strings.Contains(strings.ToLower(a.BaseURL), needle) {
			continue
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type < out[j].Type
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func buildEntry(def collectionDef, in AccountInput, keys []string) map[string]any {
	first := ""
	if len(keys) > 0 {
		first = keys[0]
	}
	e := map[string]any{"api-key": first}
	if in.BaseURL != "" {
		e["base-url"] = strings.TrimSpace(in.BaseURL)
	}
	if in.Priority != nil && *in.Priority != 0 {
		e["priority"] = *in.Priority
	}
	if def.Type == "openai-compatibility" {
		// CPA 要求该结构使用 api-key-entries 数组（多 Key 由 CPA 轮询使用）。
		e["name"] = strings.TrimSpace(in.Name)
		arr := make([]any, 0, len(keys))
		for _, k := range keys {
			arr = append(arr, map[string]any{"api-key": k})
		}
		e["api-key-entries"] = arr
		delete(e, "api-key")
	}
	if entrySupportsModels(def) {
		// 手动添加的模型直接放行并写入路由清单；
		// 新加入的模型自动生成标准 alias（无需映射时省略 alias 字段）。
		models := make([]any, 0, len(in.Models))
		for _, m := range in.Models {
			if m = strings.TrimSpace(m); m != "" {
				models = append(models, compatModelObj(m))
			}
		}
		e["models"] = models
	}
	return e
}

// CreateAccount 新增 Key 型账号并写入 CPA。
// 多 Key 语义：openai-compatibility 全部写入同一条目的 api-key-entries（CPA 轮询使用）；
// 其余类型一个条目一个 Key，多 Key 会创建多个条目（共享分组/标签/UA 设置）。
func (b *Biz) CreateAccount(ctx context.Context, in AccountInput) (Account, error) {
	// 创建期间与同步互斥：避免同步的「消失账号清理」把刚落库的放行状态误删。
	ok, done := b.beginSyncExcl()
	if !ok {
		return Account{}, fmt.Errorf("同步正在进行中，请稍候")
	}
	defer done()
	def, ok := defByType(in.Type)
	if !ok {
		return Account{}, fmt.Errorf("不支持的账号类型: %s", in.Type)
	}
	keys := normalizeKeys(in.APIKeys, in.APIKey)
	if len(keys) == 0 {
		return Account{}, fmt.Errorf("API Key 不能为空")
	}
	if in.Type == "openai-compatibility" && strings.TrimSpace(in.Name) == "" {
		return Account{}, fmt.Errorf("OpenAI 兼容账号必须填写名称")
	}
	if in.Type == "openai-compatibility" && strings.TrimSpace(in.BaseURL) == "" {
		return Account{}, fmt.Errorf("OpenAI 兼容账号必须填写 Base URL")
	}
	if in.Type == "codex" && strings.TrimSpace(in.BaseURL) == "" {
		return Account{}, fmt.Errorf("Codex 账号必须填写 Base URL")
	}
	c, err := b.Client()
	if err != nil {
		return Account{}, err
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return Account{}, err
	}
	// 重复检查覆盖集合内全部条目的全部 Key（含兼容型多 Key 数组）。
	existing := map[string]bool{}
	for _, it := range items {
		for _, k := range compatEntryAPIKeys(it) {
			existing[k] = true
		}
	}
	for _, k := range keys {
		if existing[k] {
			return Account{}, fmt.Errorf("该 API Key 已存在: %s", maskKey(k))
		}
	}
	if def.Type == "openai-compatibility" {
		for _, it := range items {
			if n, _ := cpa.GetStr(it, "name"); n == in.Name {
				return Account{}, fmt.Errorf("同名账号已存在: %s", in.Name)
			}
		}
	}

	var created []Account
	if def.Type == "openai-compatibility" {
		entry := buildEntry(def, in, keys)
		items = append(items, entry)
		if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
			return Account{}, err
		}
		created = append(created, keyAccountFrom(def, entry))
	} else {
		var entries []map[string]any
		for _, k := range keys {
			entries = append(entries, buildEntry(def, in, []string{k}))
		}
		items = append(items, entries...)
		if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
			return Account{}, err
		}
		for _, e := range entries {
			created = append(created, keyAccountFrom(def, e))
		}
	}
	acct := created[0]
	// 手动添加的模型不需要审批：直接以放行状态落库（CPA 路由清单已在 buildEntry 写入）。
	if entrySupportsModels(def) && len(in.Models) > 0 {
		rows := make([]store.AccountModel, 0, len(in.Models)*len(created))
		for _, a := range created {
			for _, m := range in.Models {
				if m = strings.TrimSpace(m); m != "" {
					obj := compatModelObj(m)
					rows = append(rows, store.AccountModel{
						AccountKey: a.Key, AccountType: a.Type, AccountName: a.Name,
						Model: m, Alias: aliasOf(obj), Payload: jsonMarshalString(obj),
					})
				}
			}
		}
		b.insertDiscoveryRecords(rows, func(store.AccountModel) string { return StatusApproved })
	}
	// 分组/标签/UA/自动同步设置应用到本次创建的全部条目。
	for _, a := range created {
		_ = b.Store.SetAccountGroup(a.Key, strings.TrimSpace(in.Group))
		_ = b.Store.SetAccountTags(a.Key, normalizeTags(in.Tags))
		_ = b.Store.SetAccountUserAgent(a.Key, strings.TrimSpace(in.UA))
		// 新账号默认不参与周期自动同步（手动「立即同步」不受影响），确认可用后再在列表开启。
		_ = b.Store.SetAutoSync(a.Key, false)
	}
	// 非 compat 类型 CPA 条目无 name 字段：首个条目把输入名称存为控制台显示名。
	if def.Type != "openai-compatibility" && strings.TrimSpace(in.Name) != "" {
		_ = b.Store.SetAccountDisplayName(created[0].Key, strings.TrimSpace(in.Name))
		acct.Name = strings.TrimSpace(in.Name)
	}
	return acct, nil
}

// insertDiscoveryRecords 落库发现记录并写入变更记录（错误仅记录日志，不阻断主流程）。
// defaultStatus 按模型记录返回初始状态，nil 表示待审批；返回 approved 表示直接放行。
func (b *Biz) insertDiscoveryRecords(rows []store.AccountModel, defaultStatus func(store.AccountModel) string) {
	inserted, err := b.Store.InsertPending(rows, defaultStatus)
	if err != nil {
		slog.Warn("写入发现记录失败", "err", err)
		return
	}
	if len(inserted) == 0 {
		return
	}
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
		slog.Warn("写入变更记录失败", "err", err)
	}
}

// UpdateAccount 按 key 更新账号（空字段保持不变）。
// 输入的 type 与现有类型不同时，切换为在目标类型集合中重建条目并迁移本地状态。
// 全程与同步互斥：身份迁移期间同步的「消失账号清理」会把随迁的审批状态误删。
func (b *Biz) UpdateAccount(ctx context.Context, key string, in AccountInput) (Account, error) {
	typ, _, err := splitKey(key)
	if err != nil {
		return Account{}, err
	}
	ok, done := b.beginSyncExcl()
	if !ok {
		return Account{}, fmt.Errorf("同步正在进行中，请稍候")
	}
	acct, needEnforce, err := b.updateAccountLocked(ctx, key, typ, in)
	done()
	if err == nil && needEnforce {
		// 锁释放后再触发收敛（enforceAfterReview 遇 syncing 忙会跳过）。
		go b.enforceAfterReview()
	}
	return acct, err
}

func (b *Biz) updateAccountLocked(ctx context.Context, key, typ string, in AccountInput) (Account, bool, error) {
	if in.Type != "" && in.Type != typ {
		return b.changeAccountType(ctx, key, in)
	}
	def, ok := defByType(typ)
	if !ok {
		return Account{}, false, fmt.Errorf("不支持的账号类型: %s", typ)
	}
	c, err := b.Client()
	if err != nil {
		return Account{}, false, err
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return Account{}, false, err
	}
	idx := -1
	for i, it := range items {
		if keyAccountFrom(def, it).Key == key {
			idx = i
			break
		}
	}
	if idx < 0 {
		return Account{}, false, fmt.Errorf("账号不存在或标识已变更，请刷新后重试")
	}
	entry := items[idx]
	// 支持 models 清单的类型：先做模型清单 diff（使用重命名前的身份）。
	if entrySupportsModels(def) && in.Models != nil {
		if err := b.updateCompatModels(def, key, entry, in.Models); err != nil {
			return Account{}, false, err
		}
	}
	if keys := normalizeKeys(in.APIKeys, in.APIKey); len(keys) > 0 {
		if def.Type == "openai-compatibility" {
			// 多 Key 原位更新，保留逐 Key 自定义字段；数量变化时扩容/截断。
			setCompatKeys(entry, keys)
		} else {
			if len(keys) > 1 {
				return Account{}, false, fmt.Errorf("该类型一个账号仅支持一个 Key，多 Key 请分别添加账号")
			}
			entry["api-key"] = keys[0]
		}
	}
	if strings.TrimSpace(in.BaseURL) != "" {
		entry["base-url"] = strings.TrimSpace(in.BaseURL)
	}
	if def.Type == "openai-compatibility" && strings.TrimSpace(in.Name) != "" {
		entry["name"] = strings.TrimSpace(in.Name)
	}
	if in.Priority != nil {
		// 优先级写入 CPA 条目；0 表示显式清除。
		if *in.Priority == 0 {
			delete(entry, "priority")
		} else {
			entry["priority"] = *in.Priority
		}
	}
	items[idx] = entry
	if err := c.PutKeyItems(ctx, def.Collection, items); err != nil {
		return Account{}, false, err
	}
	acct := keyAccountFrom(def, entry)
	needEnforce := false
	if acct.Key != key {
		// API Key 变更导致标识变化：审批状态随迁（无需重新审批），账号级配置迁移。
		if err := b.Store.MigrateAccountModels(key, acct.Key, acct.Type, acct.Name); err != nil {
			slog.Warn("迁移模型审批状态失败", "err", err)
		}
		_ = b.Store.RenameAccountSetting(key, acct.Key)
		needEnforce = true
	}
	_ = b.Store.SetAccountGroup(acct.Key, strings.TrimSpace(in.Group))
	_ = b.Store.SetAccountTags(acct.Key, normalizeTags(in.Tags))
	_ = b.Store.SetAccountUserAgent(acct.Key, strings.TrimSpace(in.UA))
	if def.Type != "openai-compatibility" {
		// CPA 无 name 字段的类型：名称仅存控制台，空值清除后回落主机名显示。
		_ = b.Store.SetAccountDisplayName(acct.Key, strings.TrimSpace(in.Name))
	}
	return acct, needEnforce, nil
}

// changeAccountType 切换账号类型：在目标类型集合中重建条目并迁移本地状态。
// Key 与 Base URL 随迁；目标为兼容型时全部 Key 写入同一条目，其余类型每个 Key 一个条目。
// 审批状态无法跨类型沿用（模型集合语义不同），删除后由同步重新发现；账号级设置（分组/标签/UA/自动同步）迁移到新身份。
func (b *Biz) changeAccountType(ctx context.Context, key string, in AccountInput) (Account, bool, error) {
	oldType, _, err := splitKey(key)
	if err != nil {
		return Account{}, false, err
	}
	oldDef, ok := defByType(oldType)
	if !ok {
		return Account{}, false, fmt.Errorf("不支持的账号类型: %s", oldType)
	}
	newDef, ok := defByType(in.Type)
	if !ok {
		return Account{}, false, fmt.Errorf("不支持的账号类型: %s", in.Type)
	}
	c, err := b.Client()
	if err != nil {
		return Account{}, false, err
	}
	oldItems, err := c.GetKeyItems(ctx, oldDef.Collection)
	if err != nil {
		return Account{}, false, err
	}
	idx := -1
	for i, it := range oldItems {
		if keyAccountFrom(oldDef, it).Key == key {
			idx = i
			break
		}
	}
	if idx < 0 {
		return Account{}, false, fmt.Errorf("账号不存在或标识已变更，请刷新后重试")
	}
	oldEntry := oldItems[idx]

	// 迁移的 Key：输入覆盖优先，否则随迁原账号全部 Key。
	keys := normalizeKeys(in.APIKeys, in.APIKey)
	if len(keys) == 0 {
		keys = compatEntryAPIKeys(oldEntry)
	}
	if len(keys) == 0 {
		return Account{}, false, fmt.Errorf("原账号没有可迁移的 API Key")
	}
	base := strings.TrimSpace(in.BaseURL)
	if base == "" {
		base, _ = cpa.GetStr(oldEntry, "base-url", "baseUrl", "base_url")
	}
	if newDef.Type == "codex" && base == "" {
		return Account{}, false, fmt.Errorf("Codex 账号必须填写 Base URL")
	}

	// 旧显示名：本地显示名 > CPA 条目 name；类型切换后用于延续命名。
	oldName := ""
	if dns, err := b.Store.AccountDisplayNames(); err == nil {
		oldName = dns[key]
	}
	if oldName == "" {
		if n, _ := cpa.GetStr(oldEntry, "name"); n != "" {
			oldName = n
		}
	}

	// 目标为兼容型：需要名称（输入 > 旧显示名 > 主机名），且不得与目标集合内已有账号重名。
	migrate := in
	migrate.Type = newDef.Type
	migrate.BaseURL = base
	if newDef.Type == "openai-compatibility" {
		name := strings.TrimSpace(in.Name)
		if name == "" {
			name = oldName
		}
		if name == "" {
			name = hostOf(base)
		}
		if base == "" {
			return Account{}, false, fmt.Errorf("OpenAI 兼容账号必须填写 Base URL")
		}
		migrate.Name = name
		newItems, err := c.GetKeyItems(ctx, newDef.Collection)
		if err != nil {
			return Account{}, false, err
		}
		for _, it := range newItems {
			if n, _ := cpa.GetStr(it, "name"); n == name {
				return Account{}, false, fmt.Errorf("目标类型中已存在同名账号: %s", name)
			}
		}
		entry := buildEntry(newDef, migrate, keys)
		newItems = append(newItems, entry)
		if err := c.PutKeyItems(ctx, newDef.Collection, newItems); err != nil {
			return Account{}, false, err
		}
		// 新条目写入成功后再从旧集合移除，避免中途失败丢账号。
		oldItems = append(oldItems[:idx], oldItems[idx+1:]...)
		if err := c.PutKeyItems(ctx, oldDef.Collection, oldItems); err != nil {
			return Account{}, false, err
		}
		acct := keyAccountFrom(newDef, entry)
		b.migrateAccountState(key, []Account{acct}, migrate)
		// 兼容型名称由 CPA 条目承载，清除可能随迁的本地显示名避免两处命名分叉。
		_ = b.Store.SetAccountDisplayName(acct.Key, "")
		return acct, true, nil
	}

	// 其余类型：每个 Key 一个条目。
	newItems, err := c.GetKeyItems(ctx, newDef.Collection)
	if err != nil {
		return Account{}, false, err
	}
	var entries []map[string]any
	for _, k := range keys {
		entries = append(entries, buildEntry(newDef, migrate, []string{k}))
	}
	newItems = append(newItems, entries...)
	if err := c.PutKeyItems(ctx, newDef.Collection, newItems); err != nil {
		return Account{}, false, err
	}
	// 新条目写入成功后再从旧集合移除，避免中途失败丢账号。
	oldItems = append(oldItems[:idx], oldItems[idx+1:]...)
	if err := c.PutKeyItems(ctx, oldDef.Collection, oldItems); err != nil {
		return Account{}, false, err
	}
	created := make([]Account, 0, len(entries))
	for _, e := range entries {
		created = append(created, keyAccountFrom(newDef, e))
	}
	b.migrateAccountState(key, created, migrate)
	// 首个条目延续命名：输入名称 > 旧显示名；其余条目回落主机名。
	displayName := strings.TrimSpace(in.Name)
	if displayName == "" {
		displayName = oldName
	}
	if displayName != "" {
		_ = b.Store.SetAccountDisplayName(created[0].Key, displayName)
		created[0].Name = displayName
	}
	return created[0], true, nil
}

// migrateAccountState 账号身份变更后的本地状态迁移：审批状态与模型快照随迁
// （放行/拒绝/待审批原样保留，无需重新审批），账号级设置迁移到首个新身份，
// 其余新身份按输入设置初始化（自动同步默认关闭）。最后触发收敛把随迁的放行模型写回路由。
func (b *Biz) migrateAccountState(oldKey string, created []Account, in AccountInput) {
	if err := b.Store.MigrateAccountModels(oldKey, created[0].Key, created[0].Type, created[0].Name); err != nil {
		slog.Warn("迁移模型审批状态失败", "err", err)
	}
	_ = b.Store.RenameAccountSetting(oldKey, created[0].Key)
	for _, a := range created[1:] {
		_ = b.Store.SetAccountGroup(a.Key, strings.TrimSpace(in.Group))
		_ = b.Store.SetAccountTags(a.Key, normalizeTags(in.Tags))
		_ = b.Store.SetAccountUserAgent(a.Key, strings.TrimSpace(in.UA))
		_ = b.Store.SetAutoSync(a.Key, false)
	}
}

// updateCompatModels 处理 openai-compatibility 模型清单的用户编辑：
// 移除的模型删除本地状态并记录；手动提交的模型不需要审批，直接放行；
// CPA 条目 models 收敛为本次提交的放行清单。
func (b *Biz) updateCompatModels(def collectionDef, accountKey string, entry map[string]any, userModels []string) error {
	want := map[string]bool{}
	for _, m := range userModels {
		if m = strings.TrimSpace(m); m != "" {
			want[m] = true
		}
	}
	rows, err := b.Store.AllStatuses()
	if err != nil {
		return err
	}
	acctType, acctName := def.Type, ""
	var dbModels []string
	dbSet := map[string]bool{}
	approvedSet := map[string]bool{}
	for _, r := range rows {
		if r.AccountKey == accountKey {
			dbSet[r.Model] = true
			dbModels = append(dbModels, r.Model)
			if r.Status == StatusApproved {
				approvedSet[r.Model] = true
			}
			acctType, acctName = r.AccountType, r.AccountName
		}
	}
	// removed 仅针对“用户主动从清单移除的已放行模型”。
	// 弹窗回填的清单来自 CPA 条目（只含已放行模型），pending/rejected 行天然不在其中；
	// 若按差集全删，每次编辑保存都会清空拒绝/待审批记录，保存后的同步又会把它们
	// 重新发现为待审批（拒绝过的模型反复回到待审批）。未放行行的收敛由 enforce 负责。
	var removed []string
	for _, m := range dbModels {
		if !want[m] && approvedSet[m] {
			removed = append(removed, m)
		}
	}
	if len(removed) > 0 {
		deleted, err := b.Store.DeleteStatusModels(accountKey, removed)
		if err != nil {
			return err
		}
		recs := make([]store.ChangeRecord, 0, len(deleted))
		for _, r := range deleted {
			recs = append(recs, store.ChangeRecord{
				AccountKey: r.AccountKey, AccountType: r.AccountType, AccountName: r.AccountName,
				Model: r.Model, Action: "removed",
			})
		}
		if err := b.Store.InsertChangeRecords(recs); err != nil {
			slog.Warn("写入变更记录失败", "err", err)
		}
	}
	// 手动提交的模型不需要审批：新模型直接以放行状态落库，
	// 之前处于待审批/已拒绝的模型随本次手动提交一并放行。
	var added []store.AccountModel
	for m := range want {
		if !dbSet[m] {
			added = append(added, store.AccountModel{
				AccountKey: accountKey, AccountType: acctType, AccountName: acctName,
				Model: m, Payload: jsonMarshalString(map[string]any{"name": m}),
			})
		}
	}
	b.insertDiscoveryRecords(added, func(store.AccountModel) string { return StatusApproved })
	var resubmitted []store.ModelRef
	for _, r := range rows {
		if r.AccountKey == accountKey && want[r.Model] && r.Status != StatusApproved {
			resubmitted = append(resubmitted, store.ModelRef{AccountKey: accountKey, Model: r.Model})
		}
	}
	if len(resubmitted) > 0 {
		changed, err := b.Store.SetStatus(resubmitted, StatusApproved)
		if err != nil {
			return err
		}
		recs := make([]store.ChangeRecord, 0, len(changed))
		for _, r := range changed {
			recs = append(recs, store.ChangeRecord{
				AccountKey: r.AccountKey, AccountType: r.AccountType, AccountName: r.AccountName,
				Model: r.Model, Action: "approved",
			})
		}
		if err := b.Store.InsertChangeRecords(recs); err != nil {
			slog.Warn("写入审批记录失败", "err", err)
		}
	}

	// CPA 条目 models 收敛为本次提交的放行清单（还原既有 payload / 别名，
	// 缺失 alias 的新模型按标准规则自动补齐）。
	approved, err := b.Store.ApprovedModels(accountKey)
	if err != nil {
		return err
	}
	models := make([]any, 0, len(approved))
	for _, r := range approved {
		models = append(models, modelObjFromStored(r))
	}
	entry["models"] = models
	return nil
}

// DeleteAccount 删除 Key 型账号。
func (b *Biz) DeleteAccount(ctx context.Context, key string) error {
	typ, _, err := splitKey(key)
	if err != nil {
		return err
	}
	def, ok := defByType(typ)
	if !ok {
		return fmt.Errorf("不支持的账号类型: %s", typ)
	}
	c, err := b.Client()
	if err != nil {
		return err
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return err
	}
	kept := items[:0]
	found := false
	for _, it := range items {
		if keyAccountFrom(def, it).Key == key {
			found = true
			continue
		}
		kept = append(kept, it)
	}
	if !found {
		return fmt.Errorf("账号不存在")
	}
	if err := c.PutKeyItems(ctx, def.Collection, kept); err != nil {
		return err
	}
	if removed, err := b.Store.DeleteByAccounts([]string{key}); err == nil {
		_ = b.recordRemoved(removed)
	}
	_ = b.Store.DeleteAccountSettings([]string{key})
	return nil
}

// GetAccount 返回单个账号详情及其当前模型名列表（用于编辑表单回填与账号级审批）。
func (b *Biz) GetAccount(ctx context.Context, key string) (Account, []string, error) {
	c, err := b.Client()
	if err != nil {
		return Account{}, nil, err
	}
	if strings.HasPrefix(key, "auth:") {
		files, err := c.GetAuthFiles(ctx)
		if err != nil {
			return Account{}, nil, err
		}
		for _, f := range files {
			a := oauthAccountFrom(f)
			if a.Key == key {
				names, err := c.GetAuthFileModels(ctx, a.AuthFile)
				return a, names, err
			}
		}
		return Account{}, nil, fmt.Errorf("凭据不存在")
	}
	typ, _, err := splitKey(key)
	if err != nil {
		return Account{}, nil, err
	}
	def, ok := defByType(typ)
	if !ok {
		return Account{}, nil, fmt.Errorf("不支持的账号类型: %s", typ)
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return Account{}, nil, err
	}
	for _, entry := range items {
		if keyAccountFrom(def, entry).Key == key {
			a := keyAccountFrom(def, entry)
			if uas, err := b.Store.AccountUserAgents(); err == nil {
				a.UA = uas[a.Key]
			}
			if dns, err := b.Store.AccountDisplayNames(); err == nil && dns[a.Key] != "" {
				a.Name = dns[a.Key]
			}
			var names []string
			for _, m := range keyEntryModels(ctx, c, def, entry) {
				names = append(names, m.name)
			}
			return a, names, nil
		}
	}
	return Account{}, nil, fmt.Errorf("账号不存在")
}

// RevealAccountKeys 返回账号保存的全部 API Key（编辑弹窗「查看 Key」面板使用；仅本机管理接口）。
func (b *Biz) RevealAccountKeys(ctx context.Context, key string) ([]string, error) {
	c, err := b.Client()
	if err != nil {
		return nil, err
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
	for _, entry := range items {
		if keyAccountFrom(def, entry).Key == key {
			return compatEntryAPIKeys(entry), nil
		}
	}
	return nil, fmt.Errorf("账号不存在")
}

// ConnectivityResult 单账号上游连通性检测结果。
type ConnectivityResult struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Models    int    `json:"models"`
	Error     string `json:"error,omitempty"`
}

// CheckConnectivity 并行探测 Key 型账号上游连通性（直连模型清单接口），
// 结果持久化到本地库供列表展示；keys 为空时检测全部，OAuth 凭据不参与检测。
func (b *Biz) CheckConnectivity(ctx context.Context, keys []string) ([]ConnectivityResult, error) {
	c, err := b.Client()
	if err != nil {
		return nil, err
	}
	snap, err := b.discover(ctx, c, false, nil)
	if err != nil {
		return nil, err
	}
	filter := map[string]bool{}
	for _, k := range keys {
		filter[k] = true
	}
	type task struct {
		acct  Account
		typ   string
		token string
		base  string
	}
	var tasks []task
	for _, def := range keyCollections {
		for _, entry := range snap.keyItems[def.Collection] {
			acct := keyAccountFrom(def, entry)
			if acct.Kind != "key" || (len(filter) > 0 && !filter[acct.Key]) {
				continue
			}
			token, _ := cpa.GetStr(entry, "api-key", "apiKey", "api_key")
			if def.Type == "openai-compatibility" {
				token = compatEntryAPIKey(entry)
			}
			base, _ := cpa.GetStr(entry, "base-url", "baseUrl", "base_url")
			if token == "" {
				continue
			}
			tasks = append(tasks, task{acct: acct, typ: def.Type, token: token, base: base})
		}
	}
	results := make([]ConnectivityResult, len(tasks))
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for i, t := range tasks {
		wg.Add(1)
		go func(i int, t task) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			res := ConnectivityResult{Key: t.acct.Key, Name: t.acct.Name}
			started := time.Now()
			pctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			names, err := b.probeUpstream(pctx, t.typ, t.token, t.base, "")
			cancel()
			res.LatencyMs = time.Since(started).Milliseconds()
			if err != nil {
				res.Error = err.Error()
			} else {
				res.OK = true
				res.Models = len(names)
			}
			results[i] = res
		}(i, t)
	}
	wg.Wait()
	checked := time.Now().Format(time.RFC3339)
	b.mu.Lock()
	b.lastConnAt = time.Now()
	b.mu.Unlock()
	for _, res := range results {
		if res.Key == "" {
			continue
		}
		_ = b.Store.SetAccountConn(res.Key, store.ConnStatus{
			OK: res.OK, LatencyMs: res.LatencyMs, Models: res.Models, Error: res.Error, CheckedAt: checked,
		})
	}
	return results, nil
}

// SetAuthFileStatus 启用/禁用 OAuth 凭据。
func (b *Biz) SetAuthFileStatus(ctx context.Context, name string, disabled bool) error {
	c, err := b.Client()
	if err != nil {
		return err
	}
	return c.PatchAuthFileStatus(ctx, name, disabled)
}

// SetAutoSync 设置账号级自动同步开关（仅存本地；关闭后后台周期同步不处理该账号，
// 手动同步与审批动作不受影响）。
func (b *Biz) SetAutoSync(accountKey string, on bool) error {
	if !strings.HasPrefix(accountKey, "auth:") {
		typ, _, err := splitKey(accountKey)
		if err != nil {
			return err
		}
		if _, ok := defByType(typ); !ok {
			return fmt.Errorf("不支持的账号类型: %s", typ)
		}
	}
	return b.Store.SetAutoSync(accountKey, on)
}

// SetAccountGroup 设置账号的本地分组标记（空串清除分组；不写入 CPA）。
func (b *Biz) SetAccountGroup(accountKey, group string) error {
	if !strings.HasPrefix(accountKey, "auth:") {
		typ, _, err := splitKey(accountKey)
		if err != nil {
			return err
		}
		if _, ok := defByType(typ); !ok {
			return fmt.Errorf("不支持的账号类型: %s", typ)
		}
	}
	return b.Store.SetAccountGroup(accountKey, strings.TrimSpace(group))
}

// SetAccountTags 设置账号的本地标签列表（空列表清除；不写入 CPA）。
func (b *Biz) SetAccountTags(accountKey string, tags []string) error {
	if !strings.HasPrefix(accountKey, "auth:") {
		typ, _, err := splitKey(accountKey)
		if err != nil {
			return err
		}
		if _, ok := defByType(typ); !ok {
			return fmt.Errorf("不支持的账号类型: %s", typ)
		}
	}
	return b.Store.SetAccountTags(accountKey, normalizeTags(tags))
}

// normalizeTags 去除空白、去重、丢弃空串。
func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, t := range tags {
		if t = strings.TrimSpace(t); t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// FetchUpstreamModels 按账号标识直连上游拉取模型列表。
// uaOverride 非空时优先使用（编辑弹窗未保存的 UA），否则用账号已保存的 UA。
func (b *Biz) FetchUpstreamModels(ctx context.Context, key, uaOverride string) ([]string, error) {
	typ, _, err := splitKey(key)
	if err != nil {
		return nil, err
	}
	def, ok := defByType(typ)
	if !ok {
		return nil, fmt.Errorf("不支持的账号类型: %s", typ)
	}
	c, err := b.Client()
	if err != nil {
		return nil, err
	}
	items, err := c.GetKeyItems(ctx, def.Collection)
	if err != nil {
		return nil, err
	}
	var entry map[string]any
	for _, it := range items {
		if keyAccountFrom(def, it).Key == key {
			entry = it
			break
		}
	}
	if entry == nil {
		return nil, fmt.Errorf("账号不存在")
	}
	apiKey := compatEntryAPIKey(entry)
	base, _ := cpa.GetStr(entry, "base-url", "baseUrl", "base_url")
	ua := strings.TrimSpace(uaOverride)
	if ua == "" {
		uas, _ := b.Store.AccountUserAgents()
		ua = uas[key]
	}
	return b.probeUpstream(ctx, typ, apiKey, base, ua)
}

// ProbeUpstream 用给定参数直连上游拉取模型列表（用于账号尚未保存时的"获取模型"）。
func (b *Biz) ProbeUpstream(ctx context.Context, typ, apiKey, base, ua string) ([]string, error) {
	return b.probeUpstream(ctx, typ, apiKey, base, ua)
}

// trimVersionSuffix 去掉 base 末尾的版本段（如 /v1、/v1beta），避免拼出 /v1/v1/models 这类重复路径。
func trimVersionSuffix(base string) string {
	base = strings.TrimRight(base, "/")
	for _, v := range []string{"/v1beta", "/v1alpha", "/v1"} {
		if strings.HasSuffix(base, v) {
			return strings.TrimSuffix(base, v)
		}
	}
	return base
}

func (b *Biz) probeUpstream(ctx context.Context, typ, apiKey, base, ua string) ([]string, error) {
	pctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if ua = strings.TrimSpace(ua); ua == "" {
		// 账号未单独设置 UA：回落到设置页默认 UA（仍未设置则用内置默认值）。
		if st, err := b.Settings(); err == nil {
			ua = st["default_ua"]
		}
		if ua == "" {
			ua = DefaultUpstreamUA
		}
	}
	switch typ {
	case "openai-compatibility":
		if base == "" {
			return nil, fmt.Errorf("该账号未配置 Base URL")
		}
		data, err := probe(pctx, trimVersionSuffix(base)+"/v1/models", map[string]string{"Authorization": "Bearer " + apiKey}, ua)
		if err != nil {
			return nil, err
		}
		var parsed map[string]any
		if err := unmarshal(data, &parsed); err != nil {
			return nil, err
		}
		return cpa.ExtractModelNames(parsed), nil
	case "gemini":
		if base == "" {
			base = "https://generativelanguage.googleapis.com"
		}
		u := trimVersionSuffix(base) + "/v1beta/models?pageSize=200&key=" + url.QueryEscape(apiKey)
		data, err := probe(pctx, u, nil, ua)
		if err != nil {
			return nil, err
		}
		var parsed map[string]any
		if err := unmarshal(data, &parsed); err != nil {
			return nil, err
		}
		return normalizeModelNames(cpa.ExtractModelNames(parsed), "models/"), nil
	case "claude":
		if base == "" {
			base = "https://api.anthropic.com"
		}
		u := trimVersionSuffix(base) + "/v1/models?limit=100"
		data, err := probe(pctx, u, map[string]string{"x-api-key": apiKey, "anthropic-version": "2023-06-01"}, ua)
		if err != nil {
			return nil, err
		}
		var parsed map[string]any
		if err := unmarshal(data, &parsed); err != nil {
			return nil, err
		}
		return cpa.ExtractModelNames(parsed), nil
	case "xai":
		if base == "" {
			base = "https://api.x.ai"
		}
		data, err := probe(pctx, trimVersionSuffix(base)+"/v1/models", map[string]string{"Authorization": "Bearer " + apiKey}, ua)
		if err != nil {
			return nil, err
		}
		var parsed map[string]any
		if err := unmarshal(data, &parsed); err != nil {
			return nil, err
		}
		return cpa.ExtractModelNames(parsed), nil
	case "codex":
		// 依次尝试 Codex 协议路径 {base}/models 与 OpenAI 风格 {base}/v1/models（中转实现不一）；
		// 响应兼容 Codex 原生 {"models":[{"slug":..}]} 与 OpenAI 风格 {"data":[{"id":..}]}。
		if base == "" {
			base = "https://chatgpt.com/backend-api/codex"
		}
		root := trimVersionSuffix(base)
		var names []string
		var lastErr error
		for _, u := range []string{root + "/models", root + "/v1/models"} {
			data, err := probe(pctx, u, map[string]string{"Authorization": "Bearer " + apiKey}, ua)
			if err != nil {
				lastErr = err
				continue
			}
			if names = extractCodexModelNames(data); len(names) > 0 {
				return names, nil
			}
		}
		if len(names) == 0 {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, fmt.Errorf("上游未返回模型列表")
		}
		return names, nil
	default:
		return nil, fmt.Errorf("该账号类型暂不支持自动获取模型，请手动维护模型列表")
	}
}

// extractCodexModelNames 解析 Codex 上游 /models 响应，兼容 Codex 原生（models[].slug）与 OpenAI 风格（data[].id）。
func extractCodexModelNames(data []byte) []string {
	var body struct {
		Models []struct {
			Slug string `json:"slug"`
			ID   string `json:"id"`
		} `json:"models"`
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := unmarshal(data, &body); err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	add := func(n string) {
		if n = strings.TrimSpace(n); n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	for _, m := range body.Models {
		n := m.Slug
		if n == "" {
			n = m.ID
		}
		add(n)
	}
	for _, m := range body.Data {
		add(m.ID)
	}
	return out
}

func normalizeModelNames(names []string, prefix string) []string {
	out := make([]string, 0, len(names))
	for _, n := range names {
		out = append(out, strings.TrimPrefix(n, prefix))
	}
	return out
}

func probe(ctx context.Context, u string, headers map[string]string, ua string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求上游失败: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("上游返回 %d: %s", resp.StatusCode, truncate(string(data), 200))
	}
	return data, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func splitKey(key string) (typ, rest string, err error) {
	i := strings.Index(key, ":")
	if i <= 0 {
		return "", "", fmt.Errorf("非法的账号标识: %s", key)
	}
	return key[:i], key[i+1:], nil
}
