import { Bot, Boxes, CircleDot, KeyRound, MessageSquare, Orbit, Sparkles, SquareTerminal, Triangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type IconType = React.ComponentType<{ className?: string }>

const registry: Record<string, { icon: IconType; color: string; label: string }> = {
  gemini: { icon: Sparkles, color: 'text-blue-500 bg-blue-500/10', label: 'Gemini' },
  claude: { icon: Bot, color: 'text-orange-500 bg-orange-500/10', label: 'Claude' },
  codex: { icon: SquareTerminal, color: 'text-emerald-500 bg-emerald-500/10', label: 'Codex' },
  'openai-compatibility': { icon: Boxes, color: 'text-teal-500 bg-teal-500/10', label: 'OpenAI 兼容' },
  interactions: { icon: MessageSquare, color: 'text-violet-500 bg-violet-500/10', label: 'Interactions' },
  xai: { icon: Orbit, color: 'text-zinc-500 bg-zinc-500/10', label: 'xAI' },
  vertex: { icon: Triangle, color: 'text-sky-500 bg-sky-500/10', label: 'Vertex' },
  oauth: { icon: KeyRound, color: 'text-amber-500 bg-amber-500/10', label: 'OAuth 凭据' },
}

function resolve(type: string) {
  if (registry[type]) return registry[type]
  if (type.startsWith('oauth')) return registry.oauth
  return { icon: CircleDot, color: 'text-muted-foreground bg-muted', label: type }
}

/** OAuth 子类型显示名，如 oauth-claude → OAuth · Claude。 */
export function typeLabel(type: string): string {
  if (type.startsWith('oauth-')) {
    const provider = type.slice('oauth-'.length)
    const known = registry[provider]
    return `OAuth · ${known ? known.label : provider.toUpperCase()}`
  }
  return registry[type]?.label ?? type
}

/** 类型图标（带淡色底）。 */
export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const meta = resolve(type)
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded', meta.color, className)}>
      <Icon className="size-3" />
    </span>
  )
}

/** 类型名称 + 图标组合。 */
export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <TypeIcon type={type} />
      {typeLabel(type)}
    </span>
  )
}
