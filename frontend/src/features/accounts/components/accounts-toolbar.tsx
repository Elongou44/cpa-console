import { Check, ChevronDown, RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'enabled', label: t('common.enabled') },
  { value: 'disabled', label: t('common.disabled') },
  { value: 'error', label: t('common.error') },
]

/** 表格工具栏：搜索 + 状态多选 + 分组筛选 + 重置。 */
export function AccountsToolbar({
  q,
  onQChange,
  status,
  onStatusChange,
  groups = [],
  group,
  onGroupChange,
  filtered,
  onReset,
}: {
  q: string
  onQChange: (v: string) => void
  status: string[]
  onStatusChange: (v: string[]) => void
  /** 全部已有分组名。 */
  groups?: string[]
  group: string
  onGroupChange: (v: string) => void
  filtered: boolean
  onReset: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64 lg:flex-1 lg:max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => onQChange(e.target.value)} placeholder={t('common.search')} className="h-8 pl-8" />
      </div>

      {groups.length > 0 && (
        <Select value={group} onValueChange={onGroupChange}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue placeholder={t('accounts.group')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('accounts.groupAll')}</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            {t('common.status')}
            {status.length > 0 && (
              <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {status.length}
              </span>
            )}
            <ChevronDown className="size-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2">
          {STATUS_OPTIONS.map((opt) => {
            const checked = status.includes(opt.value)
            return (
              <button
                key={opt.value}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                onClick={() =>
                  onStatusChange(
                    checked ? status.filter((s) => s !== opt.value) : [...status, opt.value],
                  )
                }
              >
                <Checkbox checked={checked} />
                <span className={cn(!checked && 'text-muted-foreground')}>{opt.label}</span>
                {checked && <Check className="ml-auto size-3.5 text-primary" />}
              </button>
            )
          })}
        </PopoverContent>
      </Popover>

      {filtered && (
        <Button variant="ghost" size="sm" className="h-8" onClick={onReset}>
          <RotateCcw className="size-3.5" />
          {t('common.reset')}
        </Button>
      )}
    </div>
  )
}
