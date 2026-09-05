import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Loader2, PlugZap, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageBody, PageHeader } from '@/components/layout/page-header'
import { api } from '@/lib/api'
import { t } from '@/lib/i18n'
import { formatDateTime } from '@/lib/utils'
import type { RuntimeStatus, Settings } from '@/lib/types'
import { useSyncNow } from '@/lib/sync'

/** 连接设置页。 */
export default function SettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') })
  const statusQuery = useQuery({
    queryKey: ['runtime-status'],
    queryFn: () => api.get<RuntimeStatus>('/api/status'),
    refetchInterval: 10_000,
  })

  const [baseUrl, setBaseUrl] = useState('')
  const [managementKey, setManagementKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  const [intervalSec, setIntervalSec] = useState(60)
  const [defaultUA, setDefaultUA] = useState('')
  const [connAuto, setConnAuto] = useState(true)
  const [connIntervalSec, setConnIntervalSec] = useState(300)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (settingsQuery.data && !loaded) {
      setBaseUrl(settingsQuery.data.baseUrl)
      setAutoSync(settingsQuery.data.autoSync)
      setIntervalSec(settingsQuery.data.intervalSec)
      setDefaultUA(settingsQuery.data.defaultUA ?? '')
      setConnAuto(settingsQuery.data.connAuto ?? true)
      setConnIntervalSec(settingsQuery.data.connIntervalSec ?? 300)
      setLoaded(true)
    }
  }, [settingsQuery.data, loaded])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<Settings>('/api/settings', {
        baseUrl,
        managementKey: managementKey || undefined,
        autoSync,
        intervalSec,
        defaultUA,
        connAuto,
        connIntervalSec,
      }),
    onSuccess: () => {
      toast.success(t('settings.saved'))
      setManagementKey('')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-status'] })
    },
    onError: (e) => toast.error(e.message),
  })

  const testMutation = useMutation({
    mutationFn: () => api.post<{ version: string }>('/api/settings/test', { baseUrl, managementKey }),
    onSuccess: (res) => toast.success(t('settings.testOk', { version: res.version || '未知' })),
    onError: (e) => toast.error(e.message),
  })

  const syncMutation = useSyncNow()
  const status = statusQuery.data

  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <PageBody className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.connection')}</CardTitle>
            <CardDescription>{t('settings.baseUrlPlaceholder')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label>{t('settings.baseUrl')}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('settings.baseUrlPlaceholder')}
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('settings.managementKey')}</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={managementKey}
                  onChange={(e) => setManagementKey(e.target.value)}
                  placeholder={settingsQuery.data?.hasKey ? settingsQuery.data.keyMasked : ''}
                  className="pr-9 font-mono"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.managementKeyHint')}</p>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
              {testMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              {t('common.test')}
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {t('common.save')}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.sync')}</CardTitle>
            <CardDescription>{t('settings.autoSyncHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>{t('settings.autoSync')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.autoSyncHint')}</p>
              </div>
              <Switch checked={autoSync} onCheckedChange={setAutoSync} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('settings.interval')}</Label>
              <Input
                type="number"
                min={15}
                value={intervalSec}
                onChange={(e) => setIntervalSec(Math.max(15, Number(e.target.value) || 15))}
                className="w-32 font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('settings.upstream')}</Label>
              <Input
                value={defaultUA}
                onChange={(e) => setDefaultUA(e.target.value)}
                placeholder={t('settings.defaultUA')}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t('settings.defaultUAHint')}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>{t('settings.connAuto')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.connAutoHint')}</p>
              </div>
              <Switch checked={connAuto} onCheckedChange={setConnAuto} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('settings.connInterval')}</Label>
              <Input
                type="number"
                min={30}
                value={connIntervalSec}
                onChange={(e) => setConnIntervalSec(Math.max(30, Number(e.target.value) || 30))}
                className="w-32 font-mono"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
              {syncMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {t('common.sync')}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.runtime')}</CardTitle>
          </CardHeader>
          <CardContent>
            {statusQuery.isLoading || !status ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('settings.lastSync')}</span>
                  <span className="font-mono text-xs">{status.lastSyncAt ? formatDateTime(status.lastSyncAt) : t('common.never')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('settings.lastError')}</span>
                  <span className={`max-w-72 truncate text-xs ${status.lastError ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {status.lastError || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('models.columns.status')}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="warning">{t('settings.counts.pending')} {status.counts?.pending ?? 0}</Badge>
                    <Badge variant="success">{t('settings.counts.approved')} {status.counts?.approved ?? 0}</Badge>
                    <Badge variant="destructive">{t('settings.counts.rejected')} {status.counts?.rejected ?? 0}</Badge>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </div>
  )
}
