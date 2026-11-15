import type * as React from "react"
import { forwardRef } from "react"
import { cn } from '../../cn.js'

/**
 * Internal building block for list rows, side-nav items and selectable cards that are
 * buttons but not "actions" (use `Button` for those). It supplies the shared behaviours
 * every such row needs - `type="button"`, a visible focus ring and a 44px tap target
 * below 768px - while the caller's own class owns the visual layout.
 */
export type ListItemButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

const ListItemButton = forwardRef<HTMLButtonElement, ListItemButtonProps>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "cursor-pointer text-left max-md:min-h-11 disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline focus-visible:outline-[length:var(--console-focus-width)] focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  ),
)
ListItemButton.displayName = "ListItemButton"

export { ListItemButton }
