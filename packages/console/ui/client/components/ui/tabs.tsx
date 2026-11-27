import type * as React from "react"
import { createContext, forwardRef, useContext } from "react"
import * as Radix from "radix-ui"

const TabsPrimitive = Radix.Tabs
import { cn } from '../../cn.js'

/** Whether the triggers share the width of the list equally (`<Tabs fill>`). */
const TabsFillContext = createContext(false)

export interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  /**
   * The tab list takes the full width and its triggers share it equally (a phone-width switch).
   * Off (default): the list is as wide as its triggers, each as wide as its label — the Console's
   * usual density.
   */
  fill?: boolean
}

/** Tabs root (Radix `Tabs.Root`) with the optional `fill` layout. */
const Tabs = forwardRef<React.ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(({ fill = false, ...props }, ref) => (
  <TabsFillContext.Provider value={fill}>
    <TabsPrimitive.Root ref={ref} data-fill={fill ? "" : undefined} {...props} />
  </TabsFillContext.Provider>
))
Tabs.displayName = "Tabs"

/**
 * Tabs (soft cards, ADR 0063 D39): the segmented control `sc-seg` — a sunken pill with pill
 * segments, the selected one primary (black / white). Radix supplies `role="tablist"` / `tab` and
 * `aria-selected`.
 */
const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const fill = useContext(TabsFillContext)
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "console-segmented inline-flex max-w-full items-center justify-start gap-1 overflow-x-auto p-1 text-tab-inactive",
        fill && "flex w-full",
        className
      )}
      {...props}
    />
  )
})
TabsList.displayName = "TabsList"

const TabsTrigger = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, ...props }, ref) => {
  const fill = useContext(TabsFillContext)
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        "console-tabs-trigger console-touch console-segment inline-flex items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-40 hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
        fill && "flex-1",
        className
      )}
      {...props}
    />
  )
})
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
