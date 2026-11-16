import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const CheckboxPrimitive = Radix.Checkbox
import { cn } from '../../cn.js'
import { Check, Minus } from "lucide-react"

const Checkbox = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "console-control console-touch peer inline-flex size-4 shrink-0 items-center justify-center rounded-check border border-input bg-card text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="group/indicator flex items-center justify-center text-current">
      <Check className="hidden h-3.5 w-3.5 group-data-[state=checked]/indicator:block" />
      <Minus className="hidden h-3.5 w-3.5 group-data-[state=indeterminate]/indicator:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = "Checkbox"

export { Checkbox }
