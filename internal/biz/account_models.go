package biz

import (
	"context"
	"fmt"
	"strings"

	"cpa-console/internal/cpa"
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
	for _, entry := range items {
		acct := keyAccountFrom(def, entry)
		if acct.Key != key {
			continue
		}
		return accountModelsDetailFromEntry(ctx, c, def, entry, acct)
	}
	return nil, fmt.Errorf("账号不存在")
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
