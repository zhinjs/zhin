import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'

const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "console-control flex h-[var(--console-control-height)] w-full rounded-[var(--console-radius-md)] border-[length:var(--console-border-width)] border-input bg-card hover:border-[hsl(var(--foreground)/0.45)] focus-visible:border-[hsl(var(--primary))] shadow-[var(--console-shadow-xs)] px-3 py-1 text-[length:var(--console-text-body)] transition-colors file:border-0 file:bg-transparent file:text-[length:var(--console-text-body)] file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
