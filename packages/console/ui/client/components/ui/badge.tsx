import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

const badgeVariants = cva(
  "console-badge transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary-action-border bg-primary-action text-primary-action-foreground",
        secondary: "border-transparent bg-foreground/6 text-secondary-foreground",
        destructive: "console-badge-danger",
        outline: "border-[color:var(--console-border-strong)] text-foreground",
        // 「正常」 is not a colored badge (ADR 0063 D15 第 1 条): success renders as muted text.
        success: "console-status-quiet border-transparent px-0",
        warning: "console-badge-warning",
        info: "console-badge-info",
      },
      // One badge implementation (D16): `sm` is kept for compatibility and renders the same.
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

export type BadgeProps = React.ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof badgeVariants>

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
