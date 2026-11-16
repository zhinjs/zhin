import type * as React from "react"
import { cn } from '../../cn.js'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("console-skeleton rounded-control", className)}
      {...props}
    />
  )
}

export { Skeleton }
