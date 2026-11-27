import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

const SECONDARY = "bg-sunken text-ink"
const TEXT = "bg-transparent text-ink"

/**
 * Button variants (soft cards, ADR 0063 D39; the names of D25 stay):
 *   primary             solid black / white (`primary` / `on-primary`) — at most one per screen
 *   secondary           sunken fill, ink text — the everyday button
 *   soft                the former default: now the same as `secondary` (still the default variant)
 *   white               white surface with shadow-sm — on tinted, hero and sunken backgrounds
 *   outline             surface with a hairline ring (kept; prefer `secondary` or `white`)
 *   ghost / text        no fill, ink text with an underline (`ghost` keeps hover fill, no underline)
 *   link                same as `text`
 *   danger-text         no fill, danger text
 *   destructive         kept: the same as `danger-text`
 *   destructive-outline kept: surface + hairline ring + danger text
 *   destructive / danger-solid  `destructive-solid` (and its alias `danger`): danger-solid with white
 *                       text — only the confirm button of a dangerous action
 * Sizes: `default` / `lg` 48, `sm` 36, `icon` 48 round (`icon-sm` 36). States: hover 4 % ink, press
 * 8 % + scale 98 %, 2px focus ring with a 2px gap, disabled 40 %, `loading` (spinner, same width).
 */
const buttonVariants = cva(
  "console-control console-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: SECONDARY,
        soft: SECONDARY,
        white: "bg-surface text-ink shadow-e1",
        outline: "bg-surface text-ink shadow-hairline",
        ghost: "bg-transparent text-ink",
        text: TEXT,
        link: TEXT,
        "danger-text": "bg-transparent text-danger",
        destructive: "bg-transparent text-danger",
        "destructive-outline": "bg-surface text-destructive shadow-hairline",
        "destructive-solid": "bg-danger-solid text-on-danger-solid",
        danger: "bg-danger-solid text-on-danger-solid",
      },
      size: {
        default: "h-control",
        lg: "h-control",
        sm: "h-control-compact",
        icon: "size-control",
        "icon-sm": "size-control-compact",
      },
    },
    defaultVariants: {
      variant: "soft",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Waiting state: the label is replaced by a spinner, the button keeps its width, is busy
   * (`aria-busy`) and does not take clicks. The label stays the accessible name.
   */
  loading?: boolean
}

const Slot = Radix.Slot.Root

function Spinner() {
  return (
    <svg className="console-button-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, onClick, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const resolvedVariant = variant ?? "soft"
    const resolvedSize = size ?? "default"
    return (
      <Comp
        data-slot="button"
        data-variant={resolvedVariant}
        data-size={resolvedSize === "icon-sm" ? "icon" : resolvedSize === "lg" ? "default" : resolvedSize}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : disabled}
        aria-disabled={asChild && disabled ? true : undefined}
        aria-busy={loading ? true : undefined}
        onClick={loading ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick}
        {...props}
      >
        {asChild ? children : loading ? <><span className="inline-flex items-center gap-2">{children}</span><Spinner /></> : children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
