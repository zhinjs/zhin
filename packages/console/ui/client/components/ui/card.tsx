import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  /**
   * The card fills the page column edge to edge on phone-width pages (below 40rem it reaches the
   * screen edges and has no radius, ADR 0063 D16). Only for cards placed directly in the page.
   */
  edge?: boolean
}

/** Card: hairline border, no shadow when static; interactive cards lift (e-1) on wide containers. */
const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, edge, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card"
      data-interactive={interactive ? "" : undefined}
      data-edge={edge ? "" : undefined}
      className={cn(
        "console-card text-card-foreground",
        interactive && "console-card--interactive",
        className,
      )}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("console-card-header", className)} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("console-section-title", className)} {...props} />
  )
)
CardTitle.displayName = "CardTitle"

const CardDescription = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("console-text-body text-muted-foreground", className)} {...props} />
  )
)
CardDescription.displayName = "CardDescription"

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("console-card-content", className)} {...props} />
  )
)
CardContent.displayName = "CardContent"

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("console-card-footer", className)} {...props} />
  )
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
