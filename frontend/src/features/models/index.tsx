import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, RefreshCw, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageBody, PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ModelStatusRow, ReviewStatus } from '@/lib/types'
import { useSyncNow } from '@/lib/sync'
import { useChanges, useModels, useReviewAction } from './data/hooks'
import { ModelsTable, rowId, type ModelsTableActions } from './components/models-table'
import { groupLibrary, LibraryTable } from './components/library-table'
import { ChangesTimeline } from './components/changes-timeline'

/** 模型审批中心 + 模型库。 */
export default function ModelsPage() {
  const [inputQ, setInputQ] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(inputQ), 300)
    return () => clearTimeout(id)
  }, [inputQ])

  const [tab, setTab] = useState('pending')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [account, setAccount] = useState('')
  const [availability, setAvailability] = useState('')

  const query = useModels({ q })
  const changesQuery = useChanges(undefined, tab === 'changes')
  const syncMutation = useSyncNow()
  const approveMutation = useReviewAction('approve')
  const rejectMutation = useReviewAction('reject')
  const restoreMutation = useReviewAction('restore')

  const rows = query.data?.rows ?? []
  // 筛选：账号 + 在线状态（q 已在服务端过滤），Tab 计数与列表共用同一份筛选结果
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!account || r.accountKey === account) &&
          (availability === '' || (availability === 'yes' ? r.available : !r.available)),
      ),
    [rows, account, availability],
  )
  const accountOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.accountKey, r.accountName)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])
  const pending = useMemo(() => filtered.filter((r) => r.status === 'pending'), [filtered])
  const approved = useMemo(() => filtered.filter((r) => r.status === 'approved'), [filtered])
  const rejected = useMemo(() => filtered.filter((r) => r.status === 'rejected'), [filtered])
  const library = useMemo(
    () =>
      groupLibrary(filtered).sort((a, b) => {
        if (a.pending !== b.pending) return b.pending - a.pending
        if (a.approved !== b.approved) return b.approved - a.approved
        return a.model.localeCompare(b.model)
      }),
    [filtered],
  )

  const actions: ModelsTableActions = {
    onApprove: (ids) => approveMutation.mutate(ids),
    onReject: (ids) => rejectMutation.mutate(ids),
    onRestore: (ids) => restoreMutation.mutate(ids),
  }

  const currentRows: ModelStatusRow[] = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected
  const currentStatus: ReviewStatus = tab === 'pending' ? 'pending' : tab === 'approved' ? 'approved' : 'rejected'

  const bulk = (action: (ids: string[]) => void) => {
    action([...selected])
    setSelected(new Set())
  }

  return (
    <div>
      <PageHeader title={t('models.title')} description={t('models.description')}>
        <Button variant="outline" size="sm" className="h-8" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('common.sync')}
        </Button>
      </PageHeader>

      <PageBody className="space-y-3">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelected(new Set()) }}>
          <TabsList className="h-9">
            <TabsTrigger value="pending">
              {t('review.pending')}
              <Badge variant="warning" className="ml-1 h-4 px-1.5 text-[10px]">
                {pending.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="approved">{t('review.approved')}</TabsTrigger>
            <TabsTrigger value="rejected">{t('review.rejected')}</TabsTrigger>
            <TabsTrigger value="library">{t('models.library')}</TabsTrigger>
            <TabsTrigger value="changes">{t('review.changes')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab !== 'changes' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={inputQ} onChange={(e) => setInputQ(e.target.value)} placeholder={t('common.search')} className="h-8 pl-8" />
            </div>

            <Select value={account} onValueChange={(v) => setAccount(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue placeholder={t('models.filter.account')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('models.filter.allAccounts')}</SelectItem>
                {accountOptions.map(([key, name]) => (
                  <SelectItem key={key} value={key}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={availability} onValueChange={(v) => setAvailability(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue placeholder={t('models.filter.availability')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('common.all')}</SelectItem>
                <SelectItem value="yes">{t('models.available.yes')}</SelectItem>
                <SelectItem value="no">{t('models.available.no')}</SelectItem>
              </SelectContent>
            </Select>

            {(inputQ !== '' || account !== '' || availability !== '') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => {
                  setInputQ('')
                  setAccount('')
                  setAvailability('')
                }}
              >
                <RotateCcw className="size-3.5" />
                {t('common.reset')}
              </Button>
            )}
          </div>
        )}

        {query.isLoading ? (
          <div className="rounded-2xl border bg-card p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="my-3 h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            {(tab === 'pending' || tab === 'approved' || tab === 'rejected') &&
              (currentRows.length === 0 ? (
                <EmptyHint />
              ) : (
                <ModelsTable
                  rows={currentRows}
                  status={currentStatus}
                  selectable={tab === 'pending'}
                  selected={selected}
                  onSelectedChange={setSelected}
                  actions={actions}
                />
              ))}

            {tab === 'library' && (library.length === 0 ? <EmptyHint /> : <LibraryTable groups={library} />)}

            {tab === 'changes' &&
              (changesQuery.data?.records?.length ? (
                <ChangesTimeline records={changesQuery.data.records} />
              ) : (
                <EmptyHint />
              ))}
          </>
        )}

        {/* 批量审批浮动条 */}
        {tab === 'pending' && selected.size > 0 && (
          <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 animate-fade-in-up items-center gap-2 rounded-full border bg-card py-1.5 pl-4 pr-1.5 shadow-lg">
            <span className="text-sm font-medium">{t('review.bulkBar', { count: selected.size })}</span>
            <Button size="sm" className="h-7 rounded-full" onClick={() => bulk(actions.onApprove)}>
              <Check className="size-3.5" />
              {t('review.approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-destructive hover:text-destructive"
              onClick={() => bulk(actions.onReject)}
            >
              <X className="size-3.5" />
              {t('review.reject')}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </PageBody>
    </div>
  )
}

function EmptyHint() {
  return (
    <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed bg-card/50 text-sm text-muted-foreground">
      {t('common.noData')}
    </div>
  )
}
