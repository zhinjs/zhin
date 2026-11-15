import { useConsoleUiI18n } from '../i18n/index.js'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../cn.js'

export interface EmptyStateProps {
  icon?: LucideIcon
  title?: string
  description?: string
  className?: string
  /** 嵌入表格/卡片内时使用更紧凑的样式 */
  compact?: boolean
}

/**
 * 统一空状态组件
 * - 标准化图标大小（w-12 h-12）、透明度（opacity-30）、间距
 * - compact 模式用于表格行/卡片内嵌场景
 */
export function EmptyState({ icon: Icon, title, description, className, compact }: EmptyStateProps) {
  const i18n = useConsoleUiI18n()
  if (compact) {
    return (
      <div className={cn('console-empty', className)} data-compact="">
        {Icon && <Icon className="size-8 text-muted-foreground opacity-30" />}
        <p className="console-text-body text-muted-foreground">{title || i18n.t("empty.noData")}</p>
        {description && <p className="console-text-label text-muted-foreground">{description}</p>}
      </div>
    )
  }

  return (
    <div className={cn('console-empty', className)}>
      {Icon && <Icon className="size-12 text-muted-foreground opacity-30" />}
      {title && <h3 className="console-section-title">{title}</h3>}
      <p className="console-text-body text-muted-foreground max-w-sm">{description || i18n.t("empty.noData")}</p>
    </div>
  )
}
