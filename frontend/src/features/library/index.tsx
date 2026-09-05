import { useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageBody, PageHeader } from '@/components/layout/page-header'
import { TypeIcon, typeLabel } from '@/components/shared/type-icon'
import { t } from '@/lib/i18n'
import type { LibraryRow } from '@/lib/types'
import { useLibrary, useRemoveLibraryModel } from './data/hooks'

interface LibraryGroup {
  model: string
  providers: LibraryRow[]
}

const ALL = '__all__'

/** 模型库：跨账号聚合当前已加入 CPA 的模型，展示提供方并支持快捷移除。 */
export default function LibraryPage() {
  const [inputQ, setInputQ] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState(ALL)
  const [provider, setProvider] = useState(ALL)
  const [sort, setSort] = useState<'providers' | 'name'>('providers')

  const query = useLibrary()
  const removeMutation = useRemoveLibraryModel()

  const rows = query.data?.rows ?? []

  // 统计概览：模型数 / 参与账号数 / 覆盖类型
  const stats = useMemo(() => {
    const models = new Set<string>()
    const accounts = new Set<string>()
    const types = new Set<string>()
    for (const r of rows) {
      models.add(r.model)
      accounts.add(r.accountKey)
      types.add(r.accountType)
    }
    return { models: models.size, accounts: accounts.size, types: [...types].sort() }
  }, [rows])

  const providerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.accountKey, r.accountName)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const groups = useMemo(() => {
    const map = new Map<string, LibraryRow[]>()
    for (const r of rows) {
      const list = map.get(r.model) ?? []
      list.push(r)
      map.set(r.model, list)
    }
    return [...map.entries()].map(([model, providers]) => ({
      model,
      providers: providers.sort((a, b) => a.accountName.localeCompare(b.accountName)),
    }))
  }, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = groups
      .filter((g) => {
        if (type !== ALL && !g.providers.some((p) => p.accountType === type)) return false
        if (provider !== ALL && !g.providers.some((p) => p.accountKey === provider)) return false
        if (!needle) return true
        return (
          g.model.toLowerCase().includes(needle) ||
          g.providers.some(
            (p) => p.accountName.toLowerCase().includes(needle) || (p.alias ?? '').toLowerCase().includes(needle),
          )
        )
      })
      .map((g) => ({
        ...g,
        // 类型/提供方筛选后，卡片内仅显示匹配的提供方
        providers: g.providers.filter(
          (p) => (type === ALL || p.accountType === type) && (provider === ALL || p.accountKey === provider),
        ),
      }))
    return sort === 'name'
      ? [...filtered].sort((a, b) => a.model.localeCompare(b.model))
      : [...filtered].sort((a, b) => b.providers.length - a.providers.length || a.model.localeCompare(b.model))
  }, [groups, q, type, provider, sort])

  const statItems = [
    { value: stats.models, label: t('library.statModels') },
    { value: stats.accounts, label: t('library.statAccounts') },
    { value: stats.types.length, label: t('library.statTypes') },
  ]

  return (
    <div>
      <PageHeader title={t('library.title')} description={t('library.description')}>
        <Button variant="outline" size="sm" className="h-8" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('common.refresh')}
        </Button>
      </PageHeader>

      <PageBody className="space-y-3">
        {/* 统计概览 */}
        <div className="flex flex-wrap gap-2">
          {statItems.map((s) => (
            <div
              key={s.label}
              className="flex min-w-28 flex-1 items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-sm"
            >
              <span className="text-xl font-semibold leading-none tabular-nums">{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>

        {/* 筛选与排序 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={inputQ} onChange={(e) => setInputQ(e.target.value)} placeholder={t('common.search')} className="h-8 pl-8" />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('library.filterAllTypes')}</SelectItem>
              {stats.types.map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {typeLabel(tp)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('library.filterAllProviders')}</SelectItem>
              {providerOptions.map(([key, name]) => (
                <SelectItem key={key} value={key}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as 'providers' | 'name')}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="providers">{t('library.sortProviders')}</SelectItem>
              <SelectItem value="name">{t('library.sortName')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed bg-card/50 text-sm text-muted-foreground">
            {rows.length > 0 ? t('library.noMatch') : t('library.empty')}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((g) => (
              <div key={g.model} className="flex flex-col gap-2 rounded-2xl border bg-card p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[13px] font-medium" title={g.model}>
                      {g.model}
                    </div>
                    {g.providers.length > 0 && g.providers[0].alias && (
                      <div className="truncate font-mono text-[11px] text-muted-foreground">→ {g.providers[0].alias}</div>
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {t('library.providers', { count: g.providers.length })}
                  </Badge>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-2">
                  {g.providers.map((p) => (
                    <span
                      key={p.accountKey}
                      className="group inline-flex max-w-44 cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    >
                      <TypeIcon type={p.accountType} className="size-3.5" />
                      <span
                        className="truncate"
                        title={p.alias && p.alias !== p.model ? `${p.accountName} → ${p.alias}` : p.accountName}
                      >
                        {p.accountName}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="cursor-pointer text-muted-foreground/50 transition-colors hover:text-destructive"
                            onClick={() =>
                              removeMutation.mutate({ accountKey: p.accountKey, model: g.model, accountName: p.accountName })
                            }
                          >
                            <X className="size-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('library.removeHint', { account: p.accountName })}</TooltipContent>
                      </Tooltip>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  )
}
