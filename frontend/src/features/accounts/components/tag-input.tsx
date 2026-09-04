import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n'

/** 标签输入：回车添加、点击标签移除；suggestions 供下拉补全。 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
}) {
  const [input, setInput] = useState('')

  const add = (raw: string) => {
    const v = raw.trim()
    if (!v) return
    if (value.includes(v)) {
      setInput('')
      return
    }
    onChange([...value, v])
    setInput('')
  }

  const remove = (tag: string) => onChange(value.filter((x) => x !== tag))

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
            >
              {tag}
              <button
                type="button"
                className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => remove(tag)}
                title={t('common.delete')}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(input)
          } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
            remove(value[value.length - 1])
          }
        }}
        onBlur={() => add(input)}
        placeholder={t('accounts.dialog.tagsPlaceholder')}
        list="account-tag-options"
      />
      <datalist id="account-tag-options">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
