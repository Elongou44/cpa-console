import type { ReactNode } from 'react'

/** 页面固定页头：标题 + 描述 + 右侧操作区。 */
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <header className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:left-56">
      <div className="min-w-0">
        <h1 className="truncate text-base font-bold leading-tight tracking-tight">{title}</h1>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  )
}

/** 页面内容容器：让出页头高度。 */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={`animate-fade-in-up px-6 pb-10 pt-[4.25rem] ${className ?? ''}`}>{children}</main>
}
