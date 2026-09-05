// Package biz 实现账号归一化、模型发现与审批强管控的业务编排。
package biz

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"time"

	"cpa-console/internal/cpa"
	"cpa-console/internal/store"
)

// 审批状态常量。
const (
	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusRejected = "rejected"
)

// Biz 业务编排层。
type Biz struct {
	Store *store.Store

	mu          sync.Mutex
	syncing     bool
	lastSyncAt  time.Time
	lastSyncErr string
	lastConnAt  time.Time
}

// New 创建 Biz。
func New(st *store.Store) *Biz { return &Biz{Store: st} }

// Settings 返回当前设置。
func (b *Biz) Settings() (map[string]string, error) { return b.Store.GetSettings() }

// SaveSettings 合并保存设置。
func (b *Biz) SaveSettings(kv map[string]string) error { return b.Store.SetSettings(kv) }

// SeedFromEnv 首次运行时从环境变量导入 CPA 连接信息（CPA_BASE_URL / CPA_MANAGEMENT_KEY）。
func (b *Biz) SeedFromEnv() {
	st, err := b.Store.GetSettings()
	if err != nil {
		return
	}
	kv := map[string]string{}
	if st["base_url"] == "" && os.Getenv("CPA_BASE_URL") != "" {
		kv["base_url"] = os.Getenv("CPA_BASE_URL")
	}
	if st["management_key"] == "" && os.Getenv("CPA_MANAGEMENT_KEY") != "" {
		kv["management_key"] = os.Getenv("CPA_MANAGEMENT_KEY")
	}
	if len(kv) > 0 {
		if err := b.Store.SetSettings(kv); err == nil {
			slog.Info("已从环境变量导入 CPA 连接设置")
		}
	}
}

// Client 根据设置构建 CPA 管理客户端。
func (b *Biz) Client() (*cpa.Client, error) {
	st, err := b.Store.GetSettings()
	if err != nil {
		return nil, err
	}
	base, key := st["base_url"], st["management_key"]
	if base == "" || key == "" {
		return nil, fmt.Errorf("尚未配置 CPA 服务地址或管理密钥，请先前往设置页")
	}
	return cpa.New(base, key), nil
}

// TestWith 使用给定连接参数测试连通性，返回 CPA 版本。
func (b *Biz) TestWith(ctx context.Context, baseURL, key string) (string, error) {
	if baseURL == "" || key == "" {
		return "", fmt.Errorf("请填写 CPA 服务地址与管理密钥")
	}
	return cpa.New(baseURL, key).LatestVersion(ctx)
}

// RuntimeStatus 服务运行状态摘要。
type RuntimeStatus struct {
	Configured bool           `json:"configured"`
	Syncing    bool           `json:"syncing"`
	LastSyncAt string         `json:"lastSyncAt,omitempty"`
	LastError  string         `json:"lastError,omitempty"`
	Counts     map[string]int `json:"counts"`
}

// Status 返回运行状态。
func (b *Biz) Status() RuntimeStatus {
	st, err := b.Store.GetSettings()
	b.mu.Lock()
	rs := RuntimeStatus{
		Syncing:    b.syncing,
		LastSyncAt: b.lastSyncAt.Format(time.RFC3339),
		LastError:  b.lastSyncErr,
	}
	b.mu.Unlock()
	rs.Configured = err == nil && st["base_url"] != "" && st["management_key"] != ""
	if counts, err := b.Store.CountByStatus(); err == nil {
		rs.Counts = counts
	}
	return rs
}

// RunSyncLoop 周期执行同步；未配置或自动同步关闭时跳过。
func (b *Biz) RunSyncLoop(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			st, err := b.Store.GetSettings()
			if err != nil || st["base_url"] == "" || st["management_key"] == "" {
				continue
			}
			if st["auto_sync"] == "false" {
				continue
			}
			interval := 60
			if v, err := strconv.Atoi(st["interval_sec"]); err == nil && v >= 15 {
				interval = v
			}
			b.mu.Lock()
			last := b.lastSyncAt
			b.mu.Unlock()
			if !last.IsZero() && time.Since(last) < time.Duration(interval)*time.Second {
				continue
			}
			sctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			if _, err := b.Sync(sctx, true); err != nil {
				slog.Warn("后台同步失败", "err", err)
			}
			cancel()
		}
	}
}

// RunConnLoop 周期执行连通性检测；未配置或自动检测关闭时跳过，结果持久化供列表展示。
func (b *Biz) RunConnLoop(ctx context.Context) {
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			st, err := b.Store.GetSettings()
			if err != nil || st["base_url"] == "" || st["management_key"] == "" {
				continue
			}
			if st["conn_auto"] == "false" {
				continue
			}
			interval := 300
			if v, err := strconv.Atoi(st["conn_interval_sec"]); err == nil && v >= 30 {
				interval = v
			}
			b.mu.Lock()
			last := b.lastConnAt
			b.mu.Unlock()
			if !last.IsZero() && time.Since(last) < time.Duration(interval)*time.Second {
				continue
			}
			cctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
			if _, err := b.CheckConnectivity(cctx, nil); err != nil {
				slog.Warn("后台连通性检测失败", "err", err)
			}
			cancel()
		}
	}
}
