/** 与后端 REST API 对齐的类型定义。 */

export type AccountKind = 'key' | 'oauth'
export type AccountStatus = 'enabled' | 'disabled' | 'error'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface Account {
  key: string
  kind: AccountKind
  type: string
  name: string
  apiKeyMasked?: string
  baseUrl?: string
  status: AccountStatus
  disabled: boolean
  autoSync: boolean
  provider?: string
  authFile?: string
  modelCount: number
  pendingCount: number
  excludedCount: number
  successCount: number
  failureCount: number
}

export interface AccountDetail {
  account: Account
  models: string[]
}

export interface AccountInput {
  type: string
  apiKey?: string
  baseUrl?: string
  name?: string
  models?: string[]
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
