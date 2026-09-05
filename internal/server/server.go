// Package server 提供 HTTP API 与前端静态资源服务。
package server

import (
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"cpa-console/internal/biz"

	"github.com/gin-gonic/gin"
)

// New 创建 Gin 引擎（API + 内嵌前端）。
func New(b *biz.Biz, dist fs.FS) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger())

	h := &handler{b: b}
	api := r.Group("/api")
	{
		api.GET("/health", h.health)
		api.GET("/status", h.status)
		api.GET("/settings", h.getSettings)
		api.PUT("/settings", h.putSettings)
		api.POST("/settings/test", h.testSettings)
		api.GET("/accounts", h.listAccounts)
		api.GET("/accounts/:key", h.getAccount)
		api.GET("/accounts/:key/reveal-key", h.revealAccountKey)
		api.GET("/accounts/:key/models-detail", h.accountModelsDetail)
		api.POST("/accounts/:key/models/alias", h.modelAliasSet)
		api.POST("/accounts", h.createAccount)
		api.POST("/accounts/check", h.checkConnectivity)
		api.PATCH("/accounts/:key/disabled", h.patchAccountDisabled)
		api.PUT("/accounts/:key", h.updateAccount)
		api.DELETE("/accounts/:key", h.deleteAccount)
		api.PATCH("/auth-files", h.patchAuthFile)
		api.PATCH("/accounts/:key/auto-sync", h.setAutoSync)
		api.PATCH("/accounts/:key/group", h.setAccountGroup)
		api.PATCH("/accounts/:key/tags", h.setAccountTags)
		api.POST("/fetch-models", h.fetchModels)
		api.POST("/sync", h.sync)
		api.GET("/models", h.listModels)
		api.GET("/models/changes", h.listChanges)
		api.GET("/library", h.library)
		api.POST("/library/remove", h.libraryRemove)
		api.POST("/models/approve", h.approve)
		api.POST("/models/reject", h.reject)
		api.POST("/models/restore", h.restore)
		api.POST("/models/cleanup-unavailable", h.cleanupUnavailable)
	}

	registerStatic(r, dist)
	return r
}

// registerStatic 服务内嵌前端；未命中的路径回退到 index.html（SPA）。
func registerStatic(r *gin.Engine, dist fs.FS) {
	fileServer := http.FileServer(http.FS(dist))
	r.NoRoute(func(c *gin.Context) {
		p := strings.TrimPrefix(c.Request.URL.Path, "/")
		if p != "" {
			if st, err := fs.Stat(dist, p); err == nil && !st.IsDir() {
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}
		data, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			c.String(http.StatusNotFound, "frontend not built: run `cd frontend && npm run build`")
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", data)
	})
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if c.Request.URL.Path == "/api/health" {
			return
		}
		slog.Info("http",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"cost", time.Since(start).Round(time.Millisecond).String())
	}
}
