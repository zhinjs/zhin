import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const SwitchPrimitive = Radix.Switch
import { cn } from '../../cn.js'

/** Switch (soft cards, ADR 0063 D39): 46 × 28; off = control track, on = primary track (`role="switch"`, `aria-checked`). */
const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "console-control console-touch console-switch peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-0 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-primary data-[state=unchecked]:bg-control",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "console-switch-thumb pointer-events-none block rounded-full"
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = "Switch"

export { Switch }
