import type * as React from "react"
import { forwardRef, useId } from "react"
import * as Radix from "radix-ui"
import { Minus, Plus } from "lucide-react"
import { cn } from '../../cn.js'
import { useConsoleUiI18n } from '../../i18n/index.js'
import { CONSOLE_ICON_STROKE_WIDTH } from '../icon.js'

/**
 * Soft-card components (ADR 0063 D39–D41): tiles, chips, segments, steppers, banners, hero cards,
 * list rows, web and phone navigation, the aurora and the action bar. Styles: styles/soft.css.
 */

const Slot = Radix.Slot.Root

/** Category tone of the soft-card palette: 1–5 (tint fill + accent icon) or neutral (sunken + ink). */
export type CategoryTone = 1 | 2 | 3 | 4 | 5 | "neutral"

/* ───────────────────────────── Tile ───────────────────────────── */

export interface TileProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 1–5: tint fill with the accent colour for the icon; `neutral` (default): sunken + ink. */
  tone?: CategoryTone | "primary" | "danger"
  /** 40 (`md`, default), 32 (`sm`) or 48 (`lg`). */
  size?: "sm" | "md" | "lg"
  /**
   * The tile holds text (an initial, a number) instead of an icon: the text is ink, because the
   * accent colours only reach 3:1 and may only draw shapes (D34).
   */
  text?: boolean
}

/** Round icon block (`sc-tile`). Decorative by default (`aria-hidden`) unless it has a label. */
const Tile = forwardRef<HTMLSpanElement, TileProps>(({ className, tone = "neutral", size = "md", text, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="tile"
    data-tone={tone === "neutral" ? undefined : String(tone)}
    data-size={size === "md" ? undefined : size}
    data-text={text ? "" : undefined}
    aria-hidden={props["aria-label"] || props.role ? undefined : true}
    className={cn("console-tile", className)}
    {...props}
  />
))
Tile.displayName = "Tile"

/* ───────────────────────────── Chip ───────────────────────────── */

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Pressed state (`aria-pressed`): pressed chips are primary (black / white). Omit for a plain action chip. */
  pressed?: boolean
  /** Called with the next pressed state. */
  onPressedChange?: (pressed: boolean) => void
  /** Light category tint (1–5) for unpressed chips. */
  tone?: Exclude<CategoryTone, "neutral">
  asChild?: boolean
}

/** Filter / toggle pill (`sc-chip`): 36 tall; `aria-pressed` marks the selection. */
const Chip = forwardRef<HTMLButtonElement, ChipProps>(({ className, pressed, onPressedChange, tone, asChild, onClick, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type ?? "button"}
      data-slot="chip"
      data-tone={tone}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn("console-control console-chip", className)}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (!event.defaultPrevented && pressed !== undefined) onPressedChange?.(!pressed)
      }}
      {...props}
    />
  )
})
Chip.displayName = "Chip"

/* ───────────────────────────── Segmented ───────────────────────────── */

export interface SegmentedOption<T extends string = string> {
  readonly value: T
  readonly label: React.ReactNode
  readonly disabled?: boolean
}

export interface SegmentedProps<T extends string = string> extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "role"> {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  /** Accessible name of the group (required: a tablist or radiogroup needs one). */
  "aria-label": string
  /**
   * `tablist` (default, the soft-card spec: `tab` + `aria-selected`) or `radiogroup` (`radio` +
   * `aria-checked`) for a plain filter that switches no panel. Keyboard and look are the same.
   */
  role?: "tablist" | "radiogroup"
}

/**
 * Where the arrow keys, Home and End move in a segmented control: the index into `enabled`, or
 * -1 for any other key. `current` is the index of the selected option (-1 when the value is not
 * one of the enabled options: the first key then starts from the ends).
 */
function segmentedKeyTarget(key: string, current: number, count: number): number {
  if (count === 0) return -1
  if (key === "ArrowRight" || key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count
  if (key === "ArrowLeft" || key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return -1
}

/**
 * Segmented control (`sc-seg`, `role="tablist"` or `radiogroup`): 2–4 short options, the selected
 * one primary. Arrow keys, Home and End move the selection (roving tabindex; when `value` is none
 * of the options, the first enabled one takes the focus). An `onKeyDown` of your own runs first and
 * can `preventDefault()` to keep the key. For tabbed panels use `Tabs`, which renders the same look.
 */
function Segmented<T extends string = string>({ options, value, onValueChange, className, onKeyDown, role = "tablist", ...props }: SegmentedProps<T>) {
  const enabled = options.filter((option) => !option.disabled)
  const itemRole = role === "radiogroup" ? "radio" : "tab"
  const focusValue = enabled.some((option) => option.value === value) ? value : enabled[0]?.value
  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const next = segmentedKeyTarget(event.key, enabled.findIndex((option) => option.value === value), enabled.length)
    if (next < 0 || !enabled[next]) return
    event.preventDefault()
    onValueChange(enabled[next].value)
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(`[role="${itemRole}"]:not(:disabled)`)
    buttons[next]?.focus()
  }
  return (
    <div role={role} data-slot="segmented" className={cn("console-segmented", className)} onKeyDown={move} {...props}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role={itemRole}
            aria-selected={itemRole === "tab" ? selected : undefined}
            aria-checked={itemRole === "radio" ? selected : undefined}
            tabIndex={option.value === focusValue && !option.disabled ? 0 : -1}
            disabled={option.disabled}
            className="console-control console-touch console-segment flex-1"
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────────── Stepper ───────────────────────────── */

export interface StepperProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Unit shown with the value (`次`, `秒内`, `张`): the stepper says what it counts (D39). */
  unit?: string
  /** Formats the value; default: the number and the unit. */
  format?: (value: number) => React.ReactNode
  /** Accessible name of the value (e.g. the row title). */
  label: string
  disabled?: boolean
}

/**
 * Stepper (`sc-stepper`): − / + buttons and an `<output>` with the value and its unit. At a limit
 * the button is `aria-disabled` and ignores presses but keeps the focus (a `disabled` button would
 * drop it to the page); `disabled` turns the whole stepper off.
 */
function Stepper({ value, onValueChange, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, step = 1, unit, format, label, disabled, className, ...props }: StepperProps) {
  const i18n = useConsoleUiI18n()
  const id = useId()
  const set = (next: number) => onValueChange(Math.min(max, Math.max(min, next)))
  const shown = format ? format(value) : unit ? `${value} ${unit}` : String(value)
  const atMin = value <= min
  const atMax = value >= max
  return (
    <div data-slot="stepper" role="group" aria-label={label} className={cn("console-stepper", className)} {...props}>
      <button type="button" className="console-control console-touch console-stepper-button" aria-label={i18n.t('stepper.decrease')} aria-controls={id} disabled={disabled} aria-disabled={!disabled && atMin ? true : undefined} onClick={() => { if (!atMin) set(value - step) }}>
        <Minus aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} />
      </button>
      <output id={id} className="console-stepper-value" aria-live="polite">{shown}</output>
      <button type="button" className="console-control console-touch console-stepper-button" aria-label={i18n.t('stepper.increase')} aria-controls={id} disabled={disabled} aria-disabled={!disabled && atMax ? true : undefined} onClick={() => { if (!atMax) set(value + step) }}>
        <Plus aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} />
      </button>
    </div>
  )
}

/* ───────────────────────────── Banner ───────────────────────────── */

export interface BannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** `warn` (warn-bg), `danger` (danger-bg) or `neutral` (sunken). */
  tone?: "warn" | "danger" | "neutral"
  /** The one short state (≤ 8 characters: 「通知未开启」). */
  children: React.ReactNode
  /** The one action — usually `<Button variant="white" size="sm">去开启</Button>`. */
  action?: React.ReactNode
  icon?: React.ReactNode
}

/**
 * Banner (`sc-banner`): one short state and one white button — never a paragraph explaining why.
 * `role="status"` (warn / neutral) or `role="alert"` (danger).
 */
const Banner = forwardRef<HTMLDivElement, BannerProps>(({ tone = "neutral", children, action, icon, className, ...props }, ref) => (
  <div
    ref={ref}
    role={tone === "danger" ? "alert" : "status"}
    data-slot="banner"
    data-tone={tone === "neutral" ? undefined : tone}
    className={cn("console-banner", className)}
    {...props}
  >
    {icon}
    <span className="console-banner-text">{children}</span>
    {action}
  </div>
))
Banner.displayName = "Banner"

/* ───────────────────────────── HeroCard ───────────────────────────── */

export interface HeroCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** `hero` (apricot → pink, default) or `hero-2` (mint → cream). */
  variant?: "hero" | "hero-2"
  title?: React.ReactNode
  description?: React.ReactNode
  asChild?: boolean
}

/** Hero card (`sc-hero`): the one most important thing of a first-level page — at most one per page. */
const HeroCard = forwardRef<HTMLElement, HeroCardProps>(({ variant = "hero", title, description, children, className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "section"
  return (
    <Comp ref={ref as React.Ref<HTMLElement>} data-slot="hero" data-variant={variant} className={cn("console-hero", className)} {...props}>
      {asChild ? children : <>
        {title ? <h2 className="console-hero-title">{title}</h2> : null}
        {description ? <p className="console-hero-description">{description}</p> : null}
        {children}
      </>}
    </Comp>
  )
})
HeroCard.displayName = "HeroCard"

/* ───────────────────────────── Lists ───────────────────────────── */

export interface ListCaptionProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level of the caption (default 3). */
  level?: 2 | 3 | 4
}

/** Group caption above a list card (`sc-cap`): 12px muted, indented 16 to line up with the row text; ≤ 6 characters. */
const ListCaption = forwardRef<HTMLHeadingElement, ListCaptionProps>(({ level = 3, className, ...props }, ref) => {
  const Tag = `h${level}` as "h3"
  return <Tag ref={ref} data-slot="list-caption" className={cn("console-list-caption", className)} {...props} />
})
ListCaption.displayName = "ListCaption"

export interface ListGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rows without tiles: dividers start at 16 instead of 68. */
  plain?: boolean
}

/** A white card of rows (`sc-card` with `sc-row`s). Put `ListRow`s (or `<li>`s holding them) inside. */
const ListGroup = forwardRef<HTMLDivElement, ListGroupProps>(({ plain, className, ...props }, ref) => (
  <div ref={ref} data-slot="list-group" data-plain={plain ? "" : undefined} className={cn("console-list-group", className)} {...props} />
))
ListGroup.displayName = "ListGroup"

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Left: usually a `<Tile>` (40). Rows without one should be `plain`. */
  icon?: React.ReactNode
  title: React.ReactNode
  /** One line, ≤ 18 characters. */
  description?: React.ReactNode
  /** Right: exactly one thing — a value, a switch, a chevron, a status or one button. */
  end?: React.ReactNode
  /** Changed from its default: a progress-coloured dot before the title. */
  changed?: boolean
  /**
   * Selected: primary-soft fill and a 3px primary bar. A link row gets `aria-current="page"`, a
   * button row `aria-pressed` (pass your own `aria-current`, e.g. `"true"` for the open item of a
   * list + detail, to use that instead).
   */
  selected?: boolean
  /** No tile: dividers start at the text (16). */
  plain?: boolean
  /** Render as a link (`href`), a button (`onClick` without `href`) or as given (`asChild`). */
  href?: string
  asChild?: boolean
  /** Dimmed and inert: a button row is `disabled`; a link row loses its `href` (it no longer navigates) and is `aria-disabled`. */
  disabled?: boolean
}

/**
 * List row (`sc-row`): tile → title + one line → one thing on the right. A whole row is clickable
 * (`href` / `onClick`) only when it holds no other button.
 */
const ListRow = forwardRef<HTMLElement, ListRowProps>(({ icon, title, description, end, changed, selected, plain, href, asChild, disabled, className, onClick, children, ...props }, ref) => {
  const Comp = asChild ? Slot : href !== undefined ? "a" : onClick ? "button" : "div"
  const isButton = Comp === "button"
  const isLink = Comp === "a"
  const ownCurrent = props["aria-current"] !== undefined
  return (
    <Comp
      ref={ref as React.Ref<never>}
      data-slot="list-row"
      data-plain={plain ? "" : undefined}
      data-selected={selected ? "" : undefined}
      aria-current={selected && isLink ? "page" : undefined}
      aria-pressed={isButton && selected !== undefined && !ownCurrent ? selected : undefined}
      aria-disabled={disabled && !isButton ? true : undefined}
      href={isLink && disabled ? undefined : href}
      type={isButton ? "button" : undefined}
      disabled={isButton ? disabled : undefined}
      onClick={disabled && !isButton ? undefined : onClick}
      className={cn("console-list-row", className)}
      {...props}
    >
      {asChild ? children : <>
        {icon}
        <span className="console-list-row-body">
          <span className="console-list-row-title">{changed ? <ChangedDot /> : null}{title}</span>
          {description ? <span className="console-list-row-description">{description}</span> : null}
        </span>
        {end !== undefined && end !== null ? <span className="console-list-row-end">{end}</span> : null}
      </>}
    </Comp>
  )
})
ListRow.displayName = "ListRow"

/** The 「改过默认值」 dot (`sc-changed`) before a setting's name. Decorative: write the default below (「默认 0」). */
function ChangedDot({ className }: { className?: string }) {
  return <span aria-hidden="true" data-slot="changed" className={cn("console-changed", className)} />
}

/* ───────────────────────────── Navigation ───────────────────────────── */

export interface NavItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  icon?: React.ReactNode
  asChild?: boolean
}

/** Current web page (`sc-nav-pill`): a black pill with its icon and name (`aria-current="page"`). */
const NavPill = forwardRef<HTMLAnchorElement, NavItemProps>(({ icon, children, className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"
  return (
    <Comp ref={ref} data-slot="nav-pill" aria-current="page" className={cn("console-control console-nav-pill", className)} {...props}>
      {asChild ? children : <>{icon}{children}</>}
    </Comp>
  )
})
NavPill.displayName = "NavPill"

export interface NavIconProps extends NavItemProps {
  /** The page name (required: the icon is the only content). */
  label: string
}

/** Other web pages (`sc-nav-icon`): a white round icon with the page name as its label. */
const NavIcon = forwardRef<HTMLAnchorElement, NavIconProps>(({ icon, label, children, className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"
  return (
    <Comp ref={ref} data-slot="nav-icon" aria-label={label} title={label} className={cn("console-control console-nav-icon", className)} {...props}>
      {asChild ? children : icon}
    </Comp>
  )
})
NavIcon.displayName = "NavIcon"

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the icon is the only content. */
  "aria-label": string
  /** `white` (44, shadow-sm, default), `flat` (sunken) or `soft` (40, primary-soft — row-end actions). */
  variant?: "white" | "flat" | "soft"
  asChild?: boolean
}

/** Round icon button (`sc-icon-btn`). */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({ variant = "white", className, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type ?? "button"}
      data-slot="icon-button"
      data-variant={variant === "white" ? undefined : variant}
      className={cn("console-control console-icon-button", className)}
      {...props}
    />
  )
})
IconButton.displayName = "IconButton"

export interface TabBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Accessible name of the navigation. */
  "aria-label": string
  /** Fixed to the bottom of the viewport (the phone layout); off: placed in the flow. */
  floating?: boolean
}

/** Phone bottom navigation (`sc-tabbar`): a floating pill with 4–5 `TabBarItem`s. */
const TabBar = forwardRef<HTMLElement, TabBarProps>(({ floating, className, ...props }, ref) => (
  <nav ref={ref} data-slot="tabbar" data-floating={floating ? "" : undefined} className={cn("console-tabbar", className)} {...props} />
))
TabBar.displayName = "TabBar"

export interface TabBarItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  icon: React.ReactNode
  /** The current page (`aria-current="page"`). */
  current?: boolean
  asChild?: boolean
}

/** One item of the tab bar: icon and label, the current one on primary-soft. */
const TabBarItem = forwardRef<HTMLAnchorElement, TabBarItemProps>(({ icon, current, children, className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"
  return (
    <Comp ref={ref} data-slot="tabbar-item" aria-current={current ? "page" : undefined} className={cn("console-control console-tabbar-item", className)} {...props}>
      {asChild ? children : <>{icon}{children}</>}
    </Comp>
  )
})
TabBarItem.displayName = "TabBarItem"

/* ───────────────────────────── Aurora, ActionBar ───────────────────────────── */

/**
 * Aurora (`sc-aurora`): four faint radial blobs at the top of a first-level page (320 on phones,
 * 420 on the web), fading down. Place it as the first child of a `console-aurora-host` (or any
 * positioned container); text on it is ink or muted only.
 */
function Aurora({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" data-slot="aurora" className={cn("console-aurora", className)} {...props} />
}

export interface ActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left: a text button (取消, 还原默认). */
  start?: React.ReactNode
  /** Optional secondary button in the middle. */
  secondary?: React.ReactNode
  /** Right: the one primary button (fills the rest on phones). */
  primary?: React.ReactNode
  /** Sticks to the bottom of the scrolling page, 12 from the edge. */
  floating?: boolean
}

/** Bottom action bar: white, shadow-md, radius 24; text button left, primary right. */
const ActionBar = forwardRef<HTMLDivElement, ActionBarProps>(({ start, secondary, primary, floating = true, className, children, ...props }, ref) => (
  <div ref={ref} role="group" data-slot="action-bar" data-floating={floating ? "" : undefined} className={cn("console-action-bar console-cq", className)} {...props}>
    <div className="contents">
      {start}
      {secondary}
      {primary ? <div className="console-action-bar-primary">{primary}</div> : null}
      {children}
    </div>
  </div>
))
ActionBar.displayName = "ActionBar"

export {
  ActionBar,
  Aurora,
  Banner,
  ChangedDot,
  Chip,
  HeroCard,
  IconButton,
  ListCaption,
  ListGroup,
  ListRow,
  NavIcon,
  NavPill,
  Segmented,
  Stepper,
  TabBar,
  TabBarItem,
  Tile,
}
