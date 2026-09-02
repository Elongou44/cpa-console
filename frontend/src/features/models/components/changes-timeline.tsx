import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/lib/i18n'
import { timeAgo } from '@/lib/utils'
import type { ChangeRecord } from '@/lib/types'
import { ChangeActionBadge } from '@/components/shared/review'
import { TypeBadge } from '@/components/shared/type-icon'

/** 变更记录时间线：发现 / 放行 / 拒绝 / 恢复 / 移除。 */
export function ChangesTimeline({ records }: { records: ChangeRecord[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">{t('review.changes')}</TableHead>
            <TableHead>{t('models.columns.accounts')}</TableHead>
            <TableHead className="pr-4 text-right">{t('models.columns.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((rec) => (
            <TableRow key={rec.id}>
              <TableCell className="pl-5">
                <div className="flex items-center gap-2.5">
                  <ChangeActionBadge action={rec.action} />
                  <span className="font-mono text-[13px]">{rec.model}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="max-w-48 truncate text-[13px]">{rec.accountName}</span>
                  <TypeBadge type={rec.accountType} />
                </div>
              </TableCell>
              <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                {timeAgo(rec.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
