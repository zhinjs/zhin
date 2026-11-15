import type { ReactNode } from 'react'
import { cn } from '../cn.js'

export interface PageShellProps {
  children: ReactNode
  /** 默认 vertical stack；grid 用于卡片栅格页 */
  layout?: 'stack' | 'grid'
  className?: string
}

/**
 * 页面内容区统一外壳：区块间距、纵向节奏与 dashboard main 内边距配合使用。
 */
export function PageShell({ children, layout = 'stack', className }: PageShellProps) {
  return (
    <div
      className={cn(
        layout === 'stack' ? 'console-page' : 'console-page-grid',
        className,
      )}
    >
      {children}
    </div>
  )
}
