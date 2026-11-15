import type * as React from 'react'
import { forwardRef } from 'react'
import { Popover as Primitive } from 'radix-ui'
import { cn } from '../../cn.js'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverAnchor = Primitive.Anchor
export const PopoverContent = forwardRef<React.ComponentRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, align = 'start', sideOffset = 8, ...props }, ref) => <Primitive.Portal>
    <Primitive.Content ref={ref} align={align} sideOffset={sideOffset} collisionPadding={12}
      className={cn(
        'z-50 rounded-[var(--console-radius-lg)] border-[length:var(--console-border-width)] border-[color:var(--console-border-default)] bg-popover p-4 text-popover-foreground shadow-[var(--console-shadow-lg)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1.5 data-[side=top]:slide-in-from-bottom-1.5',
        className,
      )} {...props} />
  </Primitive.Portal>,
)
PopoverContent.displayName = 'PopoverContent'
