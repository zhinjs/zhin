import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

const buttonVariants = cva(
  "console-control inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--console-radius-md)] border border-transparent text-[length:var(--console-text-body)] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-[hsl(var(--primary-action-border))] bg-[hsl(var(--primary-action))] text-[hsl(var(--primary-action-foreground))] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-action)/0.72)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border-[color:var(--console-border-strong)] bg-card text-foreground hover:bg-[var(--console-surface-hover)]",
        // Page-level entry to a dangerous action (ADR 0063 决策 5): the outline button with destructive text.
        // The solid `destructive` variant is only for the confirm button inside the confirmation dialog.
        "destructive-outline": "border-[color:var(--console-border-strong)] bg-card text-destructive hover:bg-[var(--console-surface-hover)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-[var(--console-surface-hover)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--console-control-height)] px-3.5 py-1.5",
        sm: "h-[var(--console-control-height-sm)] rounded-[var(--console-radius-md)] px-3 text-[length:var(--console-text-body-sm)]",
        lg: "h-[var(--console-control-height-lg)] rounded-[var(--console-radius-md)] px-5",
        icon: "h-[var(--console-control-height)] w-[var(--console-control-height)] shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
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
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
