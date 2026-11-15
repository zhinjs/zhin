import type { ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * Content width of a page (ADR 0063 D16, D18 第 4 条): `reading` 60rem for settings, forms and
 * explanations; `data` 120rem for lists, tables and dashboards (the default); `full` for workspace
 * pages (`definePage({ fullWidth: true })`).
 */
export type PageContentWidth = 'reading' | 'data' | 'full'

export interface PageShellProps {
  children: ReactNode
  /** 默认 vertical stack；grid 用于卡片栅格页（两者都是纵向排列的区块，保留兼容） */
  layout?: 'stack' | 'grid'
  /** Content width the shell resolves into `--console-content-max`. Defaults to `data`. */
  width?: PageContentWidth
  /**
   * The shell pads the page with `--console-page-padding-inline` / `-block` (default). Pass `false`
   * when the host layout already pads its main area.
   */
  inset?: boolean
  className?: string
}

/**
 * Page content shell: page padding, section rhythm and the content width
 * `min(100%, var(--console-content-max))` (D18 第 3 条). The frame is a size container, so the
 * components inside follow the page width; it is also its own stacking context (D19 兜底).
 */
export function PageShell({ children, layout = 'stack', width = 'data', inset = true, className }: PageShellProps) {
  return (
    <div className="console-page-frame console-cq" data-width={width} data-inset={inset ? undefined : 'false'} data-slot="page">
      <div
        className={cn(layout === 'stack' ? 'console-page' : 'console-page-grid', className)}
        data-slot="page-content"
        data-width={width}
      >
        {children}
      </div>
    </div>
  )
}
