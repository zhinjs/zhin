import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const CheckboxPrimitive = Radix.Checkbox
import { cn } from '../../cn.js'
import { Check, Minus } from "lucide-react"
import { CONSOLE_ICON_STROKE_WIDTH } from '../icon.js'

/** Checkbox (soft cards, CForms): 22px, radius 6, 1.5px control border; checked = primary fill with an on-primary check. */
const Checkbox = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "console-control console-touch console-check peer inline-flex shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="group/indicator flex items-center justify-center text-current">
      <Check strokeWidth={CONSOLE_ICON_STROKE_WIDTH} className="hidden size-3.5 group-data-[state=checked]/indicator:block" />
      <Minus strokeWidth={CONSOLE_ICON_STROKE_WIDTH} className="hidden size-3.5 group-data-[state=indeterminate]/indicator:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = "Checkbox"

export { Checkbox }
