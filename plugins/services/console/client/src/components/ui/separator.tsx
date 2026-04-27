import type * as React from "react"
import { forwardRef } from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"
import { cn } from "@zhin.js/client"

const Separator = forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation: orientationProp, decorative = true, ...props }, ref) => {
  const orientation = (orientationProp ?? "horizontal") as "vertical" | "horizontal"
  return (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
      className
    )}
    {...props}
  />
  )
})
Separator.displayName = "Separator"

export { Separator }
