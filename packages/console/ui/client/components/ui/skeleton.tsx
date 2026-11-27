import type * as React from "react"
import { cn } from '../../cn.js'

/** Skeleton (soft cards D41): the same size as the real content; sunken, radius 10, breathes. Never 「正在加载」 text. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("console-skeleton", className)}
      {...props}
    />
  )
}

export { Skeleton }
