import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageBody, PageHeader } from '@/components/layout/page-header'
import { TypeBadge } from '@/components/shared/type-icon'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AccountModelAliasRow } from '@/lib/types'
import { useAccounts } from '@/features/accounts/data/hooks'
import { useAccountModelsDetail } from './data/hooks'

/** 别名映射：查看某账号在 CPA 中已加入的全部模型及其 alias。 */
export default function AliasesPage() {
  const accountsQuery = useAccounts({ q: '', status: [], type: '' })
  const accounts = useMemo(
    () => (accountsQuery.data?.accounts ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [accountsQuery.data],
  )
  const [accountKey, setAccountKey] = useState('')
  useEffect(() => {
    if ((!accountKey || !accounts.some((a) => a.key === accountKey)) && accounts.length > 0) {
      setAccountKey(accounts[0].key)
    }
  }, [accounts, accountKey])

  const [inputQ, setInputQ] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(inputQ), 300)
    return () => clearTimeout(id)
  }, [inputQ])

  const detailQuery = useAccountModelsDetail(accountKey)
  const rows = detailQuery.data?.models ?? []
  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(needle) || r.alias.toLowerCase().includes(needle),
    )
  }, [rows, q])
  const mapped = rows.filter((r) => r.alias).length

  const refresh = () => detailQuery.refetch()
  const refreshing = detailQuery.isFetching

  return (
    <div>
      <PageHeader title={t('aliases.title')} description={t('aliases.description')}>
        <Button variant="outline" size="sm" className="h-8" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('common.refresh')}
        </Button>
      </PageHeader>

      <PageBody className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:w-80">
            <Select value={accountKey} onValueChange={setAccountKey}>
              <SelectTrigger aria-label={t('aliases.selectAccount')}>
                <SelectValue placeholder={t('aliases.selectAccount')} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative w-full sm:w-64">
            <Input value={inputQ} onChange={(e) => setInputQ(e.target.value)} placeholder={t('aliases.search')} className="h-8" />
          </div>
          {detailQuery.data && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground sm:ml-auto">
              <TypeBadge type={detailQuery.data.account.type} />
              {t('aliases.summary', {
                total: rows.length,
                mapped,
                name: detailQuery.data.account.name,
              })}
            </span>
          )}
        </div>

        {detailQuery.data && !detailQuery.data.supportsAlias && (
          <div className="rounded-xl border border-dashed bg-card/60 px-4 py-2.5 text-xs text-muted-foreground">
            {t('aliases.noAliasSupport')}
          </div>
        )}

        {accountsQuery.isLoading || detailQuery.isLoading ? (
          <div className="rounded-2xl border bg-card p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="my-3 h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed bg-card/50 text-sm text-muted-foreground">
            {rows.length === 0 ? t('common.noData') : t('aliases.searchNoMatch')}
          </div>
        ) : (
          <AliasesTable rows={filtered} supportsAlias={detailQuery.data?.supportsAlias ?? false} />
        )}
      </PageBody>
    </div>
  )
}

function AliasesTable({ rows, supportsAlias }: { rows: AccountModelAliasRow[]; supportsAlias: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">{t('aliases.columns.model')}</TableHead>
            {supportsAlias && <TableHead>{t('aliases.columns.alias')}</TableHead>}
            {supportsAlias && <TableHead>{t('aliases.columns.suggested')}</TableHead>}
            <TableHead>{t('aliases.columns.kind')}</TableHead>
            <TableHead className="pr-5 text-right">{t('aliases.columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const custom = !!r.alias && r.alias !== r.suggestedAlias
            return (
              <TableRow key={r.name}>
                <TableCell className="max-w-80 pl-5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] font-medium">{r.name}</span>
                    {r.excluded && <Badge variant="warning" className="h-4 px-1.5 text-[10px]">{t('aliases.status.excluded')}</Badge>}
                  </div>
                </TableCell>
                {supportsAlias && (
                  <TableCell>
                    {r.alias ? (
                      <span className="font-mono text-[13px]">{r.alias}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('aliases.aliasNone')}</span>
                    )}
                  </TableCell>
                )}
                {supportsAlias && (
                  <TableCell>
                    <span className={cn('font-mono text-[13px]', !r.alias && r.suggestedAlias && 'text-muted-foreground')}>
                      {r.suggestedAlias || t('aliases.aliasNone')}
                    </span>
                  </TableCell>
                )}
                {supportsAlias && (
                  <TableCell>
                    {!r.alias ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : custom ? (
                      <Badge variant="secondary" className="h-5 px-2 text-[11px]">{t('aliases.kind.custom')}</Badge>
                    ) : (
                      <Badge variant="success" className="h-5 px-2 text-[11px]">{t('aliases.kind.standard')}</Badge>
                    )}
                  </TableCell>
                )}
                <TableCell className="pr-5 text-right">
                  {r.excluded ? (
                    <span className="text-xs text-warning">{t('aliases.status.excludedText')}</span>
                  ) : (
                    <span className="text-xs text-success">{t('aliases.status.joined')}</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
