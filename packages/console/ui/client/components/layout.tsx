import { useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn.js'
import { useConsoleUiI18n } from '../i18n/index.js'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from './ui/sheet.js'
import { CONSOLE_BREAKPOINTS_REM, useContainerAtLeast } from './use-container-width.js'

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Said once, under the title (D15 第 2 条). */
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

/** A content block of a page: title, one description, actions, then its content (stack gap). */
export function Section({ title, description, actions, children, className, ...rest }: SectionProps) {
  return (
    <section className={cn('console-section', className)} data-slot="section" {...rest}>
      {title != null || description != null || actions != null ? (
        <div className="console-section-header">
          <div className="console-section-heading">
            {title != null ? <h2 className="console-section-title">{title}</h2> : null}
            {description != null ? <p className="console-section-description">{description}</p> : null}
          </div>
          {actions != null ? <div className="console-page-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface GridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode
  /** Narrowest column before the grid drops a column; default 16rem. */
  min?: string
  className?: string
  /** Accessible name when the grid is a landmark of its own. */
  label?: string
}

/** Card grid: `repeat(auto-fit, minmax(min(100%, min), 1fr))` with the grid gap (D18 第 3 条). */
export function Grid({ children, min, className, label, style: ownStyle, ...rest }: GridProps) {
  const style = min ? ({ ...ownStyle, '--grid-min': min } as CSSProperties) : ownStyle
  return (
    <div className={cn('console-grid', className)} style={style} data-slot="grid" role={label ? 'group' : undefined} aria-label={label} {...rest}>
      {children}
    </div>
  )
}

export interface ListDetailProps {
  /** The list (usually a Table). */
  list: ReactNode
  /** Detail of the selected item; `null` / `undefined` when nothing is selected. */
  detail?: ReactNode
  /** Title of the detail panel (used by the sheet on narrow containers). */
  detailTitle?: ReactNode
  /** Called when the user closes the detail sheet on narrow containers. */
  onDetailClose?: () => void
  className?: string
}

/**
 * List + detail (ADR 0063 D18 第 5 条): from 90rem of container width the detail sits in a right
 * column next to the list; below that it opens in a side sheet. Pages must not build this
 * themselves.
 */
export function ListDetail({ list, detail, detailTitle, onDetailClose, className }: ListDetailProps) {
  const i18n = useConsoleUiI18n()
  const ref = useRef<HTMLDivElement | null>(null)
  const split = useContainerAtLeast(ref, CONSOLE_BREAKPOINTS_REM.xl) ?? false
  const hasDetail = detail != null
  return (
    <div ref={ref} className={cn('console-list-detail-frame', className)} data-slot="list-detail">
      <div className="console-list-detail" data-split={split && hasDetail ? 'true' : undefined}>
        <div className="console-list-detail-list">{list}</div>
        {split && hasDetail ? (
          <aside className="console-list-detail-aside" aria-label={typeof detailTitle === 'string' ? detailTitle : i18n.t('listDetail.detail')}>
            {detail}
          </aside>
        ) : null}
      </div>
      {!split ? (
        <Sheet open={hasDetail} onOpenChange={open => { if (!open) onDetailClose?.() }}>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>{detailTitle ?? i18n.t('listDetail.detail')}</SheetTitle>
            </SheetHeader>
            <SheetBody>{detail}</SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}
