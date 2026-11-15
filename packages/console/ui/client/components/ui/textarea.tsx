import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'

const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "console-control flex min-h-[88px] w-full rounded-[var(--console-radius-md)] border-[length:var(--console-border-width)] border-input bg-card hover:border-[hsl(var(--foreground)/0.45)] focus-visible:border-[hsl(var(--primary))] shadow-[var(--console-shadow-xs)] px-3 py-2 leading-relaxed text-[length:var(--console-text-body)] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
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
