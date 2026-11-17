import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

const SOFT = "border-primary-action-border bg-primary-action text-primary-action-foreground hover:border-primary hover:bg-primary-action/72"

/**
 * Button variants (ADR 0063 「色板角色与信号色」, zhinjs/console#125):
 *   primary             solid brand, dark text — at most one per view (the next step: 登录, 保存, 发送, 筛选)
 *   soft                palette tint, the default variant (the `default` alias was removed in ADR 0063 P4)
 *   outline / secondary / ghost / link
 *   destructive         ghost: destructive text, no fill — every dangerous entry point on a page
 *   destructive-outline outline button with destructive text (ADR 0063 决策 5)
 *   destructive-solid   solid red — only the confirm button of a confirmation dialog
 */
const buttonVariants = cva(
  "console-control inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border border-transparent text-body font-medium transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The light-theme brand (#76EEC6) is close to white, so the brand-text hairline gives the button its edge.
        primary: "border-brand-text/70 bg-brand text-brand-foreground hover:bg-brand/85 dark:border-transparent",
        soft: SOFT,
        destructive: "text-destructive hover:bg-destructive/8",
        outline: "border-[color:var(--console-border-strong)] bg-card text-foreground hover:bg-[var(--console-surface-hover)]",
        // Page-level entry to a dangerous action (ADR 0063 决策 5): the outline button with destructive text.
        "destructive-outline": "border-[color:var(--console-border-strong)] bg-card text-destructive hover:bg-[var(--console-surface-hover)]",
        // Only for the confirm button inside a confirmation dialog (ConfirmDialog variant="destructive").
        "destructive-solid": "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-[var(--console-surface-hover)]",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-control px-3",
        sm: "h-control-compact px-3 text-label",
        lg: "h-control px-4",
        icon: "size-control shrink-0",
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
}

const Slot = Radix.Slot.Root

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
