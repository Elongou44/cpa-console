import { useEffect, useState } from 'react'
import { ChevronLeft, ClipboardPaste, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/lib/i18n'
import { api } from '@/lib/api'
import { encodeKey } from '@/lib/utils'
import type { Account, AccountInput } from '@/lib/types'
import { useAccountDetail, useCreateAccount, useFetchUpstreamModels, useUpdateAccount } from '../data/hooks'
import { ModelSuggestionsPanel, ModelTagInput } from './model-tag-input'
import { TagInput } from './tag-input'
import { cn } from '@/lib/utils'

/** 从剪贴板文本中识别 API Key 与 Base URL：支持纯 Key、纯 URL、`key=xxx`/`url=xxx` 标签、同段混合文本。 */
export function parseClipboardAccount(text: string): { apiKey?: string; baseUrl?: string } {
  const out: { apiKey?: string; baseUrl?: string } = {}
  if (!text) return out

  // 1. URL：任意 http(s) 链接，截掉常见尾随标点
  const urlMatch = text.match(/https?:\/\/[^\s'"，,；;）)】》]+/)
  if (urlMatch) out.baseUrl = urlMatch[0]
  // 剥离 URL 段后再识别 Key，避免 URL 中的 key= 参数造成误匹配
  const rest = text.replace(urlMatch?.[0] ?? '', ' ')

  // 2. Key：优先带标签的（api-key: xxx / key = xxx / 密钥：xxx）
  let key: string | undefined
  const keyLabeled = rest.match(/(?:api[-_]?key|access[-_]?key|key|密钥|令牌)\s*[:=]\s*([A-Za-z0-9._\-]+)/i)
  if (keyLabeled) key = keyLabeled[1]

  // 3. 无标签时：找 sk- 前缀或足够长的 token
  if (!key) {
    const tokens = rest
      .split(/[\s,;，；'"「」【】《》]+/)
      .map((t) => t.trim())
      .filter((t) => t && !/[:=]$/.test(t))
    key = tokens.find((t) => /^sk-[A-Za-z0-9._\-]+$/.test(t) || /^[A-Za-z0-9._\-]{20,}$/.test(t))
  }
  if (key) out.apiKey = key
  return out
}

/** OpenAI 兼容账号的 Base URL 规范化：去掉已有 /v1 后统一补上，兼容导入的 URL 带或不带 /v1。 */
function normalizeOpenAIBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/i, '') + '/v1'
}

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
  const [priority, setPriority] = useState('0')
  const [ua, setUa] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showKey, setShowKey] = useState(false)
  // 右侧栏当前展示内容：Key 面板 / 候选模型面板 / 收起；打开时弹窗整体加宽
  const [panel, setPanel] = useState<'key' | 'models' | null>(null)
  // 编辑时懒加载的完整 Key（点眼睛才向本机接口取）；null 表示尚未获取
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  // 依赖用 account.key 而非 account 对象：列表 20s 轮询会生成新对象引用，
  // 若依赖对象本身，弹窗打开期间轮询到数据变化就会把正在输入的 Key 清空。
  useEffect(() => {
    if (!open) return
    setType(account?.type ?? 'openai-compatibility')
    setName(account?.type === 'openai-compatibility' ? account.name : '')
    setApiKey('')
    setBaseUrl(account?.baseUrl ?? '')
    setGroup(account?.group ?? '')
    setTags(account?.tags ?? [])
    setPriority(String(account?.priority ?? 0))
    setUa(account?.ua ?? '')
    setModels([])
    setSuggestions([])
    setShowKey(false)
    setPanel(null)
    setRevealedKey(null)
  }, [open, account?.key])

  // 编辑时回填当前模型列表。
  useEffect(() => {
    if (open && isEdit && detailQuery.data) {
      setModels(detailQuery.data.models ?? [])
    }
  }, [open, isEdit, detailQuery.data])

  const busy = createMutation.isPending || updateMutation.isPending

  const importFromClipboard = async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      toast.error(t('accounts.dialog.clipboardDenied'))
      return
    }
    const parsed = parseClipboardAccount(text)
    if (!parsed.apiKey && !parsed.baseUrl) {
      toast.warning(t('accounts.dialog.clipboardEmpty'))
      return
    }
    if (parsed.apiKey) setApiKey(parsed.apiKey)
    if (parsed.baseUrl) {
      // OpenAI 兼容账号统一以 /v1 结尾；其他类型按原样填入
      setBaseUrl(type === 'openai-compatibility' ? normalizeOpenAIBaseUrl(parsed.baseUrl) : parsed.baseUrl)
    }
    const detail = [
      parsed.apiKey ? 'API Key' : '',
      parsed.baseUrl ? t('accounts.dialog.baseUrl') : '',
    ].filter(Boolean)
    toast.success(t('accounts.dialog.clipboardOk', { detail: detail.join('、') }))
  }

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
      priority: Math.max(0, Math.floor(Number(priority) || 0)),
      ua: ua.trim() || undefined,
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
      ? { key: account.key, ua: ua.trim() || undefined }
      : { type, apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), ua: ua.trim() || undefined }
    fetchModelsMutation.mutate(input, {
      onSuccess: (res) => {
        toast.success(t('accounts.dialog.fetched', { count: res.models.length }))
        setSuggestions((prev) => [...new Set([...prev, ...res.models])])
      },
    })
  }

  const isCompat = type === 'openai-compatibility'

  // 面板展示的 Key：优先用户新输入的，其次编辑时懒加载到的已存 Key
  const panelKey = apiKey.trim() || revealedKey || ''

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(panelKey)
      toast.success(t('common.copySuccess'))
    } catch {
      toast.error(t('accounts.dialog.clipboardDenied'))
    }
  }

  // 点眼睛查看 Key 时右侧栏同步滑出；收起眼睛时若停在 Key 面板则一并收起
  const toggleKey = () => {
    const next = !showKey
    setShowKey(next)
    if (next) {
      setPanel('key')
      // 编辑模式：首次点开时向本机接口取 CPA 中保存的完整 Key
      if (isEdit && account && revealedKey === null) {
        api
          .get<{ apiKey: string }>(`/api/accounts/${encodeKey(account.key)}/reveal-key`)
          .then((r) => setRevealedKey(r.apiKey ?? ''))
          .catch(() => setRevealedKey(''))
      }
    } else {
      setPanel((p) => (p === 'key' ? null : p))
    }
  }

  const fetchAndShowModels = () => {
    setPanel('models')
    fetchModels()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[90vh] flex-col gap-4 overflow-hidden transition-all duration-300',
          panel ? 'sm:max-w-6xl' : 'sm:max-w-4xl',
        )}
      >
        <DialogHeader className="shrink-0 text-left">
          <DialogTitle>{isEdit ? t('accounts.dialog.editTitle') : t('accounts.dialog.addTitle')}</DialogTitle>
          <DialogDescription>{t('accounts.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden md:gap-4">
          {/* 左侧表单区：类型列 + 字段 */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-1 transition-all duration-300 md:flex-row md:gap-6">
            {/* 账号类型：竖排单选卡片（编辑时锁定） */}
            <div className="flex w-full shrink-0 flex-col gap-2 md:w-56">
              <Label className="shrink-0 text-base font-semibold">{t('accounts.dialog.type')}</Label>
              <div className="flex max-h-44 gap-2 overflow-x-auto pb-1 md:max-h-none md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-visible md:pb-0 md:pr-1">
                {KEY_TYPES.map((x) => (
                  <button
                    type="button"
                    key={x.value}
                    disabled={isEdit}
                    onClick={() => setType(x.value)}
                    className={cn(
                      'flex shrink-0 items-center gap-2.5 rounded-lg border p-3 text-sm transition-colors md:w-full',
                      isEdit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent/50',
                      type === x.value && 'border-primary bg-accent/40 shadow-sm',
                    )}
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full border',
                        type === x.value ? 'border-primary bg-primary' : 'border-muted-foreground/60',
                      )}
                    />
                    <span className="whitespace-nowrap">{x.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 字段区 */}
            <div className="min-h-0 flex-1 overflow-y-auto md:pr-1">
              <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">

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
            <div className="flex items-center justify-between">
              <Label>
                {t('accounts.dialog.apiKey')}
                {!isEdit && <span className="ml-1 text-destructive">*</span>}
              </Label>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={importFromClipboard}
              >
                <ClipboardPaste className="size-3" />
                {t('accounts.dialog.clipboardImport')}
              </button>
            </div>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isEdit ? t('accounts.dialog.apiKeyEditHint') : 'sk-...'}
                className="pr-9 font-mono"
                autoComplete="new-password"
                data-form-type="other"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                onClick={toggleKey}
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

          <div className="space-y-1.5">
            <Label>{t('accounts.dialog.priority')}</Label>
            <Input
              type="number"
              min={0}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-32 font-mono"
            />
            <p className="text-xs text-muted-foreground">{t('accounts.dialog.priorityHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('accounts.dialog.ua')}</Label>
            <Input
              value={ua}
              onChange={(e) => setUa(e.target.value)}
              placeholder={t('accounts.dialog.uaPlaceholder')}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t('accounts.dialog.uaHint')}</p>
          </div>

          {isCompat && (
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label>{t('accounts.dialog.models')}</Label>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={fetchAndShowModels}
                >
                  {fetchModelsMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  {t('accounts.dialog.fetchModels')}
                </button>
              </div>
              <ModelTagInput value={models} onChange={setModels} />
            </div>
          )}
              </div>
            </div>
          </div>

          {/* 右侧栏：查看 Key / 候选模型时滑出，弹窗同步加宽 */}
          <div
            className={cn(
              'relative flex min-h-0 flex-col overflow-hidden pt-1.5 transition-all duration-300 ease-out',
              panel ? 'w-[400px] border-l pl-4 opacity-100' : 'w-0 border-l border-l-transparent pl-0 opacity-0',
            )}
          >
            {/* Key 面板 */}
            <div
              className={cn(
                'flex h-full min-h-0 w-full flex-col transition-opacity duration-200',
                panel === 'key' ? 'opacity-100' : 'pointer-events-none absolute inset-x-0 top-0 opacity-0',
              )}
            >
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <h3 className="text-sm font-semibold">{t('accounts.dialog.keyPanelTitle')}</h3>
                <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPanel(null)}>
                  <ChevronLeft className="size-4" />
                </Button>
              </div>
              {panelKey ? (
                <>
                  <p className="shrink-0 rounded-lg border bg-muted/30 p-3 font-mono text-xs break-all">{panelKey}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2 h-7 w-fit shrink-0" onClick={copyKey}>
                    <Copy className="size-3" />
                    {t('common.copy')}
                  </Button>
                </>
              ) : isEdit ? (
                // 编辑：完整 Key 拉取中显示加载态，取不到时兜底展示掩码
                <p className="rounded-lg border border-dashed p-3 font-mono text-xs text-muted-foreground">
                  {revealedKey === null ? t('common.loading') : account?.apiKeyMasked || '—'}
                </p>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  {t('accounts.dialog.keyPanelEmpty')}
                </p>
              )}
            </div>

            {/* 候选模型面板（仅 OpenAI 兼容） */}
            {isCompat && (
              <div
                className={cn(
                  'flex h-full min-h-0 w-full flex-col transition-opacity duration-200',
                  panel === 'models' ? 'opacity-100' : 'pointer-events-none absolute inset-x-0 top-0 opacity-0',
                )}
              >
                <ModelSuggestionsPanel
                  embedded
                  value={models}
                  onChange={setModels}
                  suggestions={suggestions}
                  onFetch={fetchModels}
                  fetching={fetchModelsMutation.isPending}
                  onClose={() => setPanel(null)}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
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
