import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const SwitchPrimitive = Radix.Switch
import { cn } from '../../cn.js'

const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "console-control console-touch peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent px-px transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand-text data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = "Switch"

export { Switch }
