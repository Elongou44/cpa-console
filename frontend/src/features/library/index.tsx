import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageBody, PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n'
import type { LibraryRow } from '@/lib/types'
import { useLibrary, useRemoveLibraryModel } from './data/hooks'

interface LibraryGroup {
  model: string
  providers: LibraryRow[]
}

/** 模型库：跨账号聚合当前已加入 CPA 的模型，展示提供方并支持快捷移除。 */
export default function LibraryPage() {
  const [inputQ, setInputQ] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQ(inputQ), 300)
    return () => clearTimeout(id)
  }, [inputQ])

  const query = useLibrary()
  const removeMutation = useRemoveLibraryModel()

  const rows = query.data?.rows ?? []
  const groups = useMemo(() => {
    const map = new Map<string, LibraryRow[]>()
    for (const r of rows) {
      const list = map.get(r.model) ?? []
      list.push(r)
      map.set(r.model, list)
    }
    return [...map.entries()]
      .map(([model, providers]) => ({ model, providers: providers.sort((a, b) => a.accountName.localeCompare(b.accountName)) }))
      .sort((a, b) => b.providers.length - a.providers.length || a.model.localeCompare(b.model))
  }, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter(
      (g) =>
        g.model.toLowerCase().includes(needle) ||
        g.providers.some((p) => p.accountName.toLowerCase().includes(needle) || (p.alias ?? '').toLowerCase().includes(needle)),
    )
  }, [groups, q])

  return (
    <div>
      <PageHeader title={t('library.title')} description={t('library.description')}>
        <Button variant="outline" size="sm" className="h-8" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('common.refresh')}
        </Button>
      </PageHeader>

      <PageBody className="space-y-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={inputQ} onChange={(e) => setInputQ(e.target.value)} placeholder={t('common.search')} className="h-8 pl-8" />
        </div>

        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed bg-card/50 text-sm text-muted-foreground">
            {t('library.empty')}
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
                      <span className="truncate" title={p.alias && p.alias !== p.model ? `${p.accountName} → ${p.alias}` : p.accountName}>
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
