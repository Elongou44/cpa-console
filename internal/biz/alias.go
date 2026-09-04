package biz

import (
	"encoding/json"
	"regexp"
	"strings"

	"cpa-console/internal/cpa"
	"cpa-console/internal/store"
)

// CPA 模型别名规范化：将上游模型 name 映射为面向客户端的标准 alias。
// 规则移植自 modelpulse services/model_alias.py（遵循 CLIProxyAPI alias 指南：
// 前缀标签 / 命名空间 / 大小写 / 版本号 / free-vip / 缩写展开）。
// 当模型名本身已是标准形式（或带质量备注不应映射）时返回 ""，CPA 中 alias 留空。

var (
	// 质量备注：不得映射为干净的标准名（alias 留空）。
	aliasQualityNoteRe = regexp.MustCompile(`[（(]\s*(?:掺水|注水|劣质|低质|灌水)\s*[）)]`)
	// 开头方括号标签：[kiro]、[FREE]、[浣溪沙]…
	aliasBracketPrefixRe = regexp.MustCompile(`^(?:\[[^\]]*\]\s*)+`)
	// 尾部带圈序号：①②…⑩
	aliasTrailingOrdinalRe = regexp.MustCompile(`[①②③④⑤⑥⑦⑧⑨⑩]+$`)
	// 厂商缩写前缀：ds- 展开为 deepseek-（free/ds-v4-flash-0731 → deepseek-v4-flash-0731），
	// 使同一客户端模型名跨提供方收敛为同一 alias 分组，便于 CPA 负载均衡。
	aliasAbbrevPrefixRe = regexp.MustCompile(`^ds-`)
	// gpt-5-5 → gpt-5.5、gpt-5-6-sol → gpt-5.6-sol。
	aliasGPTVersionRe = regexp.MustCompile(`(?i)\bgpt-(\d+)-(\d+)`)
)

// aliasResourceSuffixes 非独立模型 id 的资源型后缀（mimo-v2.5-pro 这类自带后缀不受影响）。
var aliasResourceSuffixes = []string{"-free", "-vip"}

// SuggestAlias 返回上游模型名的标准 alias；无需映射时返回 ""。
// 上游 name 本身不改动，仅在 name 与标准形式不同的时候填充 alias。
func SuggestAlias(name string) string {
	raw := strings.TrimSpace(name)
	if raw == "" {
		return ""
	}
	// 质量备注不得映射为干净标准名。
	if aliasQualityNoteRe.MatchString(raw) {
		return ""
	}
	s := raw
	s = strings.TrimSpace(aliasBracketPrefixRe.ReplaceAllString(s, ""))
	// 厂商/组织命名空间：deepseek-ai/deepseek-v4-flash → deepseek-v4-flash
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = strings.TrimSpace(s[i+1:])
	}
	s = strings.TrimSpace(aliasTrailingOrdinalRe.ReplaceAllString(s, ""))
	s = strings.ToLower(s)
	s = aliasAbbrevPrefixRe.ReplaceAllString(s, "deepseek-")
	for _, suffix := range aliasResourceSuffixes {
		if strings.HasSuffix(s, suffix) && len(s) > len(suffix) {
			s = strings.TrimSuffix(s, suffix)
		}
	}
	s = aliasGPTVersionRe.ReplaceAllString(s, "gpt-$1.$2")
	s = strings.Trim(s, "-_. ")
	if s == "" || s == raw {
		return ""
	}
	return s
}

// compatModelObj 构建写入 CPA openai-compatibility 条目的单个模型对象：
// 新加入的模型自动生成标准 alias（无需映射时省略 alias 字段）。
func compatModelObj(name string) map[string]any {
	obj := map[string]any{"name": name}
	if a := SuggestAlias(name); a != "" {
		obj["alias"] = a
	}
	return obj
}

// aliasOf 读取模型对象中的 alias 字段，缺失返回 ""。
func aliasOf(obj map[string]any) string {
	a, _ := cpa.GetStr(obj, "alias")
	return a
}

// modelObjFromStored 由本地审批记录（payload + 快照别名）构建写回 CPA 的模型对象。
// 还原优先级：payload 中的既有 alias（保留手工自定义）→ 本地快照记录的 alias
// （曾被删除又回归的模型恢复原映射）→ 按标准规则重新生成（新模型 / 修正过期映射）。
func modelObjFromStored(r store.AccountModel) map[string]any {
	var obj map[string]any
	if r.Payload != "" {
		_ = json.Unmarshal([]byte(r.Payload), &obj)
	}
	if obj == nil {
		obj = map[string]any{}
	}
	obj["name"] = r.Model
	if alias, _ := cpa.GetStr(obj, "alias"); alias == "" {
		switch {
		case r.Alias != "":
			obj["alias"] = r.Alias
		default:
			if a := SuggestAlias(r.Model); a != "" {
				obj["alias"] = a
			}
		}
	}
	return obj
}
