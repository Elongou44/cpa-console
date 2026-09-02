import { Check, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/lib/i18n'
import { cn, formatDateTime } from '@/lib/utils'
import type { ModelStatusRow, ReviewStatus } from '@/lib/types'
import { AvailabilityDot, ReviewStatusBadge } from '@/components/shared/review'
import { TypeBadge } from '@/components/shared/type-icon'

export function rowId(r: { accountKey: string; model: string }): string {
  return `${r.accountKey}|${r.model}`
}

export interface ModelsTableActions {
  onApprove: (ids: string[]) => void
  onReject: (ids: string[]) => void
  onRestore: (ids: string[]) => void
}

/** 审批列表（待审批可选 / 已放行 / 已拒绝 共用）。 */
export function ModelsTable({
  rows,
  status,
  selectable,
  selected,
  onSelectedChange,
  actions,
}: {
  rows: ModelStatusRow[]
  status: ReviewStatus
  selectable?: boolean
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  actions: ModelsTableActions
}) {
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedChange(next)
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable && (
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={rows.length > 0 && rows.every((r) => selected.has(rowId(r)))}
                  onCheckedChange={(v) =>
                    onSelectedChange(v ? new Set(rows.map(rowId)) : new Set())
                  }
                />
              </TableHead>
            )}
            <TableHead className={cn(!selectable && 'pl-5')}>{t('models.columns.model')}</TableHead>
            <TableHead>{t('models.columns.accounts')}</TableHead>
            <TableHead>{t('models.columns.status')}</TableHead>
            <TableHead>{t('models.columns.available')}</TableHead>
            <TableHead>{t('models.columns.firstSeen')}</TableHead>
            <TableHead className="pr-4 text-right">{t('accounts.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const id = rowId(r)
            return (
              <TableRow key={id}>
                {selectable && (
                  <TableCell className="pl-4">
                    <Checkbox checked={selected.has(id)} onCheckedChange={() => toggle(id)} />
                  </TableCell>
                )}
                <TableCell className={cn('max-w-72', !selectable && 'pl-5')}>
                  <div className="truncate font-mono text-[13px] font-medium">{r.model}</div>
                  {r.alias && r.alias !== r.model && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">→ {r.alias}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="max-w-40 truncate text-[13px]">{r.accountName}</span>
                    <TypeBadge type={r.accountType} />
                  </div>
                </TableCell>
                <TableCell>
                  <ReviewStatusBadge status={status} />
                </TableCell>
                <TableCell>
                  <AvailabilityDot available={r.available} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(r.firstSeenAt)}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {r.status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-success hover:text-success"
                          onClick={() => actions.onApprove([id])}
                        >
                          <Check className="size-3" />
                          {t('review.approve')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => actions.onReject([id])}
                        >
                          <X className="size-3" />
                          {t('review.reject')}
                        </Button>
                      </>
                    )}
                    {r.status === 'approved' && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => actions.onReject([id])}>
                        <X className="size-3" />
                        {t('review.reject')}
                      </Button>
                    )}
                    {r.status === 'rejected' && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => actions.onRestore([id])}>
                        <RotateCcw className="size-3" />
                        {t('review.restore')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
