import type { ReactNode } from 'react'
import { cn } from '../cn.js'

export interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

/**
 * 统一页面标题区（与各业务页配合使用）
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('console-page-header', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="console-page-title">{title}</h1>
        {description ? (
          <p className="console-page-description">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="console-page-header-actions">{actions}</div> : null}
    </header>
  )
}
