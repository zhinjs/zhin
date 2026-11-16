import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const SelectPrimitive = Radix.Select
import { cn } from '../../cn.js'
import { Check, ChevronDown, ChevronUp } from "lucide-react"

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="input"
    className={cn(
      "console-control flex h-control w-full items-center justify-between gap-2 whitespace-nowrap rounded-control border border-input bg-card hover:border-foreground/45 focus-visible:border-primary px-3 text-body placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = "SelectTrigger"

const SelectScrollUpButton = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="size-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = "SelectScrollUpButton"

const SelectScrollDownButton = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="size-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = "SelectScrollDownButton"

const SelectContent = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position: positionProp, ...props }, ref) => {
  const position = (positionProp ?? "popper") as "popper" | "item-aligned"
  return (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      data-slot="popover"
      className={cn(
        "console-popover relative flex max-h-[min(24rem,var(--radix-select-content-available-height,calc(100dvh-1rem)))] min-w-32 max-w-[calc(100vw-1rem)] flex-col p-0",
        position === "popper" &&
          "w-[var(--radix-select-trigger-width)]",
        className
      )}
      position={position}
      collisionPadding={8}
      sideOffset={4}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "min-h-0 w-full min-w-0 overflow-y-auto overscroll-contain p-1"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = "SelectContent"

const SelectItem = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    value={value}
    className={cn(
      "console-menu-item relative flex w-full min-w-0 cursor-default select-none items-center py-1 pl-3 pr-8 text-body leading-normal outline-none focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-primary/5 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex size-4 items-center justify-center text-primary">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = "SelectItem"

const SelectSeparator = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = "SelectSeparator"

export interface SelectFieldOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

export interface SelectFieldProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SelectTrigger>,
  "value" | "defaultValue" | "onChange" | "children" | "asChild" | "name"
> {
  options: readonly SelectFieldOption[]
  value: string
  onValueChange: (value: string) => void
}

// Controlled UI only: Radix values are encoded, so native named-form submission is not exposed.
const SelectField = forwardRef<React.ComponentRef<typeof SelectTrigger>, SelectFieldProps>(
  ({ options, value, onValueChange, disabled, ...triggerProps }, ref) => {
    const selected = options.find(option => option.value === value)
    return (
      <Select
        value={JSON.stringify(value)}
        onValueChange={encoded => {
          // Radix's hidden form control emits an empty sentinel for unmatched values.
          const option = options.find(item => JSON.stringify(item.value) === encoded)
          if (option) onValueChange(option.value)
        }}
        disabled={disabled}
      >
        <SelectTrigger ref={ref} disabled={disabled} {...triggerProps}>
          <SelectValue>{selected ? selected.label : value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem
              key={option.value}
              value={JSON.stringify(option.value)}
              disabled={option.disabled}
              title={typeof option.label === "string" ? option.label : undefined}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
)
SelectField.displayName = "SelectField"

export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton,
  SelectField,
}
