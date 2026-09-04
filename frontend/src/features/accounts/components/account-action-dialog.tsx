import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/lib/i18n'
import type { Account, AccountInput } from '@/lib/types'
import { useAccountDetail, useCreateAccount, useFetchUpstreamModels, useUpdateAccount } from '../data/hooks'
import { ModelTagInput } from './model-tag-input'
import { TagInput } from './tag-input'

const KEY_TYPES = [
  { value: 'openai-compatibility', label: 'OpenAI 兼容' },
  { value: 'gemini', label: 'Gemini API' },
  { value: 'claude', label: 'Claude API' },
  { value: 'codex', label: 'Codex API' },
  { value: 'xai', label: 'xAI API' },
  { value: 'interactions', label: 'Interactions' },
  { value: 'vertex', label: 'Vertex' },
]

/** 添加 / 编辑 Key 型账号。 */
export function AccountActionDialog({
  open,
  onOpenChange,
  account,
  groups = [],
  tagSuggestions = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
  /** 已有分组名，供输入建议。 */
  groups?: string[]
  /** 已有标签名，供输入建议。 */
  tagSuggestions?: string[]
}) {
  const isEdit = !!account
  const createMutation = useCreateAccount()
  const updateMutation = useUpdateAccount()
  const fetchModelsMutation = useFetchUpstreamModels()
  const detailQuery = useAccountDetail(isEdit ? account.key : null, open)

  const [type, setType] = useState('openai-compatibility')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [group, setGroup] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (!open) return
    setType(account?.type ?? 'openai-compatibility')
    setName(account?.type === 'openai-compatibility' ? account.name : '')
    setApiKey('')
    setBaseUrl(account?.baseUrl ?? '')
    setGroup(account?.group ?? '')
    setTags(account?.tags ?? [])
    setModels([])
    setSuggestions([])
    setShowKey(false)
  }, [open, account])

  // 编辑时回填当前模型列表。
  useEffect(() => {
    if (open && isEdit && detailQuery.data) {
      setModels(detailQuery.data.models ?? [])
    }
  }, [open, isEdit, detailQuery.data])

  const busy = createMutation.isPending || updateMutation.isPending

  const submit = () => {
    if (!isEdit && !apiKey.trim()) {
      toast.warning(t('accounts.dialog.required'))
      return
    }
    if (type === 'openai-compatibility' && !name.trim()) {
      toast.warning(t('accounts.dialog.required'))
      return
    }
    if (type === 'codex' && !baseUrl.trim() && !account?.baseUrl) {
      toast.warning(t('accounts.dialog.required'))
      return
    }
    const input: AccountInput = {
      type,
      name: name.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      models: type === 'openai-compatibility' ? models : undefined,
      group: group.trim(),
      tags,
    }
    if (isEdit && account) {
      updateMutation.mutate({ key: account.key, input }, { onSuccess: () => onOpenChange(false) })
    } else {
      createMutation.mutate(input, { onSuccess: () => onOpenChange(false) })
    }
  }

  const fetchModels = () => {
    if (!account && !apiKey.trim()) {
      toast.warning(t('accounts.dialog.required'))
      return
    }
    const input = account
      ? { key: account.key }
      : { type, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() }
    fetchModelsMutation.mutate(input, {
      onSuccess: (res) => {
        toast.success(t('accounts.dialog.fetched', { count: res.models.length }))
        setSuggestions((prev) => [...new Set([...prev, ...res.models])])
      },
    })
  }

  const isCompat = type === 'openai-compatibility'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('accounts.dialog.editTitle') : t('accounts.dialog.addTitle')}</DialogTitle>
          <DialogDescription>{t('accounts.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('accounts.dialog.type')}</Label>
            {isEdit ? (
              <div className="flex h-8 items-center text-sm text-muted-foreground">
                {KEY_TYPES.find((x) => x.value === type)?.label ?? type}
              </div>
            ) : (
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEY_TYPES.map((x) => (
                    <SelectItem key={x.value} value={x.value}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {isCompat && (
            <div className="space-y-1.5">
              <Label>
                {t('accounts.dialog.name')}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-provider" />
              <p className="text-xs text-muted-foreground">{t('accounts.dialog.nameHint')}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              {t('accounts.dialog.apiKey')}
              {!isEdit && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isEdit ? t('accounts.dialog.apiKeyEditHint') : 'sk-...'}
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
            {isEdit && <p className="text-xs text-muted-foreground">{t('accounts.dialog.apiKeyEditHint')}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>
              {t('accounts.dialog.baseUrl')}
              {type === 'codex' && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t('accounts.dialog.baseUrlHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('accounts.dialog.group')}</Label>
            <Input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('accounts.dialog.groupPlaceholder')}
              list="account-group-options"
            />
            <datalist id="account-group-options">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">{t('accounts.dialog.groupHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('accounts.dialog.tags')}</Label>
            <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
            <p className="text-xs text-muted-foreground">{t('accounts.dialog.tagsHint')}</p>
          </div>

          {isCompat && (
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t('accounts.dialog.models')}</Label>
              <ModelTagInput
                value={models}
                onChange={setModels}
                suggestions={suggestions}
                onFetch={fetchModels}
                fetching={fetchModelsMutation.isPending}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
