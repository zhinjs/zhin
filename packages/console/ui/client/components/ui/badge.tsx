import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-full border-[length:var(--console-border-width)] text-[length:var(--console-text-label)] font-medium leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-[hsl(var(--primary-action-border))] bg-[hsl(var(--primary-action))] text-[hsl(var(--primary-action-foreground))]",
        secondary: "border-transparent bg-[hsl(var(--foreground)/0.06)] text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-[color:var(--console-border-strong)] text-foreground",
        success: "console-badge-success",
        warning: "console-badge-warning",
        info: "console-badge-info",
      },
      // Badge text never goes below the label role (12px); "sm" only tightens spacing.
      size: {
        default: "px-2.5 py-0.5",
        sm: "px-1.5 py-0",
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
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
