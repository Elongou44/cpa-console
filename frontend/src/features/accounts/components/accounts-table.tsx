import { Loader2, MoreHorizontal, Pencil, ScanEye, Trash2, Power } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'
import { cn, formatDateTime } from '@/lib/utils'
import type { Account } from '@/lib/types'
import { AccountStatusBadge } from '@/components/shared/review'
import { TypeBadge } from '@/components/shared/type-icon'

export interface AccountRowActions {
  onEdit: (account: Account) => void
  onReview: (account: Account) => void
  onDelete: (account: Account) => void
  onToggle: (account: Account) => void
  onAutoSync: (account: Account) => void
  onCheckConn: (account: Account) => void
  onToggleDisabled: (account: Account) => void
}

/** 账号表格。 */
export function AccountsTable({
  accounts,
  actions,
  connChecking,
}: {
  accounts: Account[]
  actions: AccountRowActions
  /** 正在进行连通性检测的账号标识。 */
  connChecking?: Set<string>
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">{t('accounts.columns.name')}</TableHead>
            <TableHead>{t('accounts.columns.type')}</TableHead>
            <TableHead>{t('accounts.columns.baseUrl')}</TableHead>
            <TableHead>{t('accounts.columns.apiKey')}</TableHead>
            <TableHead>{t('accounts.columns.status')}</TableHead>
            <TableHead className="text-center">{t('accounts.connColumn')}</TableHead>
            <TableHead className="text-right">{t('accounts.columns.models')}</TableHead>
            <TableHead className="text-right">{t('accounts.columns.excluded')}</TableHead>
            <TableHead className="text-center">{t('accounts.columns.autoSync')}</TableHead>
            <TableHead className="w-14 pr-4 text-right">{t('accounts.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.key}>
              <TableCell className="max-w-64 pl-5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{account.name}</span>
                  {account.group && (
                    <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
                      {account.group}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                    {account.kind === 'oauth' ? account.authFile : account.apiKeyMasked}
                  </span>
                  {(account.tags ?? []).slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline" className="h-4 shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground">
                      {tag}
                    </Badge>
                  ))}
                  {(account.tags?.length ?? 0) > 2 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground">
                          +{(account.tags?.length ?? 0) - 2}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{account.tags?.slice(2).join('、')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <TypeBadge type={account.type} />
                  {!!account.priority && account.priority > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[10px] font-normal">
                          P{account.priority}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{t('accounts.dialog.priority')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-44">
                {account.baseUrl ? (
                  <Tooltip>
                    <TooltipTrigger className="block max-w-full cursor-default truncate font-mono text-xs text-muted-foreground">
                      {account.baseUrl}
                    </TooltipTrigger>
                    <TooltipContent>{account.baseUrl}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {account.kind === 'oauth' ? (
                  <span className="text-muted-foreground/60">—</span>
                ) : (
                  <span>
                    {account.apiKeyMasked}
                    {(account.keyCount ?? 1) > 1 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-1 cursor-default rounded bg-muted/60 px-1 text-[10px]">
                            +{(account.keyCount ?? 1) - 1}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{t('accounts.moreKeys', { count: account.keyCount ?? 1 })}</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {account.kind === 'oauth' ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!account.disabled}
                      onCheckedChange={() => actions.onToggle(account)}
                      disabled={account.status === 'error'}
                    />
                    <AccountStatusBadge status={account.status} />
                  </div>
                ) : account.type === 'openai-compatibility' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="cursor-pointer" onClick={() => actions.onToggleDisabled(account)}>
                        <AccountStatusBadge status={account.status} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {account.disabled ? t('accounts.clickEnable') : t('accounts.clickDisable')}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <AccountStatusBadge status={account.status} />
                )}
              </TableCell>
              <TableCell className="text-center">
                {account.kind === 'oauth' ? (
                  <span className="text-muted-foreground/60">—</span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex cursor-pointer items-center justify-center gap-1.5 disabled:opacity-50"
                        disabled={connChecking?.has(account.key)}
                        onClick={() => actions.onCheckConn(account)}
                      >
                        {connChecking?.has(account.key) ? (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                        ) : account.conn ? (
                          account.conn.ok ? (
                            <>
                              <span className="size-2 rounded-full bg-success shadow-[0_0_5px] shadow-success/70" />
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {account.conn.latencyMs}ms
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="size-2 rounded-full bg-destructive shadow-[0_0_5px] shadow-destructive/60" />
                              <span className="text-[11px] text-muted-foreground">{t('accounts.connFail')}</span>
                            </>
                          )
                        ) : (
                          <>
                            <span className="size-2 rounded-full border border-muted-foreground/50" />
                            <span className="text-[11px] text-muted-foreground">{t('accounts.connUntested')}</span>
                          </>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {account.conn ? (
                        account.conn.ok ? (
                          t('accounts.connTipOk', {
                            models: account.conn.models,
                            latency: account.conn.latencyMs,
                            time: formatDateTime(account.conn.checkedAt),
                          })
                        ) : (
                          t('accounts.connTipFail', { error: account.conn.error ?? '', time: formatDateTime(account.conn.checkedAt) })
                        )
                      ) : (
                        t('accounts.connTipNever')
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default font-mono text-sm tabular-nums">
                        {account.approvedCount}
                        <span className="text-muted-foreground">/ {account.modelCount}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('accounts.modelsCountTip')}</TooltipContent>
                  </Tooltip>
                  {account.pendingCount > 0 && (
                    <Badge variant="warning" className="cursor-pointer" onClick={() => actions.onReview(account)}>
                      {t('accounts.pendingBadge', { count: account.pendingCount })}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="pr-4 text-right font-mono text-sm tabular-nums text-muted-foreground">
                {account.excludedCount > 0 ? account.excludedCount : <span className="text-muted-foreground/50">0</span>}
              </TableCell>
              <TableCell className="text-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => actions.onAutoSync(account)}
                      className={cn(
                        'inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition-colors',
                        account.autoSync
                          ? 'border-success/40 bg-success/10 text-success hover:bg-success/20'
                          : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span className={cn('size-1.5 rounded-full', account.autoSync ? 'bg-success' : 'bg-muted-foreground/60')} />
                      {account.autoSync ? t('accounts.autoSyncOnBadge') : t('accounts.autoSyncOffBadge')}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('accounts.autoSyncHint')}</TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="flex items-center justify-end gap-1">
                  {account.kind === 'key' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" onClick={() => actions.onEdit(account)}>
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('common.edit')}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="relative" onClick={() => actions.onReview(account)}>
                        <ScanEye className="size-4" />
                        {account.pendingCount > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-warning/20 bg-warning/15 px-0.5 text-[9px] font-medium leading-none text-warning">
                            {account.pendingCount}
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('accounts.review')}</TooltipContent>
                  </Tooltip>
                  {account.kind === 'key' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => actions.onDelete(account)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('common.delete')}</TooltipContent>
                    </Tooltip>
                  )}
                  {account.kind === 'oauth' && account.status !== 'error' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => actions.onToggle(account)}>
                          <Power className={account.disabled ? 'text-success' : 'text-orange-500'} />
                          {account.disabled ? t('accounts.enable') : t('accounts.disable')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
