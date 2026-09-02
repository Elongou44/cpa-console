// cpa-console：CLIProxyAPI 账号与模型审批管理控制台。
package main

import (
	"context"
	"flag"
	"io/fs"
	"log/slog"
	"os"

	"cpa-console/frontend"
	"cpa-console/internal/biz"
	"cpa-console/internal/server"
	"cpa-console/internal/store"
)

func main() {
	addr := flag.String("addr", ":8790", "HTTP 监听地址")
	dbPath := flag.String("db", "data/cpa-console.db", "SQLite 数据库路径")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	st, err := store.Open(*dbPath)
	if err != nil {
		slog.Error("打开数据库失败", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	b := biz.New(st)
	b.SeedFromEnv()

	// 后台周期同步：模型发现 + 审批强管控收敛。
	go b.RunSyncLoop(context.Background())

	dist, err := fs.Sub(frontend.Dist, "dist")
	if err != nil {
		slog.Error("内嵌前端资源异常", "err", err)
		os.Exit(1)
	}
	srv := server.New(b, dist)
	slog.Info("cpa-console 已启动", "addr", *addr, "db", *dbPath)
	if err := srv.Run(*addr); err != nil {
		slog.Error("HTTP 服务退出", "err", err)
		os.Exit(1)
	}
}
