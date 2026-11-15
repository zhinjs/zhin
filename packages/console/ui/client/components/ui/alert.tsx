import type * as React from "react"
import { forwardRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

const alertVariants = cva(
  "relative w-full rounded-[var(--console-radius-lg)] border-[length:var(--console-border-width)] px-4 py-3 text-[length:var(--console-text-body)] leading-relaxed [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-foreground",
        destructive:
          "border-destructive/30 bg-destructive/5 text-destructive dark:border-destructive/40 [&>svg]:text-destructive",
        success:
          "console-badge-success [&>svg]:text-[hsl(var(--success))]",
        warning:
          "console-badge-warning [&>svg]:text-[hsl(var(--warning))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-normal", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-[length:var(--console-text-body)] [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
