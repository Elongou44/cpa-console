import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { TypeIcon, typeLabel } from '@/components/shared/type-icon'

export interface TypeTab {
  value: string
  count: number
}

/** 类型胶囊 Tab（复刻 axonhub 渠道页）：全部 + 按 Provider 计数。 */
export function AccountsTypeTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: TypeTab[]
  value: string
  onChange: (v: string) => void
}) {
  const allCount = tabs.reduce((acc, tab) => acc + tab.count, 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TabPill active={value === ''} onClick={() => onChange('')} label={t('common.all')} count={allCount} icon={null} />
      {tabs.map((tab) => (
        <TabPill
          key={tab.value}
          active={value === tab.value}
          onClick={() => onChange(tab.value)}
          label={typeLabel(tab.value)}
          count={tab.count}
          icon={<TypeIcon type={tab.value} />}
        />
      ))}
    </div>
  )
}

function TabPill({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-all active:scale-[0.97]',
        active
          ? 'border-transparent bg-primary text-primary-foreground shadow-md'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 text-[11px] tabular-nums',
          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  )
}
