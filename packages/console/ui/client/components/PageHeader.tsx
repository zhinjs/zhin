import type { ReactNode } from 'react'
import { cn } from '../cn.js'
import { PageActions, type PageAction } from './actions.js'

export interface PageHeaderProps {
  title: string
  description?: string
  /** Always-visible header content (refresh control, custom controls); wraps on narrow headers. */
  actions?: ReactNode
  /** Labelled actions: buttons on wide headers, folded into 「更多」 below 40rem (D18 第 7 条). */
  menuActions?: readonly PageAction[]
  /** Actions that always live in the 「更多」 menu. */
  moreActions?: readonly PageAction[]
  className?: string
}

/**
 * Page title block (ADR 0063 决策 2): title, one description, and the actions. The header is a size
 * container; its layout follows its own width, so nothing is pushed out of the viewport.
 */
export function PageHeader({ title, description, actions, menuActions, moreActions, className }: PageHeaderProps) {
  const hasActions = actions != null || Boolean(menuActions?.length) || Boolean(moreActions?.length)
  return (
    <header className={cn('console-page-header console-cq', className)} data-slot="page-header">
      <div className="console-page-header-body">
        <div className="console-page-heading">
          <h1 className="console-page-title">{title}</h1>
          {description ? <p className="console-page-description">{description}</p> : null}
        </div>
        {hasActions ? <PageActions actions={menuActions} moreActions={moreActions}>{actions}</PageActions> : null}
      </div>
    </header>
  )
}
