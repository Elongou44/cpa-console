import { useState } from 'react'
import { Check, Loader2, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { t } from '@/lib/i18n'
import { cn, timeAgo } from '@/lib/utils'
import type { Account } from '@/lib/types'
import { AvailabilityDot, ChangeActionBadge } from '@/components/shared/review'
import { useChanges, useModels, useReviewAction } from '@/features/models/data/hooks'

/** 账号级模型审批弹窗（复刻 axonhub 模型审核）：待审批 / 已拒绝 / 已放行 / 变更记录。 */
export function AccountReviewDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
}) {
  const modelsQuery = useModels({ account: account?.key ?? '' }, open && !!account)
  const changesQuery = useChanges(account?.key, open && !!account)
  const approveMutation = useReviewAction('approve')
  const rejectMutation = useReviewAction('reject')
  const restoreMutation = useReviewAction('restore')
  const [busy, setBusy] = useState<string | null>(null)

  const rows = modelsQuery.data?.rows ?? []
  const pending = rows.filter((r) => r.status === 'pending')
  const rejected = rows.filter((r) => r.status === 'rejected')
  const approved = rows.filter((r) => r.status === 'approved')
  const records = changesQuery.data?.records ?? []

  const run = (ids: string[], action: (ids: string[]) => void, tag: string) => {
    if (ids.length === 0) return
    setBusy(tag)
    action(ids)
    // 审批为乐观更新，busy 仅作短暂防抖。
    setTimeout(() => setBusy(null), 300)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('accounts.review.title', { name: account?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('accounts.review.description')}</DialogDescription>
        </DialogHeader>

        {/* 待审批 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('review.pending')}</h3>
              <Badge variant="warning">{pending.length}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={pending.length === 0 || approveMutation.isPending}
                onClick={() => run(pending.map((r) => rowId(r)), (ids) => approveMutation.mutate(ids), '__all__')}
              >
                <Check className="size-3.5" />
                {t('review.approveAll')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending.length === 0 || rejectMutation.isPending}
                onClick={() => run(pending.map((r) => rowId(r)), (ids) => rejectMutation.mutate(ids), '__allr__')}
              >
                <X className="size-3.5" />
                {t('review.rejectAll')}
              </Button>
            </div>
          </div>
          {pending.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              {t('review.empty')}
            </p>
          ) : (
            <ScrollArea className="max-h-52 rounded-lg border">
              <div className="divide-y">
                {pending.map((r) => (
                  <div key={r.model} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.model}</span>
                    <AvailabilityDot available={r.available} />
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(r.firstSeenAt)}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs text-success hover:text-success"
                      disabled={busy !== null}
                      onClick={() => run([rowId(r)], (ids) => approveMutation.mutate(ids), r.model)}
                    >
                      {busy === r.model ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      {t('review.approve')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      disabled={busy !== null}
                      onClick={() => run([rowId(r)], (ids) => rejectMutation.mutate(ids), `r-${r.model}`)}
                    >
                      <X className="size-3" />
                      {t('review.reject')}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>

        {/* 已拒绝 */}
        {rejected.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('review.rejected')}</h3>
              <Badge variant="secondary">{rejected.length}</Badge>
            </div>
            <ScrollArea className="max-h-36 rounded-lg border">
              <div className="divide-y">
                {rejected.map((r) => (
                  <div key={r.model} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground line-through decoration-destructive/40">
                      {r.model}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => run([rowId(r)], (ids) => restoreMutation.mutate(ids), `s-${r.model}`)}
                    >
                      <RotateCcw className="size-3" />
                      {t('review.restore')}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>
        )}

        {/* 已放行 */}
        {approved.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('review.approved')}</h3>
              <Badge variant="secondary">{approved.length}</Badge>
            </div>
            <ScrollArea className="max-h-52 rounded-lg border">
              <div className="flex flex-wrap gap-1.5 p-2.5">
                {approved.map((r) => (
                  <span key={r.model} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                    {r.model}
                  </span>
                ))}
              </div>
            </ScrollArea>
          </section>
        )}

        <Separator />

        {/* 变更记录 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('review.changes')}</h3>
          <ScrollArea className="max-h-40 rounded-lg border">
            <div className="divide-y">
              {records.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('common.noData')}</p>
              )}
              {records.map((rec) => (
                <div key={rec.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <ChangeActionBadge action={rec.action} />
                  <span className="min-w-0 flex-1 truncate font-mono">{rec.model}</span>
                  <span className="shrink-0 text-muted-foreground">{timeAgo(rec.createdAt)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </section>
      </DialogContent>
    </Dialog>
  )
}

function rowId(r: { accountKey: string; model: string }): string {
  return `${r.accountKey}|${r.model}`
}
