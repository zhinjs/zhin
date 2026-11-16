import { useConsoleUiI18n } from '../i18n/index.js'
import { useState, useCallback, useEffect, useId, type ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '../cn.js'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from './ui/dialog.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { canSubmitConfirm, confirmErrorMessage } from './confirm-dialog-model.js'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  /**
   * Irreversible actions: the user must type this exact text (e.g. a table name)
   * before the confirm button is enabled.
   */
  confirmText?: string
  /**
   * May throw or reject: the dialog then stays open, shows the error (role="alert")
   * and lets the user retry or cancel. Resolve to close the dialog.
   */
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open, onOpenChange, title, description, children,
  confirmLabel, cancelLabel,
  variant = 'default', confirmText, onConfirm,
}: ConfirmDialogProps) {
  const i18n = useConsoleUiI18n()
  const inputId = useId()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const canSubmit = canSubmitConfirm({ loading, typed, confirmText })

  // A closed dialog must not carry a stale error or typed name into its next opening.
  useEffect(() => {
    if (!open) { setError(null); setTyped('') }
  }, [open])

  const handleConfirm = useCallback(async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (caught) {
      setError(confirmErrorMessage(caught) ?? i18n.t("confirm.failed"))
    } finally {
      setLoading(false)
    }
  }, [canSubmit, onConfirm, onOpenChange, i18n])

  const Icon = variant === 'destructive' ? AlertTriangle : Info

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className={cn('console-confirm-icon', variant === 'destructive' && 'is-destructive')} aria-hidden="true">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>
        {children}
        {confirmText != null && confirmText !== '' && (
          <div className="space-y-2">
            <label htmlFor={inputId} className="block text-body text-muted-foreground">
              {i18n.t("confirm.typeToConfirm", [confirmText])}
            </label>
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
              onChange={event => setTyped(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); void handleConfirm() }
              }}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-body text-destructive break-words">
            {i18n.t("confirm.notCompleted", [error])}
          </p>
        )}
        <DialogFooter className="border-t border-border/70 pt-3">
          <DialogClose asChild>
            <Button variant="outline" size="sm">{cancelLabel ?? i18n.t("confirm.cancel")}</Button>
          </DialogClose>
          <Button
            variant={variant === 'destructive' ? 'destructive-solid' : 'primary'}
            size="sm"
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {loading ? i18n.t("confirm.processing") : (confirmLabel ?? i18n.t("confirm.confirm"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Hook for imperative confirm dialogs.
 * Usage:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: '确定删除？', variant: 'destructive' })) { ... }
 */
export function useConfirm() {
  const [state, setState] = useState<{
    resolve: (v: boolean) => void
    opts: Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm'>
  } | null>(null)

  const confirm = useCallback((opts: Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm'>) => {
    return new Promise<boolean>(resolve => {
      setState({ resolve, opts })
    })
  }, [])

  const ConfirmDialogElement = state ? (
    <ConfirmDialog
      open
      onOpenChange={open => {
        if (!open) {
          state.resolve(false)
          setState(null)
        }
      }}
      onConfirm={() => {
        state.resolve(true)
        setState(null)
      }}
      {...state.opts}
    />
  ) : null

  return { confirm, ConfirmDialog: ConfirmDialogElement }
}
