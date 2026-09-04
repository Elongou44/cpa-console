import { useMemo } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'
import { cn, formatDateTime } from '@/lib/utils'
import type { ModelStatusRow, ReviewStatus } from '@/lib/types'
import { TypeBadge } from '@/components/shared/type-icon'

export function rowId(r: { accountKey: string; model: string }): string {
  return `${r.accountKey}|${r.model}`
}

export interface ModelsTableActions {
  onApprove: (ids: string[]) => void
  onReject: (ids: string[]) => void
  onRestore: (ids: string[]) => void
}

interface ModelGroup {
  model: string
  alias: string
  rows: ModelStatusRow[]
  firstSeenAt: string
}

/** 按模型聚合：同名模型在多个账号上的记录合并为一行，避免长列表。 */
function groupByModel(rows: ModelStatusRow[]): ModelGroup[] {
  const map = new Map<string, ModelStatusRow[]>()
  for (const r of rows) {
    const list = map.get(r.model) ?? []
    list.push(r)
    map.set(r.model, list)
  }
  return [...map.entries()]
    .map(([model, list]) => ({
      model,
      alias: list.find((a) => a.alias && a.alias !== model)?.alias ?? '',
      rows: list,
      firstSeenAt: list.map((a) => a.firstSeenAt).sort()[0] ?? '',
    }))
    .sort((a, b) => a.model.localeCompare(b.model))
}

/** 审批列表（待审批可选 / 已放行 / 已拒绝 共用）：一行一个模型，提供账号以 chips 展示。 */
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
  const groups = useMemo(() => groupByModel(rows), [rows])

  const toggleGroup = (g: ModelGroup) => {
    const ids = g.rows.map(rowId)
    const next = new Set(selected)
    const allIn = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (allIn) next.delete(id)
      else next.add(id)
    }
    onSelectedChange(next)
  }

  const groupAction = (g: ModelGroup, action: (ids: string[]) => void) => action(g.rows.map(rowId))

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable && (
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={groups.length > 0 && groups.every((g) => g.rows.every((r) => selected.has(rowId(r))))}
                  onCheckedChange={(v) => onSelectedChange(v ? new Set(rows.map(rowId)) : new Set())}
                />
              </TableHead>
            )}
            <TableHead className={cn(!selectable && 'pl-5')}>{t('models.columns.model')}</TableHead>
            <TableHead>{t('models.columns.accounts')}</TableHead>
            <TableHead>{t('models.columns.firstSeen')}</TableHead>
            <TableHead className="pr-4 text-right">{t('accounts.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const ids = g.rows.map(rowId)
            const allIn = ids.every((id) => selected.has(id))
            return (
              <TableRow key={g.model}>
                {selectable && (
                  <TableCell className="pl-4">
                    <Checkbox checked={allIn} onCheckedChange={() => toggleGroup(g)} />
                  </TableCell>
                )}
                <TableCell className={cn('max-w-72', !selectable && 'pl-5')}>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[13px] font-medium">{g.model}</span>
                    <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                      {g.rows.length}
                    </Badge>
                  </div>
                  {g.alias && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">→ {g.alias}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-md flex-wrap items-center gap-1.5">
                    {g.rows.map((a) => (
                      <Tooltip key={rowId(a)}>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              'inline-flex max-w-52 cursor-default items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
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
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(g.firstSeenAt)}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-success hover:text-success"
                          onClick={() => groupAction(g, actions.onApprove)}
                        >
                          <Check className="size-3" />
                          {t('review.approveAll')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => groupAction(g, actions.onReject)}
                        >
                          <X className="size-3" />
                          {t('review.rejectAll')}
                        </Button>
                      </>
                    )}
                    {status === 'approved' && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => groupAction(g, actions.onReject)}>
                        <X className="size-3" />
                        {t('review.reject')}
                      </Button>
                    )}
                    {status === 'rejected' && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => groupAction(g, actions.onRestore)}>
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
