import { useRef, type ReactNode } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { CONSOLE_ICON_STROKE_WIDTH } from './icon.js'
import { cn } from '../cn.js'
import { useConsoleUiI18n } from '../i18n/index.js'
import { Button, type ButtonProps } from './ui/button.js'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu.js'
import { CONSOLE_BREAKPOINTS_REM, useContainerAtLeast } from './use-container-width.js'

/**
 * One page or row action (ADR 0063 D15 第 4 条): always has a visible label. Rendered as a button
 * where there is room, as an item of the 「更多」 menu where there is not.
 */
export interface PageAction {
  /** Stable key; defaults to the label. */
  readonly key?: string
  readonly label: string
  readonly onSelect: () => void
  readonly icon?: LucideIcon
  /**
   * `primary` is the solid brand button — at most one per view (zhinjs/console#125); `destructive`
   * renders the outline button with destructive text (ADR 0063 决策 5).
   */
  readonly tone?: 'default' | 'primary' | 'destructive'
  readonly disabled?: boolean
}

function buttonVariant(action: PageAction): ButtonProps['variant'] {
  if (action.tone === 'destructive') return 'destructive-outline'
  if (action.tone === 'primary') return 'primary'
  return 'outline'
}

function ActionButton({ action, size }: { action: PageAction; size?: ButtonProps['size'] }) {
  const Icon = action.icon
  return (
    <Button type="button" variant={buttonVariant(action)} size={size} disabled={action.disabled} onClick={action.onSelect}>
      {Icon ? <Icon strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" /> : null}
      {action.label}
    </Button>
  )
}

export interface MoreMenuProps {
  readonly actions: readonly PageAction[]
  /** Trigger text; defaults to 「更多」. The trigger always shows its text (D15 第 4 条). */
  readonly label?: string
  readonly size?: ButtonProps['size']
  readonly align?: 'start' | 'end'
  readonly className?: string
}

/** The 「更多」 menu: actions that do not get a button of their own. Destructive items come last. */
export function MoreMenu({ actions, label, size, align = 'end', className }: MoreMenuProps) {
  const i18n = useConsoleUiI18n()
  if (!actions.length) return null
  const regular = actions.filter(action => action.tone !== 'destructive')
  const destructive = actions.filter(action => action.tone === 'destructive')
  const item = (action: PageAction) => {
    const Icon = action.icon
    return (
      <DropdownMenuItem
        key={action.key ?? action.label}
        disabled={action.disabled}
        onSelect={action.onSelect}
        className={cn(action.tone === 'destructive' && 'text-destructive focus:text-destructive')}
      >
        {Icon ? <Icon strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" /> : null}
        {action.label}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size} className={cn('console-more-trigger', className)}>
          <MoreHorizontal strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" />
          {label ?? i18n.t('actions.more')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {regular.map(item)}
        {regular.length && destructive.length ? <DropdownMenuSeparator /> : null}
        {destructive.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface PageActionsProps {
  /** Always visible (refresh control, custom controls). Wraps instead of leaving the viewport. */
  readonly children?: ReactNode
  /** Buttons where the header is at least 40rem wide; collapsed into 「更多」 below that. */
  readonly actions?: readonly PageAction[]
  /** Always in the 「更多」 menu. */
  readonly moreActions?: readonly PageAction[]
  readonly className?: string
}

/**
 * Header actions (ADR 0063 D18 第 7 条): what does not fit goes into the 「更多」 menu, so no
 * control is ever pushed out of the viewport. Measures its own width, i.e. the header's.
 */
export function PageActions({ children, actions = [], moreActions = [], className }: PageActionsProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const wide = useContainerAtLeast(ref, CONSOLE_BREAKPOINTS_REM.sm) ?? true
  const inline = wide ? actions : actions.filter(action => action.tone === 'primary').slice(0, 1)
  const collapsed = [...actions.filter(action => !inline.includes(action)), ...moreActions]
  if (children == null && !actions.length && !moreActions.length) return null
  return (
    <div ref={ref} className={cn('console-page-actions', className)} data-slot="page-actions">
      {children}
      {inline.map(action => <ActionButton key={action.key ?? action.label} action={action} />)}
      <MoreMenu actions={collapsed} />
    </div>
  )
}

export interface RowActionsProps {
  /** The main action of the row, shown with its label. */
  readonly primary?: PageAction
  /** Everything else, in the 「更多」 menu (D15 第 4 条). */
  readonly more?: readonly PageAction[]
  readonly className?: string
}

/** Actions of one table row or list item: one labelled button, the rest in 「更多」. */
export function RowActions({ primary, more = [], className }: RowActionsProps) {
  return (
    <div className={cn('inline-flex items-center justify-end gap-2', className)} data-slot="row-actions">
      {primary ? <ActionButton action={primary} size="sm" /> : null}
      <MoreMenu actions={more} size="sm" />
    </div>
  )
}
