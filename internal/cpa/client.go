// Package cpa 封装 CLIProxyAPI 管理 API 客户端与响应归一化工具。
// 文档：https://help.router-for.me/cn/management/api
package cpa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const managementPrefix = "/v0/management"

// APIError 表示 CPA 管理 API 返回的非 2xx 响应，并映射为可读提示。
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	switch e.StatusCode {
	case http.StatusUnauthorized:
		return "管理密钥无效（401），请检查设置页中的管理密钥"
	case http.StatusForbidden:
		return "CPA 未开放远程管理（403），请在 CPA 配置中设置 remote-management.allow-remote: true"
	case http.StatusNotFound:
		return "资源不存在（404）: " + e.Message
	case http.StatusUnprocessableEntity:
		return "CPA 配置校验失败（422）: " + e.Message
	case http.StatusServiceUnavailable:
		return "CPA 认证管理器不可用（503）"
	}
	return fmt.Sprintf("CPA 管理 API 请求失败（%d）: %s", e.StatusCode, e.Message)
}

// Client 是 CPA 管理 API 客户端。
type Client struct {
	BaseURL string
	Key     string
	HTTP    *http.Client
}

// New 创建客户端。
func New(baseURL, key string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Key:     key,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	if c.BaseURL == "" {
		return fmt.Errorf("尚未配置 CPA 服务地址")
	}
	u := c.BaseURL + managementPrefix + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("无法连接 CPA（%s）: %w", c.BaseURL, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		msg := strings.TrimSpace(string(data))
		var errBody struct{ Error, Message string }
		if json.Unmarshal(data, &errBody) == nil {
			switch {
			case errBody.Message != "":
				msg = errBody.Message
			case errBody.Error != "":
				msg = errBody.Error
			}
		}
		return &APIError{StatusCode: resp.StatusCode, Message: msg}
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("解析 CPA 响应失败: %w", err)
		}
	}
	return nil
}

// LatestVersion 查询 CPA 版本，用作连通性探测。
func (c *Client) LatestVersion(ctx context.Context) (string, error) {
	var out struct {
		Version string `json:"version"`
	}
	if err := c.do(ctx, http.MethodGet, "/latest-version", nil, nil, &out); err != nil {
		return "", err
	}
	return out.Version, nil
}

// GetJSON 请求任意管理端点并解析 JSON。
func (c *Client) GetJSON(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, nil, out)
}

// GetKeyItems 读取 Key 型账号集合（返回条目数组，兼容多种包裹结构）。
func (c *Client) GetKeyItems(ctx context.Context, collection string) ([]map[string]any, error) {
	var raw any
	if err := c.do(ctx, http.MethodGet, "/"+collection, nil, nil, &raw); err != nil {
		return nil, err
	}
	return NormalizeItems(raw, collection), nil
}

// PutKeyItems 整体替换 Key 型账号集合（CPA 约定：PUT 为全量替换，必须先 GET 合并再提交）。
func (c *Client) PutKeyItems(ctx context.Context, collection string, items []map[string]any) error {
	return c.do(ctx, http.MethodPut, "/"+collection, nil, items, nil)
}

// GetAuthFiles 读取 OAuth 凭据文件列表。
func (c *Client) GetAuthFiles(ctx context.Context) ([]map[string]any, error) {
	var raw any
	if err := c.do(ctx, http.MethodGet, "/auth-files", nil, nil, &raw); err != nil {
		return nil, err
	}
	return NormalizeItems(raw, "files"), nil
}

// PatchAuthFileStatus 启用/禁用 OAuth 凭据。
func (c *Client) PatchAuthFileStatus(ctx context.Context, name string, disabled bool) error {
	body := map[string]any{"name": name, "disabled": disabled}
	return c.do(ctx, http.MethodPatch, "/auth-files/status", nil, body, nil)
}

// GetAuthFileModels 查询单个凭据支持的模型。
func (c *Client) GetAuthFileModels(ctx context.Context, name string) ([]string, error) {
	var raw any
	q := url.Values{"name": []string{name}}
	if err := c.do(ctx, http.MethodGet, "/auth-files/models", q, nil, &raw); err != nil {
		return nil, err
	}
	return ExtractModelNames(raw), nil
}

// GetModelDefinitions 查询 channel 的静态模型目录；未知 channel（400/404）返回空列表。
func (c *Client) GetModelDefinitions(ctx context.Context, channel string) ([]string, error) {
	var raw any
	if err := c.do(ctx, http.MethodGet, "/model-definitions/"+channel, nil, nil, &raw); err != nil {
		if apiErr, ok := err.(*APIError); ok && (apiErr.StatusCode == 400 || apiErr.StatusCode == 404) {
			return nil, nil
		}
		return nil, err
	}
	return ExtractModelNames(raw), nil
}

// PatchOauthExcludedModels 设置某 provider 的 OAuth 屏蔽模型清单；空数组表示删除该条目。
func (c *Client) PatchOauthExcludedModels(ctx context.Context, provider string, models []string) error {
	if models == nil {
		models = []string{}
	}
	body := map[string]any{"provider": provider, "models": models}
	return c.do(ctx, http.MethodPatch, "/oauth-excluded-models", nil, body, nil)
}

// ---------- 响应归一化工具 ----------

// NormalizeItems 将 CPA 返回的包裹结构归一化为对象数组。
// CPA 的 GET 列表端点返回 {"<端点名>": [...]}（如 {"openai-compatibility": [...]}、{"files": [...]}）。
func NormalizeItems(raw any, wrapper string) []map[string]any {
	switch v := raw.(type) {
	case []any:
		return toMaps(v)
	case map[string]any:
		if wrapper != "" {
			if arr, ok := v[wrapper].([]any); ok {
				return toMaps(arr)
			}
		}
		for _, k := range []string{"items", "value", "files", "auth-files", "authFiles", "data", "result"} {
			if arr, ok := v[k].([]any); ok {
				return toMaps(arr)
			}
		}
		// 兜底：取对象中第一个数组字段。
		for _, arr := range v {
			if a, ok := arr.([]any); ok {
				return toMaps(a)
			}
		}
	}
	return nil
}

func toMaps(arr []any) []map[string]any {
	out := make([]map[string]any, 0, len(arr))
	for _, e := range arr {
		if m, ok := e.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// ExtractModelNames 从任意结构中提取模型名列表。
func ExtractModelNames(raw any) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	var walk func(v any)
	walk = func(v any) {
		switch t := v.(type) {
		case string:
			add(t)
		case []any:
			for _, e := range t {
				walk(e)
			}
		case map[string]any:
			for _, k := range []string{"models", "data", "items", "model_definitions", "modelDefinitions"} {
				if arr, ok := t[k].([]any); ok {
					walk(arr)
					return
				}
			}
			if s, ok := GetStr(t, "id", "name", "model", "model_name", "modelId"); ok {
				add(s)
			}
		}
	}
	walk(raw)
	return out
}

// GetStr 返回 map 中第一个非空字符串字段。
func GetStr(m map[string]any, keys ...string) (string, bool) {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s), true
			}
		}
	}
	return "", false
}

// GetBool 返回 map 中第一个命中的布尔字段。
func GetBool(m map[string]any, keys ...string) bool {
	for _, k := range keys {
		if v, ok := m[k].(bool); ok {
			return v
		}
	}
	return false
}

// GetInt64 返回 map 中第一个命中的数值字段。
func GetInt64(m map[string]any, keys ...string) int64 {
	for _, k := range keys {
		switch v := m[k].(type) {
		case float64:
			return int64(v)
		case int64:
			return v
		case int:
			return int64(v)
		case json.Number:
			if n, err := v.Int64(); err == nil {
				return n
			}
		}
	}
	return 0
}

// StrSlice 将任意值归一化为去空、去空字符串的字符串切片。
func StrSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	var out []string
	for _, e := range arr {
		if s, ok := e.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}

// EqualSet 判断两个字符串集合（忽略顺序）是否相同。
func EqualSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	am := make(map[string]int, len(a))
	for _, s := range a {
		am[s]++
	}
	for _, s := range b {
		am[s]--
		if am[s] < 0 {
			return false
		}
	}
	return true
}

// ToAnySlice 转换为 []any。
func ToAnySlice(ss []string) []any {
	out := make([]any, 0, len(ss))
	for _, s := range ss {
		out = append(out, s)
	}
	return out
}
