import type * as React from "react"
import { forwardRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from '../../cn.js'

/**
 * Alert (soft cards, ADR 0063 D39): a banner — one short state, optionally one white button
 * (`<Button variant="white" size="sm">`) — on the state's -bg fill, no border, radius 24. For new
 * code prefer `Banner`; Alert keeps its title / description slots for longer messages.
 */
const alertVariants = cva(
  "console-alert relative flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-hero border-0 py-3 pl-4 pr-3 text-body [&>svg]:size-5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-sunken text-ink",
        destructive: "bg-danger-bg text-danger",
        success: "bg-ok-bg text-ok",
        warning: "bg-warn-bg text-warn",
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
    className={cn("min-w-0 flex-1 font-medium", className)}
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
    className={cn("w-full text-label text-muted-foreground [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
