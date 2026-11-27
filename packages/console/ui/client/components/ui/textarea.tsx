import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'
import { controlVariantClass, type ControlVariant } from './control-variant.js'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** `ghost`: no border until hovered or focused, for secondary fields (ADR 0063 D29). */
  variant?: ControlVariant
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <textarea
        data-slot="input"
        data-variant={variant === 'ghost' ? 'ghost' : undefined}
        className={cn(
          "console-control flex min-h-24 w-full",
          controlVariantClass(variant),
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
