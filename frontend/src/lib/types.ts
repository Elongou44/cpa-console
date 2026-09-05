/** 与后端 REST API 对齐的类型定义。 */

export type AccountKind = 'key' | 'oauth'
export type AccountStatus = 'enabled' | 'disabled' | 'error'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface Account {
  key: string
  kind: 'key' | 'oauth'
  type: string
  name: string
  apiKeyMasked?: string
  /** 账号内 Key 总数（OpenAI 兼容多 Key 时 > 1，表格显示 +N）。 */
  keyCount?: number
  baseUrl?: string
  status: AccountStatus
  disabled: boolean
  autoSync: boolean
  provider?: string
  authFile?: string
  group?: string
  tags?: string[]
  priority?: number
  ua?: string
  modelCount: number
  approvedCount: number
  /** 最近一次上游连通性检测（仅本控制台，未检测过为空）。 */
  conn?: AccountConn
  pendingCount: number
  excludedCount: number
  successCount: number
  failureCount: number
}

export interface AccountConn {
  ok: boolean
  latencyMs: number
  models: number
  error?: string
  checkedAt: string
}

export interface AccountDetail {
  account: Account
  models: string[]
}

export interface AccountInput {
  type: string
  apiKey?: string
  /** 多 Key：兼容型写入同一条目由 CPA 轮询；Codex 等类型每个 Key 创建一个账号。 */
  apiKeys?: string[]
  baseUrl?: string
  name?: string
  models?: string[]
  group?: string
  tags?: string[]
  priority?: number
  ua?: string
}

export interface SyncResult {
  accounts: number
  models: number
  newPending: number
  enforced: number
  removed: number
  errors?: string[]
}

export interface ModelStatusRow {
  accountKey: string
  accountType: string
  accountName: string
  model: string
  alias: string
  status: ReviewStatus
  firstSeenAt: string
  updatedAt: string
  available: boolean
}

export interface ModelListResp {
  rows: ModelStatusRow[]
  counts: Record<string, number>
}

export interface AccountModelAliasRow {
  name: string
  alias: string
  suggestedAlias: string
  excluded: boolean
}

export interface AccountModelsDetail {
  account: Account
  supportsAlias: boolean
  models: AccountModelAliasRow[]
}

export interface LibraryRow {
  model: string
  alias?: string
  accountKey: string
  accountName: string
  accountType: string
}

export interface ChangeRecord {
  id: number
  accountKey: string
  accountType: string
  accountName: string
  model: string
  action: 'discovered' | 'approved' | 'rejected' | 'restored' | 'removed'
  createdAt: string
}

export interface Settings {
  baseUrl: string
  hasKey: boolean
  keyMasked: string
  autoSync: boolean
  intervalSec: number
  defaultUA: string
  connAuto: boolean
  connIntervalSec: number
}

export interface RuntimeStatus {
  configured: boolean
  syncing: boolean
  lastSyncAt?: string
  lastError?: string
  counts: Record<string, number>
}

export interface SyncResp {
  accounts: number
  models: number
  newPending: number
  enforced: number
  removed: number
  errors?: string[]
}
