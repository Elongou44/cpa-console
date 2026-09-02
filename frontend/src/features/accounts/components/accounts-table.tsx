import { MoreHorizontal, Pencil, ScanEye, Trash2, Power } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'
import type { Account } from '@/lib/types'
import { AccountStatusBadge } from '@/components/shared/review'
import { TypeBadge } from '@/components/shared/type-icon'

export interface AccountRowActions {
  onEdit: (account: Account) => void
  onReview: (account: Account) => void
  onDelete: (account: Account) => void
  onToggle: (account: Account) => void
}

/** 账号表格。 */
export function AccountsTable({ accounts, actions }: { accounts: Account[]; actions: AccountRowActions }) {
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
            <TableHead className="text-right">{t('accounts.columns.models')}</TableHead>
            <TableHead className="text-right">{t('accounts.columns.excluded')}</TableHead>
            <TableHead className="w-14 pr-4 text-right">{t('accounts.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.key}>
              <TableCell className="max-w-56 pl-5">
                <div className="truncate font-medium">{account.name}</div>
                {account.kind === 'oauth' ? (
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{account.authFile}</div>
                ) : (
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{account.apiKeyMasked}</div>
                )}
              </TableCell>
              <TableCell>
                <TypeBadge type={account.type} />
              </TableCell>
              <TableCell className="max-w-52">
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
                {account.kind === 'oauth' ? <span className="text-muted-foreground/60">—</span> : account.apiKeyMasked}
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
                ) : (
                  <AccountStatusBadge status={account.status} />
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="font-mono text-sm tabular-nums">{account.modelCount}</span>
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
              <TableCell className="pr-4 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {account.kind === 'key' && (
                      <DropdownMenuItem onClick={() => actions.onEdit(account)}>
                        <Pencil />
                        {t('common.edit')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => actions.onReview(account)}>
                      <ScanEye />
                      {t('accounts.review')}
                      {account.pendingCount > 0 && (
                        <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px]">
                          {account.pendingCount}
                        </Badge>
                      )}
                    </DropdownMenuItem>
                    {account.kind === 'oauth' && account.status !== 'error' && (
                      <DropdownMenuItem onClick={() => actions.onToggle(account)}>
                        <Power className={account.disabled ? 'text-success' : 'text-orange-500'} />
                        {account.disabled ? t('accounts.enable') : t('accounts.disable')}
                      </DropdownMenuItem>
                    )}
                    {account.kind === 'key' && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => actions.onDelete(account)}>
                          <Trash2 />
                          {t('common.delete')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
