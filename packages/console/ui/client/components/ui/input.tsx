import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'
import { controlVariantClass, type ControlVariant } from './control-variant.js'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** `ghost`: no border until hovered or focused, for secondary fields (ADR 0063 D29). */
  variant?: ControlVariant
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        data-variant={variant === 'ghost' ? 'ghost' : undefined}
        className={cn(
          "console-control flex h-control w-full rounded-control border px-3 py-1 text-body transition-colors file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
          controlVariantClass(variant),
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
