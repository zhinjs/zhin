import { isValidElement, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useConsoleUiI18n, type ConsoleUiMessageKey } from '../i18n/index.js'
import { cn } from '../cn.js'
import { Button } from './ui/button.js'
import { EmptyIllustration, type EmptyIllustrationName } from './empty-illustrations.js'
import { CONSOLE_ICON_STROKE_WIDTH } from './icon.js'

/** The one action of an empty state (ADR 0063 D28): a `soft` button by default, `primary` on request. */
export interface EmptyStateAction {
  readonly label: string
  readonly onSelect?: () => void
  /** Renders a link styled as the button instead of a `<button>`. */
  readonly href?: string
  /** `soft` (default) or `primary`. A view keeps at most one `primary` (D25). */
  readonly variant?: 'primary' | 'soft'
  readonly icon?: LucideIcon
  readonly disabled?: boolean
}

export interface EmptyStateProps {
  /** Line-art illustration (64px, 48px when compact); takes precedence over `icon`. */
  illustration?: EmptyIllustrationName
  /** Lucide icon, used when there is no `illustration` (kept for compatibility). */
  icon?: LucideIcon
  title?: string
  /** The one sentence of the empty state. Without `title` and `description` the illustration's default sentence is used. */
  description?: string
  /** One action: an `EmptyStateAction` (rendered as a soft or primary `Button`) or your own element. */
  action?: EmptyStateAction | ReactNode
  className?: string
  /** 嵌入表格/卡片内时使用更紧凑的样式 */
  compact?: boolean
}

const DEFAULT_COPY: Readonly<Record<EmptyIllustrationName, ConsoleUiMessageKey>> = {
  messages: 'empty.messages',
  tasks: 'empty.tasks',
  logs: 'empty.logs',
  table: 'empty.table',
  record: 'empty.record',
  'not-found': 'empty.notFound',
  generic: 'empty.noData',
}

function isAction(action: EmptyStateProps['action']): action is EmptyStateAction {
  return typeof action === 'object' && action !== null && !isValidElement(action) && 'label' in action
}

function EmptyStateActionButton({ action }: { action: EmptyStateAction }) {
  const Icon = action.icon
  const variant = action.variant ?? 'soft'
  const content = <>{Icon ? <Icon aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} /> : null}{action.label}</>
  if (action.href !== undefined && !action.disabled) {
    return <Button asChild variant={variant}><a href={action.href} onClick={action.onSelect}>{content}</a></Button>
  }
  return <Button type="button" variant={variant} disabled={action.disabled} onClick={action.onSelect}>{content}</Button>
}

/**
 * 统一空状态组件（ADR 0063 D28）：64px 线稿插画（或图标）+ 一句说明 + 可选的一个操作。
 * - 插画与图标都是 `brand-text` 单色、1.5px 描边，不再是半透明的灰图标
 * - 只给了插画时用插画的默认说明；不再单独显示「暂无数据」
 * - compact 模式用于表格行/卡片内嵌场景
 */
export function EmptyState({ illustration, icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  const i18n = useConsoleUiI18n()
  const sentence = description ?? (title ? undefined : i18n.t(DEFAULT_COPY[illustration ?? 'generic']))
  const art = illustration
    ? <EmptyIllustration name={illustration} />
    : Icon ? <Icon aria-hidden="true" className="console-empty-icon" strokeWidth={1.5} /> : null
  const actionNode = action == null || action === false ? null : isAction(action) ? <EmptyStateActionButton action={action} /> : action
  return (
    <div className={cn('console-empty', className)} data-slot="empty-state" data-compact={compact ? '' : undefined}>
      {art}
      {title ? (compact ? <p className="console-empty-title">{title}</p> : <h3 className="console-empty-title">{title}</h3>) : null}
      {sentence ? <p className="console-empty-description">{sentence}</p> : null}
      {actionNode ? <div className="console-empty-action">{actionNode}</div> : null}
    </div>
  )
}
