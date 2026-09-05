import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/lib/i18n'
import type { AccountModelAliasRow } from '@/lib/types'
import { useSetModelAlias } from '../data/hooks'

/** 别名编辑弹窗：修改或清除某模型的 alias，保存即写回 CPA。 */
export function AliasEditDialog({
  open,
  onOpenChange,
  accountKey,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountKey: string
  row: AccountModelAliasRow | null
}) {
  const [value, setValue] = useState('')
  const mutation = useSetModelAlias(accountKey)

  useEffect(() => {
    if (open) setValue(row?.alias ?? '')
  }, [open, row])

  const unchanged = !!row && value.trim() === row.alias
  const save = () => {
    if (!row || unchanged) return
    mutation.mutate(
      { model: row.name, alias: value.trim() },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('aliases.edit.title')}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{row?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="alias-input">{t('aliases.edit.aliasLabel')}</Label>
          <Input
            id="alias-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
            placeholder={t('aliases.edit.placeholder')}
            className="font-mono"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{t('aliases.edit.hint')}</p>
          {row?.suggestedAlias && (
            <p className="text-xs text-muted-foreground">
              {t('aliases.edit.suggested', { alias: row.suggestedAlias })}
            </p>
          )}
        </div>
        <DialogFooter>
          {!!row?.alias && (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => row && mutation.mutate({ model: row.name, alias: '' }, { onSuccess: () => onOpenChange(false) })}
            >
              {t('aliases.edit.clear')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={mutation.isPending || unchanged || !row}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
