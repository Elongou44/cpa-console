# CPA Console

本地运行的 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA）账号管理控制台。复刻 [axonhub](https://github.com/looplj/axonhub) 渠道管理页的交互与视觉，把 CPA 的"账号管理"映射为"渠道管理"：

- **账号总览**：Provider 类型 Tab + 数据表，Key 型账号增删改、OAuth 凭据启停，全部变更写入 CPA 热生效；支持账号级「自动同步」开关，关闭后后台同步不再处理该账号（手动同步与审批不受影响）。
- **模型审批（强管控）**：同步自动发现的新模型进入待审批区；**审批通过才会被发现与路由**，未审批/已拒绝模型自动写入 CPA 的 `excluded-models` / `oauth-excluded-models` 屏蔽清单，并在每次同步时幂等收敛、纠正漂移。控制台手动添加/编辑的模型直接放行，无需审批。OpenAI 兼容账号同步时会探测上游 `/v1/models`，路由清单之外发现的新模型自动进入待审批，清单内显式配置的模型自动放行。
- **模型库**：按模型聚合展示"提供账号"自动关联映射、别名、首次发现时间与在线状态。
- **连接设置**：CPA 服务地址 + 管理密钥，一键连通测试、自动同步开关与间隔。

## 架构

```
┌──────────────┐   HTTP /api/*   ┌─────────────────────┐   Management API   ┌─────────┐
│ React 19 SPA │ ──────────────► │ Go (Gin) 单二进制    │ ─────────────────► │ CPA     │
│ TanStack     │                 │ · 反向代理规避 CORS  │  /v0/management    │ :8317   │
│ Query/Router │ ◄────────────── │ · SQLite 审批状态    │ ◄───────────────── │         │
└──────────────┘   embed 静态资源  └─────────────────────┘                    └─────────┘
```

- CPA 是账号数据的唯一事实源；本地 SQLite（纯 Go 驱动，无 CGO）只保存连接设置、审批状态与变更记录。
- 技术栈：Go 1.26 + Gin；React 19 + TypeScript + Vite 5 + Tailwind CSS + TanStack Router/Query。

## 快速开始

### 构建（单二进制）

```powershell
# 1. 构建前端（必须先于 go build，dist 会被嵌入二进制）
cd frontend
npm install
npm run build
cd ..

# 2. 编译
go build -o cpa-console.exe ./cmd/cpa-console
```

或使用 Makefile：`make build`（Windows 需自备 make）。

### 运行

```powershell
.\cpa-console.exe                        # 默认 :8790，数据库 ./data/cpa-console.db
.\cpa-console.exe -addr :9000 -db D:\cpa\console.db
```

可选环境变量（首次运行时自动导入设置）：

| 变量 | 说明 |
| --- | --- |
| `CPA_BASE_URL` | CPA 服务地址，如 `http://127.0.0.1:8317` |
| `CPA_MANAGEMENT_KEY` | CPA 管理密钥明文（对应配置中 `remote-management.secret-key` 的原文） |

### 使用

1. 打开 `http://localhost:8790`，进入 **设置** 页填写 CPA 服务地址与管理密钥，点击「测试连接」（成功会显示 CPA 版本）。
   - 若提示 403，请在 CPA 配置中开启 `remote-management.allow-remote: true`（跨机访问时必需）。
2. 进入 **账号** 页：右上角「添加账号」→ 选择类型（OpenAI 兼容 / Gemini / Claude / Codex / xAI / Interactions / Vertex）→ 填写 API Key 与 Base URL → 保存即写入 CPA。
   - OpenAI 兼容账号可点击「获取模型」直连上游 `/v1/models` 自动填充模型列表。
3. 保存后系统立即同步：控制台手动添加/编辑的模型**直接放行**；同步自动发现的新模型进入 **模型 → 待审批**（OpenAI 兼容账号会探测上游 `/v1/models`），审批「放行」后模型才会被发现，未放行模型由控制台自动写入 CPA 屏蔽清单。
4. OAuth 凭据（auth-files）以只读方式展示并支持启用/禁用；OAuth 登录添加账号暂未内置，可先用 CPA CLI 完成登录后在此管理。

## 开发

```powershell
# 后端
go run ./cmd/cpa-console            # API :8790

# 前端（独立 dev server，/api 代理到 8790）
cd frontend
npm run dev                         # http://localhost:5173
```

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/PUT | `/api/settings` | 读取/保存连接与同步设置 |
| POST | `/api/settings/test` | 连通测试（返回 CPA 版本） |
| GET | `/api/accounts` | 账号列表（`q`/`status`/`type` 过滤） |
| GET/POST/PUT/DELETE | `/api/accounts[/:key]` | Key 型账号详情/新增/更新/删除 |
| PATCH | `/api/auth-files` | OAuth 凭据启用/禁用 |
| PATCH | `/api/accounts/:key/auto-sync` | 账号级自动同步开关，body: `{ "enabled": true }` |
| POST | `/api/fetch-models` | 直连上游获取模型列表 |
| POST | `/api/sync` | 立即同步（发现 + 强管控收敛） |
| GET | `/api/models` | 审批记录（`status`/`q`/`account` 过滤） |
| GET | `/api/models/changes` | 变更记录时间线 |
| POST | `/api/models/approve·reject·restore` | 审批动作，body: `{ "ids": ["accountKey|model"] }` |

## 安全说明

- 管理密钥仅保存在本地 SQLite，日志不输出密钥；控制台默认只监听本机即可使用，请勿暴露到公网。
- 强管控会**覆写**账号的 `excluded-models` 字段：未在本系统放行的模型一律屏蔽。如需在 CPA 侧临时放行某模型，请先在本系统审批。
