package server

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"

	"cpa-console/internal/biz"
	"cpa-console/internal/cpa"
	"cpa-console/internal/store"

	"github.com/gin-gonic/gin"
)

type handler struct {
	b *biz.Biz
}

func ok(c *gin.Context, data any) { c.JSON(http.StatusOK, data) }

func fail(c *gin.Context, err error) {
	if _, isAPI := err.(*cpa.APIError); isAPI {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
}

// decodeKey 将 URL 中的 base64url 账号标识还原。
func decodeKey(c *gin.Context) (string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(c.Param("key"))
	if err != nil {
		fail(c, err)
		return "", false
	}
	return string(raw), true
}

func (h *handler) health(c *gin.Context) {
	ok(c, gin.H{"status": "ok"})
}

func (h *handler) status(c *gin.Context) {
	ok(c, h.b.Status())
}

// ---------- 设置 ----------

type settingsPayload struct {
	BaseURL       string  `json:"baseUrl"`
	HasKey        bool    `json:"hasKey"`
	KeyMasked     string  `json:"keyMasked"`
	AutoSync      bool    `json:"autoSync"`
	IntervalSec   int     `json:"intervalSec"`
	DefaultUA     string  `json:"defaultUA"`
	ManagementKey *string `json:"managementKey,omitempty"` // 仅写入用
}

func (h *handler) settingsOut() (*settingsPayload, error) {
	st, err := h.b.Settings()
	if err != nil {
		return nil, err
	}
	auto := st["auto_sync"] != "false"
	interval := 60
	if v, err := strconv.Atoi(st["interval_sec"]); err == nil && v >= 15 {
		interval = v
	}
	ua := st["default_ua"]
	if ua == "" {
		ua = biz.DefaultUpstreamUA
	}
	return &settingsPayload{
		BaseURL:     st["base_url"],
		HasKey:      st["management_key"] != "",
		KeyMasked:   maskKey(st["management_key"]),
		AutoSync:    auto,
		IntervalSec: interval,
		DefaultUA:   ua,
	}, nil
}

func (h *handler) getSettings(c *gin.Context) {
	out, err := h.settingsOut()
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h *handler) putSettings(c *gin.Context) {
	var in settingsPayload
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	kv := map[string]string{
		"base_url":     in.BaseURL,
		"auto_sync":    boolStr(in.AutoSync),
		"interval_sec": strconv.Itoa(maxInt(in.IntervalSec, 15)),
		"default_ua":   strings.TrimSpace(in.DefaultUA),
	}
	if in.ManagementKey != nil { // 指针：未传表示不修改
		kv["management_key"] = *in.ManagementKey
	}
	if err := h.b.SaveSettings(kv); err != nil {
		fail(c, err)
		return
	}
	out, err := h.settingsOut()
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h *handler) testSettings(c *gin.Context) {
	var in struct {
		BaseURL       string `json:"baseUrl"`
		ManagementKey string `json:"managementKey"`
	}
	_ = c.ShouldBindJSON(&in) // 允许空 body：使用已保存设置
	base, key := in.BaseURL, in.ManagementKey
	if base == "" || key == "" {
		st, err := h.b.Settings()
		if err != nil {
			fail(c, err)
			return
		}
		if base == "" {
			base = st["base_url"]
		}
		if key == "" {
			key = st["management_key"]
		}
	}
	version, err := h.b.TestWith(c.Request.Context(), base, key)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"version": version})
}

// ---------- 账号 ----------

func (h *handler) listAccounts(c *gin.Context) {
	accounts, err := h.b.ListAccounts(c.Request.Context(),
		c.Query("q"), c.Query("status"), c.Query("type"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"accounts": accounts, "total": len(accounts)})
}

func (h *handler) getAccount(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	acct, models, err := h.b.GetAccount(c.Request.Context(), key)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"account": acct, "models": models})
}

// revealAccountKey 返回账号保存的全部 API Key（编辑弹窗「查看 Key」面板使用）。
func (h *handler) revealAccountKey(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	keys, err := h.b.RevealAccountKeys(c.Request.Context(), key)
	if err != nil {
		fail(c, err)
		return
	}
	first := ""
	if len(keys) > 0 {
		first = keys[0]
	}
	ok(c, gin.H{"apiKeys": keys, "apiKey": first})
}

// checkConnectivity 并行检测账号上游连通性并持久化结果（keys 为空时检测全部）。
func (h *handler) checkConnectivity(c *gin.Context) {
	var in struct {
		Keys []string `json:"keys"`
	}
	_ = c.ShouldBindJSON(&in)
	results, err := h.b.CheckConnectivity(c.Request.Context(), in.Keys)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"results": results})
}

// accountModelsDetail 返回某账号在 CPA 中已加入的全部模型及其 alias 映射。
func (h *handler) accountModelsDetail(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	detail, err := h.b.GetAccountModelsDetail(c.Request.Context(), key)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, detail)
}

func (h *handler) createAccount(c *gin.Context) {
	var in biz.AccountInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	acct, err := h.b.CreateAccount(c.Request.Context(), in)
	if err != nil {
		fail(c, err)
		return
	}
	res := gin.H{"account": acct}
	if syncRes, err := h.b.Sync(c.Request.Context(), false); err == nil {
		res["sync"] = syncRes
	} else {
		res["syncError"] = err.Error()
	}
	ok(c, res)
}

func (h *handler) updateAccount(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	var in biz.AccountInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	acct, err := h.b.UpdateAccount(c.Request.Context(), key, in)
	if err != nil {
		fail(c, err)
		return
	}
	res := gin.H{"account": acct}
	if syncRes, err := h.b.Sync(c.Request.Context(), false); err == nil {
		res["sync"] = syncRes
	} else {
		res["syncError"] = err.Error()
	}
	ok(c, res)
}

// setAutoSync 设置账号级自动同步开关（仅影响后台周期同步）。
func (h *handler) setAutoSync(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	var in struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	if err := h.b.SetAutoSync(key, in.Enabled); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"autoSync": in.Enabled})
}

// setAccountGroup 设置账号的本地分组标记（仅存控制台，不写入 CPA；空串清除分组）。
func (h *handler) setAccountGroup(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	var in struct {
		Group string `json:"group"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	if err := h.b.SetAccountGroup(key, in.Group); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"group": in.Group})
}

// setAccountTags 设置账号的本地标签列表（仅存控制台，不写入 CPA；空列表清除标签）。
func (h *handler) setAccountTags(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	var in struct {
		Tags []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	if err := h.b.SetAccountTags(key, in.Tags); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"tags": in.Tags})
}

func (h *handler) deleteAccount(c *gin.Context) {
	key, valid := decodeKey(c)
	if !valid {
		return
	}
	if err := h.b.DeleteAccount(c.Request.Context(), key); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"deleted": true})
}

func (h *handler) patchAuthFile(c *gin.Context) {
	var in struct {
		Name     string `json:"name"`
		Disabled bool   `json:"disabled"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Name == "" {
		fail(c, err)
		return
	}
	if err := h.b.SetAuthFileStatus(c.Request.Context(), in.Name, in.Disabled); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"updated": true})
}

func (h *handler) fetchModels(c *gin.Context) {
	var in struct {
		Key     string `json:"key"`
		Type    string `json:"type"`
		APIKey  string `json:"apiKey"`
		BaseURL string `json:"baseUrl"`
		UA      string `json:"ua"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, err)
		return
	}
	var (
		models []string
		err    error
	)
	if in.Key != "" {
		models, err = h.b.FetchUpstreamModels(c.Request.Context(), in.Key, in.UA)
	} else {
		models, err = h.b.ProbeUpstream(c.Request.Context(), in.Type, in.APIKey, in.BaseURL, in.UA)
	}
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"models": models})
}

// ---------- 同步与审批 ----------

func (h *handler) sync(c *gin.Context) {
	res, err := h.b.Sync(c.Request.Context(), false)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, res)
}

func (h *handler) listModels(c *gin.Context) {
	list, err := h.b.ListModels(c.Query("status"), c.Query("q"), c.Query("account"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, list)
}

// library 聚合全部账号当前已加入 CPA 的模型（模型库页）。
func (h *handler) library(c *gin.Context) {
	rows, err := h.b.Library(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"rows": rows})
}

// libraryRemove 从指定账号移除一个已加入的模型。
func (h *handler) libraryRemove(c *gin.Context) {
	var in struct {
		AccountKey string `json:"accountKey"`
		Model      string `json:"model"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.AccountKey == "" || in.Model == "" {
		fail(c, err)
		return
	}
	mode, err := h.b.RemoveAccountModel(c.Request.Context(), in.AccountKey, in.Model)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"mode": mode})
}

// cleanupUnavailable 清理「上游已不存在」的不可用模型（前端人工确认后调用）。
func (h *handler) cleanupUnavailable(c *gin.Context) {
	removed, err := h.b.CleanupUnavailable(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"removed": removed})
}

func (h *handler) listChanges(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	recs, err := h.b.Changes(limit, c.Query("account"))
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"records": recs})
}

type reviewBody struct {
	IDs []string `json:"ids"`
}

func (h *handler) review(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in reviewBody
		if err := c.ShouldBindJSON(&in); err != nil {
			fail(c, err)
			return
		}
		refs := make([]store.ModelRef, 0, len(in.IDs))
		for _, id := range in.IDs {
			key, model, ok2 := splitModelID(id)
			if ok2 {
				refs = append(refs, store.ModelRef{AccountKey: key, Model: model})
			}
		}
		changed, err := h.b.ApplyReview(c.Request.Context(), action, refs)
		if err != nil {
			fail(c, err)
			return
		}
		ok(c, gin.H{"changed": changed})
	}
}

func (h *handler) approve(c *gin.Context) { h.review("approve")(c) }
func (h *handler) reject(c *gin.Context)  { h.review("reject")(c) }
func (h *handler) restore(c *gin.Context) { h.review("restore")(c) }

// ---------- 小工具 ----------

func boolStr(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func maskKey(k string) string {
	if len(k) <= 8 {
		return "****"
	}
	return k[:4] + "****" + k[len(k)-4:]
}

// splitModelID 拆分 "accountKey|model"。
func splitModelID(id string) (key, model string, valid bool) {
	for i := 0; i < len(id); i++ {
		if id[i] == '|' {
			if i > 0 && i < len(id)-1 {
				return id[:i], id[i+1:], true
			}
			return "", "", false
		}
	}
	return "", "", false
}
