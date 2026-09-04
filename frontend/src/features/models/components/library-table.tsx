import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'
import { cn, formatDateTime } from '@/lib/utils'
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => (
        <div key={g.model} className="flex flex-col gap-2 rounded-2xl border bg-card p-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-[13px] font-medium" title={g.model}>
                {g.model}
              </div>
              {g.alias && (
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={g.alias}>
                  → {g.alias}
                </div>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(g.firstSeenAt)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {g.approved > 0 && <Badge variant="success">{t('review.approved')} {g.approved}</Badge>}
            {g.pending > 0 && <Badge variant="warning">{t('review.pending')} {g.pending}</Badge>}
            {g.rejected > 0 && <Badge variant="destructive">{t('review.rejected')} {g.rejected}</Badge>}
            {g.approved === 0 && g.pending === 0 && g.rejected === 0 && (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-2">
            {g.accounts.map((a) => (
              <Tooltip key={a.accountKey}>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'inline-flex max-w-44 cursor-default items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                      !a.available && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        a.status === 'approved'
                          ? 'bg-success'
                          : a.status === 'pending'
                            ? 'bg-warning'
                            : 'bg-destructive',
                      )}
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
        </div>
      ))}
    </div>
  )
}
