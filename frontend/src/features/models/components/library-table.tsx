import { useMemo } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'
import { formatDateTime } from '@/lib/utils'
import type { ModelStatusRow } from '@/lib/types'
import { TypeBadge } from '@/components/shared/type-icon'

export interface LibraryGroup {
  model: string
  alias: string
  accounts: ModelStatusRow[]
  approved: number
  pending: number
  rejected: number
  firstSeenAt: string
}

/** 按模型聚合：展示该模型的全部提供账号（自动关联映射）。 */
export function groupLibrary(rows: ModelStatusRow[]): LibraryGroup[] {
  const map = new Map<string, ModelStatusRow[]>()
  for (const r of rows) {
    const list = map.get(r.model) ?? []
    list.push(r)
    map.set(r.model, list)
  }
  return [...map.entries()].map(([model, accounts]) => {
    const alias = accounts.find((a) => a.alias && a.alias !== a.model)?.alias ?? ''
    const firstSeen = accounts.map((a) => a.firstSeenAt).sort()[0] ?? ''
    return {
      model,
      alias,
      accounts,
      approved: accounts.filter((a) => a.status === 'approved').length,
      pending: accounts.filter((a) => a.status === 'pending').length,
      rejected: accounts.filter((a) => a.status === 'rejected').length,
      firstSeenAt: firstSeen,
    }
  })
}

export function LibraryTable({ groups }: { groups: LibraryGroup[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">{t('models.columns.model')}</TableHead>
            <TableHead>{t('models.columns.accounts')}</TableHead>
            <TableHead>{t('models.columns.status')}</TableHead>
            <TableHead className="pr-4">{t('models.columns.firstSeen')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRow key={g.model}>
              <TableCell className="max-w-72 pl-5">
                <div className="truncate font-mono text-[13px] font-medium">{g.model}</div>
                {g.alias && (
                  <div className="truncate font-mono text-[11px] text-muted-foreground">→ {g.alias}</div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex max-w-md flex-wrap items-center gap-1.5">
                  {g.accounts.map((a) => (
                    <Tooltip key={a.accountKey}>
                      <TooltipTrigger asChild>
                        <span
                          className={`inline-flex max-w-52 cursor-default items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                            a.available ? '' : 'opacity-50'
                          }`}
                        >
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${
                              a.status === 'approved'
                                ? 'bg-success'
                                : a.status === 'pending'
                                  ? 'bg-warning'
                                  : 'bg-destructive'
                            }`}
                          />
                          <span className="truncate">{a.accountName}</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <div>{a.accountName}</div>
                          <TypeBadge type={a.accountType} className="text-primary-foreground" />
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  {g.approved > 0 && <Badge variant="success">{t('review.approved')} {g.approved}</Badge>}
                  {g.pending > 0 && <Badge variant="warning">{t('review.pending')} {g.pending}</Badge>}
                  {g.rejected > 0 && <Badge variant="destructive">{t('review.rejected')} {g.rejected}</Badge>}
                  {g.approved === 0 && g.pending === 0 && g.rejected === 0 && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="pr-4 whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(g.firstSeenAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
