// Package frontend 内嵌前端构建产物（frontend/dist）。
package frontend

import "embed"

// Dist 为前端静态资源，构建命令：cd frontend && npm run build。
//go:embed all:dist
var Dist embed.FS
