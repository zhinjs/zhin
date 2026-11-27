import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const TabsPrimitive = Radix.Tabs
import { cn } from '../../cn.js'

const Tabs = TabsPrimitive.Root

/**
 * Tabs (soft cards, ADR 0063 D39): the segmented control `sc-seg` — a sunken pill with pill
 * segments, the selected one primary (black / white). Radix supplies `role="tablist"` / `tab` and
 * `aria-selected`.
 */
const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "console-segmented inline-flex max-w-full items-center justify-start gap-1 overflow-x-auto p-1 text-tab-inactive",
      className
    )}
    {...props}
  />
))
TabsList.displayName = "TabsList"

const TabsTrigger = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    value={value}
    className={cn(
      "console-tabs-trigger console-touch console-segment inline-flex flex-1 items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-40 hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, value, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    value={value}
    className={cn(
      "mt-3",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
