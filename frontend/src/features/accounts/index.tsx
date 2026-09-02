import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PageBody, PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n'
import type { Account } from '@/lib/types'
import { useSyncNow } from '@/lib/sync'
import { useAccounts, useDeleteAccount, useSetAutoSync, useToggleAuthFile } from './data/hooks'
import { AccountsTypeTabs, type TypeTab } from './components/type-tabs'
import { AccountsToolbar } from './components/accounts-toolbar'
import { AccountsTable } from './components/accounts-table'
import { AccountActionDialog } from './components/account-action-dialog'
import { AccountReviewDialog } from './components/account-review-dialog'

type DialogKind = 'add' | 'edit' | 'delete' | 'review' | null

/** 账号总览页（复刻 axonhub 渠道页结构）。 */
export default function AccountsPage() {
  const [inputQ, setInputQ] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(inputQ), 300)
    return () => clearTimeout(id)
  }, [inputQ])
  const [status, setStatus] = useState<string[]>([])
  const [type, setType] = useState('')

  const filters = useMemo(() => ({ q, status, type }), [q, status, type])
  const query = useAccounts(filters)
  // 类型 Tab 计数使用未按类型过滤的数据。
  const typesQuery = useAccounts({ ...filters, type: '' })

  const syncMutation = useSyncNow()
  const deleteMutation = useDeleteAccount()
  const toggleMutation = useToggleAuthFile()
  const autoSyncMutation = useSetAutoSync()

  const [open, setOpen] = useState<DialogKind>(null)
  const [current, setCurrent] = useState<Account | null>(null)
  const show = (kind: DialogKind, account: Account | null) => {
    setCurrent(account)
    setOpen(kind)
  }
  const close = () => {
    setOpen(null)
    setTimeout(() => setCurrent(null), 400)
  }

  const accounts = query.data?.accounts ?? []
  const tabs = useMemo<TypeTab[]>(() => {
    const counts = new Map<string, number>()
    for (const a of typesQuery.data?.accounts ?? []) {
      counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 9)
  }, [typesQuery.data])

  const filtered = q !== '' || status.length > 0 || type !== ''

  return (
    <div>
      <PageHeader title={t('accounts.title')} description={t('accounts.description')}>
        <Button variant="outline" size="sm" className="h-8" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('common.sync')}
        </Button>
        <Button size="sm" className="h-8" onClick={() => show('add', null)}>
          <Plus className="size-4" />
          {t('accounts.addTab')}
        </Button>
      </PageHeader>

      <PageBody className="space-y-3">
        {query.isError && (
          <Alert variant="warning" className="border-warning/40 bg-warning/10 text-warning">
            <AlertTriangle className="size-4" />
            <AlertTitle className="text-warning">{t('accounts.title')}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-warning/90">
              <span>{t('accounts.errorBanner.text', { message: (query.error as Error).message })}</span>
              <span className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7" onClick={() => query.refetch()}>
                  {t('common.retry')}
                </Button>
                <Link to="/settings">
                  <Button variant="outline" size="sm" className="h-7">
                    {t('accounts.errorBanner.gotoSettings')}
                  </Button>
                </Link>
              </span>
            </AlertDescription>
          </Alert>
        )}

        <AccountsTypeTabs tabs={tabs} value={type} onChange={setType} />

        <AccountsToolbar
          q={inputQ}
          onQChange={setInputQ}
          status={status}
          onStatusChange={setStatus}
          filtered={filtered}
          onReset={() => {
            setInputQ('')
            setStatus([])
            setType('')
          }}
        />

        {query.isLoading ? (
          <div className="rounded-2xl border bg-card p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="my-3 h-10 w-full" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed bg-card/50 text-sm text-muted-foreground">
            {t('common.noData')}
          </div>
        ) : (
          <AccountsTable
            accounts={accounts}
            actions={{
              onEdit: (a) => show('edit', a),
              onReview: (a) => show('review', a),
              onDelete: (a) => show('delete', a),
              onToggle: (a) => toggleMutation.mutate({ name: a.authFile!, disabled: !a.disabled }),
              onAutoSync: (a) => autoSyncMutation.mutate({ key: a.key, enabled: !a.autoSync }),
            }}
          />
        )}

        {open === 'add' && <AccountActionDialog open onOpenChange={(v) => (v ? null : close())} account={null} />}
        {open === 'edit' && current && <AccountActionDialog open onOpenChange={(v) => (v ? null : close())} account={current} />}
        {open === 'review' && current && <AccountReviewDialog open onOpenChange={(v) => (v ? null : close())} account={current} />}

        <AlertDialog open={open === 'delete'} onOpenChange={(v) => (v ? null : close())}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('common.delete')}「{current?.name}」?</AlertDialogTitle>
              <AlertDialogDescription>
                将从 CPA 中移除该账号，其关联的待审批/审批记录与屏蔽清单会同步清理。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault()
                  if (current) deleteMutation.mutate(current.key, { onSuccess: close })
                }}
              >
                {deleteMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                {t('common.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageBody>
    </div>
  )
}
