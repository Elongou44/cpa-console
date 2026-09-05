import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Activity, AlertTriangle, Loader2, Plus, RefreshCw } from 'lucide-react'
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
import { useAccounts, useCheckConnectivity, useDeleteAccount, useSetAutoSync, useToggleAuthFile, useToggleKeyDisabled } from './data/hooks'
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
  const [group, setGroup] = useState('')
  const [tags, setTags] = useState<string[]>([])

  const filters = useMemo(() => ({ q, status, type }), [q, status, type])
  const query = useAccounts(filters)
  // 类型 Tab 计数使用未按类型过滤的数据。
  const typesQuery = useAccounts({ ...filters, type: '' })

  const syncMutation = useSyncNow()
  const connMutation = useCheckConnectivity()
  const [connChecking, setConnChecking] = useState<Set<string>>(new Set())
  // keys 为空数组表示检测全部；带 keys 时仅重测指定账号（单行点击）。
  const checkConn = (accounts: Account[]) => {
    if (accounts.length === 0) return
    setConnChecking(new Set(accounts.map((a) => a.key)))
    connMutation.mutate(accounts.map((a) => a.key), { onSettled: () => setConnChecking(new Set()) })
  }
  const deleteMutation = useDeleteAccount()
  const toggleMutation = useToggleAuthFile()
  const autoSyncMutation = useSetAutoSync()
  const disabledMutation = useToggleKeyDisabled()

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
  const shown = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (!group || a.group === group) &&
          (tags.length === 0 || tags.some((tg) => a.tags?.includes(tg))),
      ),
    [accounts, group, tags],
  )
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

  // 全部已有分组名（不受类型/分组筛选影响），供下拉与输入建议。
  const groupNames = useMemo(() => {
    const set = new Set<string>()
    for (const a of typesQuery.data?.accounts ?? []) {
      if (a.group) set.add(a.group)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [typesQuery.data])

  // 全部已有标签名，供下拉与输入建议。
  const tagNames = useMemo(() => {
    const set = new Set<string>()
    for (const a of typesQuery.data?.accounts ?? []) {
      for (const tg of a.tags ?? []) set.add(tg)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [typesQuery.data])

  const filtered = q !== '' || status.length > 0 || type !== '' || group !== '' || tags.length > 0

  return (
    <div>
      <PageHeader title={t('accounts.title')} description={t('accounts.description')}>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => checkConn(typesQuery.data?.accounts ?? [])}
          disabled={connMutation.isPending}
        >
          {connMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
          {t('accounts.connCheck')}
        </Button>
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
          groups={groupNames}
          group={group}
          onGroupChange={(v) => setGroup(v === '__all__' ? '' : v)}
          tagOptions={tagNames}
          tags={tags}
          onTagsChange={setTags}
          filtered={filtered}
          onReset={() => {
            setInputQ('')
            setStatus([])
            setType('')
            setGroup('')
            setTags([])
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
            accounts={shown}
            actions={{
              onEdit: (a) => show('edit', a),
              onReview: (a) => show('review', a),
              onDelete: (a) => show('delete', a),
              onToggle: (a) => toggleMutation.mutate({ name: a.authFile!, disabled: !a.disabled }),
              onAutoSync: (a) => autoSyncMutation.mutate({ key: a.key, enabled: !a.autoSync }),
              onCheckConn: (a) => checkConn([a]),
              onToggleDisabled: (a) => disabledMutation.mutate({ key: a.key, disabled: !a.disabled }),
            }}
            connChecking={connChecking}
          />
        )}

        {open === 'add' && (
          <AccountActionDialog open onOpenChange={(v) => (v ? null : close())} account={null} groups={groupNames} tagSuggestions={tagNames} />
        )}
        {open === 'edit' && current && (
          <AccountActionDialog open onOpenChange={(v) => (v ? null : close())} account={current} groups={groupNames} tagSuggestions={tagNames} />
        )}
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
