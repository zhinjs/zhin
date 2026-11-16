import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'

const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        data-slot="input"
        className={cn(
          "console-control flex min-h-20 w-full rounded-control border border-input bg-card hover:border-foreground/45 focus-visible:border-primary px-3 py-2 leading-relaxed text-body placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
