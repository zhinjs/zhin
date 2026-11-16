import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn.js'
import { Card, CardContent, CardFooter, CardHeader } from './ui/card.js'
import { Skeleton } from './ui/skeleton.js'

/**
 * Content blocks for plugin pages and the declarative renderers of `@zhin.js/client` (ADR 0063 P2).
 * They complement the P1b layout components and do not repeat them: sections are `Section`, grids
 * `Grid` / `StatGrid`, statistic cards `StatCard`, tables `Table` (which turns rows into cards in a
 * narrow container by itself). The page shell owns the header (title, description, actions,
 * refresh). Layout follows the container the block is placed in (`.console-cq`), never the
 * viewport (D18): key / value lists fold to one column in a narrow container.
 */

export type ContentTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

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

export interface FormFieldProps {
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly error?: ReactNode
  readonly required?: boolean
  /** `id` of the control, so the label is clickable. */
  readonly htmlFor?: string
  /** Spans the whole row of a `Grid`. */
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
    <div className="console-cq">
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

/** Inline monospace value (IDs, cron expressions, paths); the same look as `InlineCode` (ADR 0063 D31). */
export function CodeText({ children, className }: { readonly children?: ReactNode; readonly className?: string }) {
  return <code data-slot="code" className={cn('console-code console-code-text', className)}>{children}</code>
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

export interface RecordCardField {
  readonly key: string
  readonly label: ReactNode
  readonly value: ReactNode
}

export interface RecordCardProps {
  /** First line of the card. */
  readonly title?: ReactNode
  /** Before the title (checkbox, toggle). */
  readonly leading?: ReactNode
  /** Label / value pairs, shown as a one-column {@link KeyValueList}. */
  readonly fields?: readonly RecordCardField[]
  readonly actions?: ReactNode
  readonly selected?: boolean
  readonly children?: ReactNode
}

/**
 * One record (an account, a connection) as a card: the P1b `Card` with a header, a one-column
 * {@link KeyValueList} and a footer for actions. For table rows use `Table`, which turns its rows
 * into cards by itself in a narrow container.
 */
export function RecordCard({ title, leading, fields = [], actions, selected, children }: RecordCardProps) {
  return (
    <Card data-selected={selected ? 'true' : undefined} data-slot="record-card">
      {title != null || leading != null ? (
        <CardHeader>
          <div className="console-record-card-head">
            {leading}
            {title != null ? <div className="console-record-card-title">{title}</div> : null}
          </div>
        </CardHeader>
      ) : null}
      {fields.length > 0 || children != null ? (
        <CardContent>
          <ContentStack>
            {fields.length > 0 ? <KeyValueList columns={1} items={fields} /> : null}
            {children}
          </ContentStack>
        </CardContent>
      ) : null}
      {actions != null ? <CardFooter><div className="console-page-actions">{actions}</div></CardFooter> : null}
    </Card>
  )
}

export interface LoadingBlockProps {
  /** Accessible name of the busy region (e.g. 「加载中…」). */
  readonly label: string
  /** Placeholder lines; default 2. */
  readonly lines?: number
}

/** Placeholder while a block loads: a `role="status"` region with skeleton text lines. */
export function LoadingBlock({ label, lines = 2 }: LoadingBlockProps) {
  return (
    <div role="status" aria-live="polite" aria-label={label} data-loading="" className="console-loading-block">
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <Skeleton key={index} className="console-skeleton-line" />)}
    </div>
  )
}
