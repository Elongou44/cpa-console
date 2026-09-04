# CPA Console 开发与发布规范

本地运行的 CLIProxyAPI（CPA）账号管理控制台：Go (Gin) 单二进制内嵌 React 19 SPA，详见 `README.md`。

## 发布与重启（工具化，不要手敲命令）

改完前后端代码后，**统一使用根目录 `deploy.ps1` 完成构建、重启与提交**，不要手动执行散装命令：

```powershell
.\deploy.ps1                      # 全量发布：npm build -> 停旧实例 -> go build -> 重启 -> 健康检查
.\deploy.ps1 -SkipFrontend        # 只改了 Go 代码时跳过前端构建
.\deploy.ps1 -Message "提交说明"   # 构建并重启成功后自动 git add -A + commit（不传不提交）
```

要点：

- `deploy.ps1` 会强制结束 `cpa-console.exe` / `air` / `cpa-console-dev` 进程后重启，Windows 下运行中的 exe 无法覆盖，先停后编是必须的。
- 前端 `dist/` 通过 embed 打进二进制，**npm run build 必须先于 go build**；只改 Go 时才可用 `-SkipFrontend`。
- 脚本以 UTF-8 BOM 保存（PowerShell 5.1 兼容），修改后若出现中文乱码/解析错误，先检查 BOM 是否丢失。
- 提交仅通过 `-Message` 显式触发；不要在脚本外替用户自动 commit。

## 开发模式（热更新）

日常调试用 `dev.bat`：新窗口 `npm run dev`（:5173，/api 代理到 8790）+ air 热重载后端（:8790）。改 `.go` 自动重建重启，改前端即时生效，全程免手动发布。

## 验证标准

- 前端：`npm run build` 内含 `tsc -b`，类型错误会在构建期暴露；改完 TS/TSX 至少跑一次全量 `deploy.ps1`。
- 后端：`go build ./...`；`internal/biz` 下的纯逻辑（如别名规则）配套 `_test.go`，改动时用 `go test ./internal/biz/` 验证。
- 发布完成的判定：脚本输出 `http://localhost:8790 已就绪`（健康检查 200）。

## 模块索引（改哪类功能从哪入手）

新对话定位功能时按此表直接找文件，不需要全量扫描项目。

### 后端（Go）

| 要改什么 | 入手文件 | 说明 |
| --- | --- | --- |
| 加/改一个 HTTP 接口 | `internal/server/server.go`（路由注册）→ `internal/server/handlers.go`（全部 handler，按功能分区） | 返回统一走 `ok(c, gin.H{...})` |
| 账号增删改查、上游模型探测 | `internal/biz/accounts.go` | Key 型账号 CRUD、`ProbeUpstream` / `FetchUpstreamModels` |
| 审批放行/拒绝、屏蔽清单收敛 | `internal/biz/review.go` | 强管控核心，幂等收敛 `excluded-models` |
| 账号模型清单/明细 | `internal/biz/account_models.go` | |
| 别名映射规则 | `internal/biz/alias.go`（+ `alias_test.go`） | 纯逻辑有单测，改动先跑 `go test ./internal/biz/` |
| 模型库聚合与账号级移除 | `internal/biz/library.go` | `GET /api/library`、`POST /api/library/remove`；compat 真删条目模型，其余类型 rejected+收敛屏蔽 |
| 调 CPA 的 Management API | `internal/cpa/client.go` | 所有对 `/v0/management` 的封装集中在此 |
| 设置/审批状态/变更记录的持久化 | `internal/store/store.go` | SQLite 纯 Go 驱动，无 CGO |
| 依赖注入/服务装配 | `internal/biz/biz.go` | Biz 聚合各领域逻辑 |

数据链路：前端 hook → `/api/*` → `handlers.go` → `biz/*.go` → `cpa/client.go`（写 CPA）+ `store/store.go`（写本地库）。

### 前端（React）

| 要改什么 | 入手文件 | 说明 |
| --- | --- | --- |
| 新页面/新路由 | `frontend/src/routes.tsx` → 新建 `features/<名>/index.tsx` | 每个 feature 三件套：`index.tsx` 页面、`components/` 弹窗表格、`data/hooks.ts` 请求 |
| 某个页面功能 | `frontend/src/features/accounts|models|library|aliases|settings/` | 账号、待审批、模型库（独立页）、别名映射、设置 |
| 加一个 API 调用 | 对应 feature 的 `data/hooks.ts` + `frontend/src/lib/api.ts` | 统一 TanStack Query mutation/query |
| 共享类型 | `frontend/src/lib/types.ts` | 与后端 JSON 字段对应，改接口时同步 |
| 新文案 | `frontend/src/lib/i18n.ts` | 扁平 key 字典，禁止硬编码中文 |
| 基础组件（按钮/弹窗/表格…） | `frontend/src/components/ui/` | shadcn 风格，一般不改 |
| 布局/侧边栏导航 | `frontend/src/components/layout/app-shell.tsx` | 加页面时导航也在这加 |
| 跨页面共享的小组件 | `frontend/src/components/shared/` | 如 `review.tsx` 的状态徽章 |

### 典型任务速查

- 「加个接口并在页面用」：`handlers.go` → `biz/*.go` → 前端 `hooks.ts` → 组件 → `types.ts` 同步字段 → `deploy.ps1` 全量发布。
- 「改某个弹窗/表格样式」：直接进对应 `features/*/components/`，改完 `deploy.ps1`。
- 「只改后端逻辑」：改 `biz/` → `deploy.ps1 -SkipFrontend`；纯规则类逻辑先补 `go test`。

## 结果语义与安全

- 管理密钥只存本地 SQLite，不进日志、示例或提交内容。
- 默认监听本机 :8790；`data/cpa-console.db` 为本地状态，不要纳入版本控制或随 exe 分发。

## 本规范的维护

本文件是活的：新增模块、新踩的坑、新的典型任务模式，完成对应改动后随手同步进上面相应章节（模块索引、发布工具、验证标准），保持「新对话不扫项目也能定位功能」的目标成立。与 `README.md` 分工：README 面向使用者讲功能与上手，本文件面向开发者讲改动入口与纪律。
