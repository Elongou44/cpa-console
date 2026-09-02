import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { SyncResult } from '@/lib/types'

/** 手动触发一次同步，并刷新全部相关数据。 */
export function useSyncNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<SyncResult>('/api/sync'),
    onSuccess: (res) => {
      toast.success(t('sync.done', { accounts: res.accounts, new: res.newPending }))
      if (res.errors?.length) toast.warning(res.errors[0])
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-status'] })
    },
    onError: (e) => toast.error(e.message),
  })
}
