import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

/**
 * Badge (soft cards, ADR 0063 D39): a light pill, 12px medium text, no border.
 *   default / secondary / neutral   sunken fill, muted text (versions, counts, 已停用)
 *   success / warning / destructive the state's -bg fill and colour (已启用, 可更新, 加载失败)
 *   info                            sunken fill, ink text
 *   outline                         a primary-line hairline ring
 *   solid                           primary fill (black / white) — counts that need attention
 * `tone` (1–5) gives a category tint with ink text instead; `size` is kept for compatibility.
 */
const badgeVariants = cva(
  "console-badge",
  {
    variants: {
      variant: {
        default: "console-badge-neutral",
        secondary: "console-badge-neutral",
        neutral: "console-badge-neutral",
        destructive: "console-badge-danger",
        outline: "console-badge-outline",
        success: "console-badge-success",
        warning: "console-badge-warning",
        info: "console-badge-info",
        solid: "console-badge-solid",
      },
      size: {
        default: "",
        sm: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export type BadgeTone = 1 | 2 | 3 | 4 | 5

export type BadgeProps = React.ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Category tint 1–5 (ADR 0063 D34): light fill, ink text. Overrides the variant's fill. */
    tone?: BadgeTone
  }

function Badge({ className, variant, size, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" data-variant={variant ?? "default"} data-tone={tone} className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
