import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"
import { cn } from '../../cn.js'

const RadioGroupPrimitive = Radix.RadioGroup

const RadioGroup = forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} ref={ref} />
))
RadioGroup.displayName = "RadioGroup"

/** Radio (soft cards, CForms): 22px ring of 1.5px control; checked = primary ring with a 10px primary dot. */
const RadioGroupItem = forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "console-control console-touch console-radio aspect-square shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-40",
      className
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span className="console-radio-dot block rounded-full" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
))
RadioGroupItem.displayName = "RadioGroupItem"

export { RadioGroup, RadioGroupItem }
