import { ConsoleUiText } from '../../i18n/index.js'
import type * as React from "react"
import { forwardRef } from "react"
import * as Radix from "radix-ui"

const DialogPrimitive = Radix.Dialog
import { cn } from '../../cn.js'
import { X } from "lucide-react"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "console-dialog-overlay",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = "DialogOverlay"

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  variant?: "modal" | "drawer"
  side?: "right" | "left" | "bottom"
}

const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, variant = "modal", side = "right", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-side={variant === "drawer" ? side : undefined}
      data-slot={variant === "drawer" ? "sheet" : "dialog"}
      className={cn(
        variant === "drawer"
          ? "console-sheet-content outline-none"
          : "console-dialog",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="console-dialog-close disabled:pointer-events-none">
        <X className="size-4" />
        <span className="sr-only"><ConsoleUiText id="dialog.close" /></span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = "DialogContent"

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("console-dialog-header", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("console-dialog-footer", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("console-section-title", className)}
    {...props}
  />
))
DialogTitle.displayName = "DialogTitle"

const DialogDescription = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = "DialogDescription"

export {
  Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
}
