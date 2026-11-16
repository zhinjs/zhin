import type * as React from 'react'
import { forwardRef } from 'react'
import { Popover as Primitive } from 'radix-ui'
import { cn } from '../../cn.js'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverAnchor = Primitive.Anchor
export const PopoverContent = forwardRef<React.ComponentRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, align = 'start', sideOffset = 8, ...props }, ref) => <Primitive.Portal>
    <Primitive.Content ref={ref} data-slot="popover" align={align} sideOffset={sideOffset} collisionPadding={12}
      className={cn(
        'console-popover console-popover--panel',
        className,
      )} {...props} />
  </Primitive.Portal>,
)
PopoverContent.displayName = 'PopoverContent'
