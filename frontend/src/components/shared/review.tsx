import { Badge } from '@/components/ui/badge'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AccountStatus, ReviewStatus } from '@/lib/types'

/** 审批状态徽标：pending 琥珀 / approved 绿 / rejected 红。 */
export function ReviewStatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const map: Record<ReviewStatus, { variant: 'warning' | 'success' | 'destructive'; label: string }> = {
    pending: { variant: 'warning', label: t('review.pending') },
    approved: { variant: 'success', label: t('review.approved') },
    rejected: { variant: 'destructive', label: t('review.rejected') },
  }
  const meta = map[status]
  return (
    <Badge variant={meta.variant} className={cn('gap-1', className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </Badge>
  )
}

/** 账号状态徽标。 */
export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const map: Record<AccountStatus, { variant: 'success' | 'muted' | 'destructive'; label: string }> = {
    enabled: { variant: 'success', label: t('common.enabled') },
    disabled: { variant: 'muted', label: t('common.disabled') },
    error: { variant: 'destructive', label: t('common.error') },
  }
  const meta = map[status]
  return (
    <Badge variant={meta.variant} className="gap-1">
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </Badge>
  )
}

/** 模型在线状态点：最近一次同步中该模型是否仍被发现。 */
export function AvailabilityDot({ available }: { available: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', available ? 'text-success' : 'text-muted-foreground')}>
      <span className={cn('size-1.5 rounded-full', available ? 'bg-success shadow-[0_0_4px] shadow-success/60' : 'bg-muted-foreground/40')} />
      {available ? t('models.available.yes') : t('models.available.no')}
    </span>
  )
}

/** 变更记录动作徽标。 */
export function ChangeActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    discovered: 'bg-info/10 text-info',
    approved: 'bg-success/10 text-success',
    rejected: 'bg-destructive/10 text-destructive',
    restored: 'bg-warning/10 text-warning',
    removed: 'bg-muted text-muted-foreground',
  }
  const labels: Record<string, string> = {
    discovered: t('review.action.discovered'),
    approved: t('review.action.approved'),
    rejected: t('review.action.rejected'),
    restored: t('review.action.restored'),
    removed: t('review.action.removed'),
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', map[action] ?? map.removed)}>
      {labels[action] ?? action}
    </span>
  )
}
