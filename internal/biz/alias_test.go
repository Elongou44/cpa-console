package biz

import "testing"

func TestSuggestAlias(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"deepseek-ai/deepseek-v4-flash", "deepseek-v4-flash"},
		{"[FREE]deepseek-ai/DeepSeek-V4-Flash-free", "deepseek-v4-flash"},
		{"gpt-5-6-sol", "gpt-5.6-sol"},
		{"free/ds-v4-flash-0731", "deepseek-v4-flash-0731"},
		{"kimi-k3①", "kimi-k3"},
		{"deepseek-v4-flash", ""},
		{"mimo-v2.5-pro-free", "mimo-v2.5-pro"},
		{"glm-5（掺水）", ""},
		{"glm-5(注水)", ""},
		{"", ""},
		{"   ", ""},
	}
	for _, c := range cases {
		if got := SuggestAlias(c.in); got != c.want {
			t.Errorf("SuggestAlias(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
