import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const TabsPrimitive = Radix.Tabs
import { cn } from '../../cn.js'

const Tabs = TabsPrimitive.Root

const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex max-w-full items-center justify-start gap-1 overflow-x-auto rounded-control bg-foreground/6 p-1 text-tab-inactive",
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
      "console-tabs-trigger inline-flex min-h-control-compact items-center justify-center whitespace-nowrap rounded-segment px-3 text-body font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground",
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
