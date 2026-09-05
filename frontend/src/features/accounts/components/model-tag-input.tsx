import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** 模型家族分组键：取 "/" 或 "-" 前的首段，如 gpt-4o-mini -> gpt、openai/gpt-4o -> openai。 */
function familyOf(name: string): string {
  const slash = name.indexOf('/')
  if (slash > 0) return name.slice(0, slash)
  const dash = name.indexOf('-')
  if (dash > 0) return name.slice(0, dash)
  return name
}

function useModelSelection(value: string[], onChange: (next: string[]) => void) {
  const add = (name: string) => {
    const v = name.trim()
    if (!v) return
    if (value.includes(v)) {
      toast.warning(t('accounts.dialog.dup', { name: v }))
      return
    }
    onChange([...value, v])
  }

  const remove = (name: string) => onChange(value.filter((m) => m !== name))

  const setMany = (items: string[], on: boolean) => {
    if (on) {
      const merged = [...value]
      for (const m of items) if (!merged.includes(m)) merged.push(m)
      onChange(merged)
    } else {
      const set = new Set(items)
      onChange(value.filter((m) => !set.has(m)))
    }
  }

  return { add, remove, setMany }
}

/** 模型标签输入：回车/粘贴添加、点击标签移除（表单内主区域）。 */
export function ModelTagInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [input, setInput] = useState('')
  const { add, remove } = useModelSelection(value, onChange)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add(input)
      setInput('')
    }
  }

  // 支持整段粘贴：自动按行拆分为多个模型。
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return
    e.preventDefault()
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const merged = [...value]
    for (const line of lines) {
      if (!merged.includes(line)) merged.push(line)
    }
    onChange(merged)
    setInput('')
  }

  return (
    <div className="space-y-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={t('accounts.dialog.modelsInput')}
        className="font-mono"
      />

      <div className="flex max-h-56 flex-wrap content-start gap-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-2">
        {value.length === 0 && (
          <span className="py-1 text-xs text-muted-foreground">{t('accounts.dialog.selectedEmpty')}</span>
        )}
        {value.map((m) => (
          <span
            key={m}
            className="inline-flex max-w-full animate-fade-in-up items-center gap-1 rounded-md border bg-card px-2 py-0.5 font-mono text-xs shadow-sm"
          >
            <span className="truncate">{m}</span>
            <button
              type="button"
              className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive"
              onClick={() => remove(m)}
              title={t('common.delete')}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

/** 上游候选模型面板：获取模型、按家族分组点选、搜索过滤；嵌入右侧栏时占满高度内部滚动。
 *  readOnly 用于无路由清单的类型（codex 等）：仅预览上游清单，不可点选。 */
export function ModelSuggestionsPanel({
  value,
  onChange,
  suggestions = [],
  onFetch,
  fetching,
  embedded,
  onClose,
  readOnly,
}: {
  value: string[]
  onChange: (next: string[]) => void
  /** 上游获取的候选模型（点击添加/移除）。 */
  suggestions?: string[]
  onFetch?: () => void
  fetching?: boolean
  /** 嵌入弹窗右侧栏：占满面板高度（列表内部滚动），否则限制最大高度。 */
  embedded?: boolean
  /** 右侧栏收起按钮（传入才显示）。 */
  onClose?: () => void
  /** 预览模式：候选不可点选（该类型模型由同步发现后审批）。 */
  readOnly?: boolean
}) {
  const [filter, setFilter] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const { add, remove, setMany } = useModelSelection(value, onChange)

  const keyword = filter.trim().toLowerCase()
  const visibleSuggestions = keyword ? suggestions.filter((s) => s.toLowerCase().includes(keyword)) : suggestions
  const hasPending = suggestions.some((s) => !value.includes(s))
  const listCls = embedded ? 'min-h-0 flex-1' : 'max-h-[26rem]'

  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const s of visibleSuggestions) {
      const fam = familyOf(s)
      const list = map.get(fam)
      if (list) list.push(s)
      else map.set(fam, [s])
    }
    return [...map.entries()]
      .map(([name, models]) => ({ name, models }))
      .sort((a, b) => b.models.length - a.models.length || a.name.localeCompare(b.name))
  }, [visibleSuggestions])

  // 家族默认折叠，避免上游大量模型一次性摊开；提供一键展开/收起。
  const allOpen = groups.length > 0 && groups.every(({ name }) => openGroups[name] === true)
  const toggleAllGroups = () => {
    const next: Record<string, boolean> = {}
    for (const { name } of groups) next[name] = !allOpen
    setOpenGroups(next)
  }

  const renderChips = (items: string[]) =>
    items.map((s) => {
      const selected = value.includes(s)
      if (readOnly) {
        return (
          <span
            key={s}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground"
            title={s}
          >
            <span className="truncate">{s}</span>
          </span>
        )
      }
      return (
        <button
          type="button"
          key={s}
          onClick={() => (selected ? remove(s) : add(s))}
          className={cn(
            'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs transition-all active:scale-[0.97]',
            selected
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
          )}
          title={s}
        >
          {selected ? <Check className="size-3 shrink-0" /> : <Plus className="size-3 shrink-0" />}
          <span className="truncate">{s}</span>
        </button>
      )
    })

  return (
    <div className={cn('space-y-2', embedded && 'flex h-full min-h-0 flex-col')}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t(readOnly ? 'accounts.dialog.suggestionsView' : 'accounts.dialog.suggestions')}
          {suggestions.length > 0 && <span> · {suggestions.length}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onFetch && (
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={onFetch} disabled={fetching}>
              {fetching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              {t('accounts.dialog.fetchModels')}
            </Button>
          )}
          {onClose && (
            <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
              <ChevronLeft className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {suggestions.length > 8 && (
        <div className="relative shrink-0">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('common.search')}
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}

      {suggestions.length > 0 || fetching ? (
        groups.length > 1 && !keyword ? (
          <div className={cn('grid content-start gap-1.5 overflow-y-auto pr-1', listCls)}>
            {groups.map(({ name, models }) => {
              const open = openGroups[name] ?? false
              const allSelected = models.every((m) => value.includes(m))
              return (
                <div key={name} className="self-start rounded-md border bg-muted/20">
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <button
                      type="button"
                      className="flex flex-1 cursor-pointer select-none items-center gap-1.5 text-left"
                      onClick={() => setOpenGroups((prev) => ({ ...prev, [name]: !(prev[name] ?? false) }))}
                    >
                      <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
                      <span className="truncate text-xs font-medium">{name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{models.length}</span>
                    </button>
                    {!readOnly && (
                      <button
                        type="button"
                        className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setMany(models, !allSelected)}
                      >
                        {allSelected ? t('accounts.dialog.groupClear') : t('accounts.dialog.groupAll')}
                      </button>
                    )}
                  </div>
                  {open && <div className="flex flex-wrap gap-1.5 px-2 pb-2">{renderChips(models)}</div>}
                </div>
              )
            })}
          </div>
        ) : (
          <div className={cn('flex content-start flex-wrap gap-1.5 overflow-y-auto pr-1', listCls)}>
            {renderChips(visibleSuggestions)}
            {visibleSuggestions.length === 0 && !fetching && (
              <span className="py-1 text-xs text-muted-foreground">{t('common.noData')}</span>
            )}
            {visibleSuggestions.length === 0 && fetching && (
              <span className="inline-flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {t('accounts.dialog.fetching')}
              </span>
            )}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {t('accounts.dialog.suggestionsEmpty')}
        </div>
      )}

      {!readOnly && hasPending && <p className="shrink-0 text-xs text-muted-foreground">{t('accounts.dialog.modelsHint')}</p>}
    </div>
  )
}
