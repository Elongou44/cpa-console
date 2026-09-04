import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Boxes, LibraryBig, RefreshCw, Settings2, Users, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { t } from '@/lib/i18n'
import { cn, timeAgo } from '@/lib/utils'
import type { RuntimeStatus, SyncResult } from '@/lib/types'
import { ThemeToggle } from '@/components/theme'

const navItems = [
  { to: '/accounts', labelKey: 'nav.accounts', icon: Users },
  { to: '/models', labelKey: 'nav.models', icon: Boxes },
  { to: '/library', labelKey: 'nav.library', icon: LibraryBig },
  { to: '/aliases', labelKey: 'nav.aliases', icon: ArrowLeftRight },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings2 },
]

/** 应用外壳：左侧固定边栏 + 内容区。 */
export function AppShell() {
  const location = useLocation()
  const queryClient = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['runtime-status'],
    queryFn: () => api.get<RuntimeStatus>('/api/status'),
    refetchInterval: 10_000,
  })

  const syncMutation = useMutation({
    mutationFn: () => api.post<SyncResult>('/api/sync'),
    onSuccess: (res) => {
      toast.success(t('sync.done', { accounts: res.accounts, new: res.newPending }))
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-status'] })
    },
    onError: (e) => toast.error(e.message),
  })

  const pending = status?.counts?.pending ?? 0

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-card md:flex">
        <Link to="/accounts" className="flex h-14 items-center gap-2.5 border-b px-4 transition-colors hover:bg-accent/50">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Zap className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-none tracking-tight">{t('app.name')}</div>
            <div className="mt-1 truncate text-[10px] text-muted-foreground">{t('app.subtitle')}</div>
          </div>
        </Link>

        <nav className="mt-3 flex-1 space-y-1 px-3">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.to)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {t(item.labelKey)}
                {item.to === '/models' && pending > 0 && (
                  <span
                    className={cn(
                      'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-warning/15 text-warning',
                    )}
                  >
                    {pending}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="space-y-2 border-t p-3">
          <button
            className="flex w-full cursor-pointer items-center justify-between rounded-lg border bg-background/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || status?.syncing}
            title={t('common.sync')}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className={cn('size-3.5', (syncMutation.isPending || status?.syncing) && 'animate-spin')} />
              {syncMutation.isPending || status?.syncing ? t('common.syncing') : t('common.sync')}
            </span>
            <span className="tabular-nums">{timeAgo(status?.lastSyncAt)}</span>
          </button>
          {status && !status.configured && (
            <Link
              to="/settings"
              className="block rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-center text-xs text-warning transition-colors hover:bg-warning/15"
            >
              {t('settings.notConfigured')}
            </Link>
          )}
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-xs text-muted-foreground">外观</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="md:pl-56">
        <Outlet />
      </div>
    </div>
  )
}
