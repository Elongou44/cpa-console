import { useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface ModelTagInputProps {
  /** 已选模型列表（受控）。 */
  value: string[]
  onChange: (next: string[]) => void
  /** 上游获取的候选模型（点击添加/移除）。 */
  suggestions?: string[]
  /** 传入即展示"获取模型"按钮。 */
  onFetch?: () => void
  fetching?: boolean
}

/** 模型家族分组键：取 "/" 或 "-" 前的首段，如 gpt-4o-mini -> gpt、openai/gpt-4o -> openai。 */
function familyOf(name: string): string {
  const slash = name.indexOf('/')
  if (slash > 0) return name.slice(0, slash)
  const dash = name.indexOf('-')
  if (dash > 0) return name.slice(0, dash)
  return name
}

/** 模型标签选择器：回车添加、点击标签移除、上游候选按家族分组点选。 */
export function ModelTagInput({ value, onChange, suggestions = [], onFetch, fetching }: ModelTagInputProps) {
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

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

  const keyword = filter.trim().toLowerCase()
  const visibleSuggestions = keyword ? suggestions.filter((s) => s.toLowerCase().includes(keyword)) : suggestions
  const hasPending = suggestions.some((s) => !value.includes(s))

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

  const renderChips = (items: string[]) =>
    items.map((s) => {
      const selected = value.includes(s)
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
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('accounts.dialog.modelsInput')}
          className="font-mono"
        />
        {onFetch && (
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={onFetch} disabled={fetching}>
            {fetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t('accounts.dialog.fetchModels')}
          </Button>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/30 p-2">
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
      )}

      {onFetch && (suggestions.length > 0 || fetching) && (
        <div className="rounded-lg border p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t('accounts.dialog.suggestions')} · {suggestions.length}
            </span>
            {suggestions.length > 8 && (
              <div className="relative w-40">
                <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('common.search')}
                  className="h-6 pl-6 text-xs"
                />
              </div>
            )}
          </div>
          {groups.length > 1 && !keyword ? (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {groups.map(({ name, models }) => {
                const open = openGroups[name] ?? models.length <= 8
                const allSelected = models.every((m) => value.includes(m))
                return (
                  <div key={name} className="rounded-md border bg-muted/20">
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <button
                        type="button"
                        className="flex flex-1 cursor-pointer select-none items-center gap-1.5 text-left"
                        onClick={() => setOpenGroups((prev) => ({ ...prev, [name]: !(prev[name] ?? models.length <= 8) }))}
                      >
                        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
                        <span className="text-xs font-medium">{name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{models.length}</span>
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setMany(models, !allSelected)}
                      >
                        {allSelected ? t('accounts.dialog.groupClear') : t('accounts.dialog.groupAll')}
                      </button>
                    </div>
                    {open && <div className="flex flex-wrap gap-1.5 px-2 pb-2">{renderChips(models)}</div>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
              {renderChips(visibleSuggestions)}
              {visibleSuggestions.length === 0 && !fetching && (
                <span className="py-1 text-xs text-muted-foreground">{t('common.noData')}</span>
              )}
            </div>
          )}
        </div>
      )}

      {hasPending && <p className="text-xs text-muted-foreground">{t('accounts.dialog.modelsHint')}</p>}
    </div>
  )
}
