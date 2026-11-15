import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * Content blocks for plugin pages and the declarative renderers of `@zhin.js/client` (ADR 0063 P2).
 * The page shell owns the header (title, description, actions, refresh); a page renders these blocks
 * inside it. Layout follows the container the block is placed in (`@container`), never the viewport
 * (D18): stat grids flow with `auto-fit`, key / value lists and tables fold to one column / cards in
 * a narrow container.
 */

export type ContentTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

export interface ContentSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Section heading (an `h2`; the page title belongs to the shell). */
  readonly title?: ReactNode
  /** One line under the heading; say it once per page (D15). */
  readonly description?: ReactNode
  /** Controls on the heading row (search, count, buttons). */
  readonly actions?: ReactNode
  readonly children?: ReactNode
}

/** A titled block of page content. */
export function ContentSection({ title, description, actions, children, className, ...rest }: ContentSectionProps) {
  const hasHead = title != null || description != null || actions != null
  return (
    <section className={cn('console-content-section', className)} {...rest}>
      {hasHead ? (
        <div className="console-content-section-head">
          {title != null || description != null ? (
            <div className="console-content-section-heading">
              {title != null ? <h2 className="console-section-title">{title}</h2> : null}
              {description != null ? <p className="console-content-section-description">{description}</p> : null}
            </div>
          ) : null}
          {actions != null ? <div className="console-content-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface ContentStackProps extends HTMLAttributes<HTMLDivElement> {
  /** `tight` inside a control group, `stack` (default) within a block, `section` between blocks. */
  readonly gap?: 'tight' | 'stack' | 'section'
  readonly direction?: 'column' | 'row'
  /** Rows wrap by default. */
  readonly wrap?: boolean
  readonly align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch'
  readonly justify?: 'start' | 'center' | 'end' | 'between'
}

/** Vertical (default) or horizontal group with a token gap. */
export function ContentStack({ gap = 'stack', direction = 'column', wrap, align, justify, className, ...rest }: ContentStackProps) {
  return (
    <div
      className={cn(
        'console-content-stack',
        `is-gap-${gap}`,
        direction === 'row' && 'is-row',
        direction === 'row' && wrap !== false && 'is-wrap',
        align && `is-align-${align}`,
        justify && `is-justify-${justify}`,
        className,
      )}
      {...rest}
    />
  )
}

export interface ContentGridProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Minimum item width: `stat` (statistic cards; two per row in a phone-width container), `field`
   * (form fields), `card` (default) and `wide` (forms, panels).
   */
  readonly min?: 'stat' | 'field' | 'card' | 'wide'
}

/** Flexible grid, `repeat(auto-fit, minmax(min, 1fr))` (D18 第 3 条). */
export function ContentGrid({ min = 'card', className, ...rest }: ContentGridProps) {
  return (
    <div className="console-content-grid-host">
      <div className={cn('console-content-grid', `is-min-${min}`, className)} {...rest} />
    </div>
  )
}

export interface MetricCardProps {
  readonly label: ReactNode
  /** Small icon before the label (an element, or an image URL). */
  readonly icon?: ReactNode
  readonly value: ReactNode
  readonly unit?: ReactNode
  /** Badge on the label row. */
  readonly badge?: ReactNode
  /** Next to the value (trend badge, sparkline). */
  readonly aside?: ReactNode
  /** Under the value (progress meter). */
  readonly footer?: ReactNode
  readonly hint?: ReactNode
  /** Only `warning` / `danger` change the card; normal values stay neutral (D15). */
  readonly tone?: ContentTone
}

/** Statistic card with the Console's stat-card look; place several in `ContentGrid min="stat"`. */
export function MetricCard({ label, icon, value, unit, badge, aside, footer, hint, tone }: MetricCardProps) {
  return (
    <div className={cn('console-stat-card console-metric-card', (tone === 'danger' || tone === 'warning') && `is-${tone}`)} data-tone={tone ?? 'neutral'}>
      <span className="console-metric-card-head">
        <span className="console-stat-label">
          {typeof icon === 'string' ? <img src={icon} alt="" className="console-metric-card-icon" /> : icon}
          {label}
        </span>
        {badge}
      </span>
      <span className="console-stat-value-row">
        <strong className="console-stat-value">
          {value}
          {unit != null ? <small>{unit}</small> : null}
        </strong>
        {aside}
      </span>
      {footer}
      {hint != null ? <span className="console-stat-sub">{hint}</span> : null}
    </div>
  )
}

export interface FormFieldProps {
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly error?: ReactNode
  readonly required?: boolean
  /** `id` of the control, so the label is clickable. */
  readonly htmlFor?: string
  /** Spans the whole row of a `ContentGrid`. */
  readonly full?: boolean
  readonly className?: string
  readonly children?: ReactNode
}

/** Label, control, hint and error of one form field. */
export function FormField({ label, hint, error, required, htmlFor, full, className, children }: FormFieldProps) {
  return (
    <div className={cn('console-form-field', full && 'is-full', className)}>
      <label className="console-form-field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="console-form-field-required" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {hint != null ? <span className="console-form-field-hint">{hint}</span> : null}
      {error != null ? <span className="console-form-field-error" role="alert">{error}</span> : null}
    </div>
  )
}

export interface KeyValueItem {
  readonly key?: string
  readonly label: ReactNode
  readonly value: ReactNode
  readonly hint?: ReactNode
  /** Greys the value out (e.g. a configured but disabled schedule). */
  readonly muted?: boolean
}

export interface KeyValueListProps {
  readonly items: readonly KeyValueItem[]
  /** Columns in a wide container; always one in a narrow one. */
  readonly columns?: 1 | 2 | 3
  readonly className?: string
}

/** Description list (`dl`) of label / value pairs. */
export function KeyValueList({ items, columns = 2, className }: KeyValueListProps) {
  return (
    <div className="console-kv-host">
      <dl className={cn('console-kv', `is-cols-${columns}`, className)}>
        {items.map((item, index) => (
          <div key={item.key ?? index} className="console-kv-item">
            <dt className="console-kv-label">
              {item.label}
              {item.hint != null ? <span className="console-kv-hint">{item.hint}</span> : null}
            </dt>
            <dd className={cn('console-kv-value', item.muted && 'is-muted')} data-muted={item.muted ? 'true' : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export interface ProgressMeterProps {
  readonly value: number
  readonly max?: number
  readonly tone?: ContentTone
  /** Shows the percentage next to the bar. */
  readonly showValue?: boolean
  /** Accessible name. */
  readonly label?: string
}

/** Horizontal progress bar (`role="progressbar"`). */
export function ProgressMeter({ value, max = 100, tone = 'primary', showValue, label }: ProgressMeterProps) {
  const safeMax = max > 0 ? max : 100
  const clamped = Math.max(0, Math.min(safeMax, Number.isFinite(value) ? value : 0))
  const percent = Math.round((clamped / safeMax) * 100)
  return (
    <span className="console-progress" data-tone={tone}>
      <span
        className="console-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
      >
        <span className="console-progress-bar" style={{ width: `${percent}%` }} />
      </span>
      {showValue ? <span className="console-progress-value">{percent}%</span> : null}
    </span>
  )
}

export interface SparklineProps {
  readonly values: readonly number[]
  readonly tone?: ContentTone
  readonly label?: string
}

/** Tiny trend line; needs at least two finite values. */
export function Sparkline({ values, tone = 'primary', label }: SparklineProps) {
  const points = values.filter(Number.isFinite)
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = 100 / (points.length - 1)
  const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(2)},${(30 - ((point - min) / span) * 28 - 1).toFixed(2)}`).join(' ')
  return (
    <svg className="console-sparkline" data-tone={tone} viewBox="0 0 100 30" preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export interface TimelineItem {
  readonly id: string
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly time?: ReactNode
  readonly tone?: ContentTone
  readonly badge?: ReactNode
}

/** Vertical event list. */
export function Timeline({ items }: { readonly items: readonly TimelineItem[] }) {
  return (
    <ol className="console-timeline">
      {items.map(item => (
        <li key={item.id} className="console-timeline-item" data-tone={item.tone ?? 'neutral'}>
          <span className="console-timeline-dot" aria-hidden="true" />
          <div className="console-timeline-body">
            <div className="console-timeline-head">
              <span className="console-timeline-title">{item.title}</span>
              {item.badge}
              {item.time != null ? <span className="console-timeline-time">{item.time}</span> : null}
            </div>
            {item.description != null ? <p className="console-timeline-description">{item.description}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export interface DisclosureProps {
  readonly summary: ReactNode
  readonly description?: ReactNode
  /** Next to the summary (e.g. a count). */
  readonly badge?: ReactNode
  readonly defaultOpen?: boolean
  readonly className?: string
  readonly children?: ReactNode
}

/**
 * Collapsed by default (`details` / `summary`): for secondary content such as raw IDs and JSON, which
 * plugin pages do not show by default (D18 第 6 条), and for collapsible sections.
 */
export function Disclosure({ summary, description, badge, defaultOpen, className, children }: DisclosureProps) {
  return (
    <details className={cn('console-disclosure', className)} open={defaultOpen || undefined}>
      <summary className="console-disclosure-summary">
        <span className="console-disclosure-title">{summary}</span>
        {badge}
        {description != null ? <span className="console-disclosure-description">{description}</span> : null}
      </summary>
      <div className="console-disclosure-body">{children}</div>
    </details>
  )
}

/** Inline monospace value (IDs, cron expressions, paths). */
export function CodeText({ children, className }: { readonly children?: ReactNode; readonly className?: string }) {
  return <code className={cn('console-code-text', className)}>{children}</code>
}

/** Pretty-printed JSON in a scrollable block. */
export function JsonBlock({ value, className }: { readonly value: unknown; readonly className?: string }) {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    text = String(value)
  }
  return <pre className={cn('console-json-block', className)}>{text}</pre>
}

/** Image result (QR codes, previews) at a bounded size on a light backing. */
export function MediaPreview({ src, alt, className }: { readonly src: string; readonly alt: string; readonly className?: string }) {
  return <img src={src} alt={alt} className={cn('console-media-preview', className)} />
}

export interface ResponsiveTableProps {
  /** The table for a wide container. */
  readonly table: ReactNode
  /** One card per row for a container narrower than `sm` (40rem). */
  readonly cards: ReactNode
  readonly className?: string
}

/**
 * Table in a wide container, cards in a narrow one (D18 第 6 条: no sideways scrolling of a table on
 * a phone). The switch is a container query on this block, so it follows the space the page gives
 * it, not the viewport.
 */
export function ResponsiveTable({ table, cards, className }: ResponsiveTableProps) {
  return (
    <div className={cn('console-responsive-table', className)}>
      <div className="console-responsive-table-wide">{table}</div>
      <div className="console-responsive-table-narrow">{cards}</div>
    </div>
  )
}

export interface RecordCardField {
  readonly key: string
  readonly label: ReactNode
  readonly value: ReactNode
}

export interface RecordCardProps {
  /** First line of the card (usually the first column). */
  readonly title?: ReactNode
  /** Before the title (row checkbox, expand toggle). */
  readonly leading?: ReactNode
  readonly fields: readonly RecordCardField[]
  readonly actions?: ReactNode
  readonly selected?: boolean
  readonly children?: ReactNode
}

/** One table row shown as a card (`ResponsiveTable` narrow view, card lists). */
export function RecordCard({ title, leading, fields, actions, selected, children }: RecordCardProps) {
  return (
    <div className={cn('console-record-card', selected && 'is-selected')} data-selected={selected ? 'true' : undefined}>
      {title != null || leading != null ? (
        <div className="console-record-card-head">
          {leading}
          {title != null ? <span className="console-record-card-title">{title}</span> : null}
        </div>
      ) : null}
      {fields.length > 0 ? (
        <dl className="console-record-card-fields">
          {fields.map(field => (
            <div key={field.key} className="console-record-card-field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      {actions != null ? <div className="console-record-card-actions">{actions}</div> : null}
    </div>
  )
}
