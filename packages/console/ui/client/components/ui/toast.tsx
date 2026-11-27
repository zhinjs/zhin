import type * as React from "react"
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { cn } from '../../cn.js'
import { useConsoleUiI18n } from '../../i18n/index.js'

/** How long a toast stays (soft cards D39): 2.5 s. */
export const TOAST_DURATION_MS = 2500

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** One sentence, ≤ 8 characters (「已保存」, 「已停用 rss」). */
  children: React.ReactNode
  /** Leading icon (e.g. a check). */
  icon?: React.ReactNode
  /** Shows 「撤销」; called when it is pressed. */
  onUndo?: () => void
  /** Label of the undo button (default 「撤销」 / 「Undo」). */
  undoLabel?: string
}

/** Toast (`sc-toast`): an inverse pill with one sentence and an optional 「撤销」 (`role="status"`). */
const Toast = forwardRef<HTMLDivElement, ToastProps>(({ children, icon, onUndo, undoLabel, className, ...props }, ref) => {
  const i18n = useConsoleUiI18n()
  return (
    <div ref={ref} role="status" aria-live="polite" data-slot="toast" className={cn("console-toast", className)} {...props}>
      {icon}
      <span>{children}</span>
      {onUndo ? <button type="button" className="console-control console-touch console-toast-action" onClick={onUndo}>{undoLabel ?? i18n.t('toast.undo')}</button> : null}
    </div>
  )
})
Toast.displayName = "Toast"

export interface ToastOptions {
  /** Shows 「撤销」 and calls this when it is pressed (the toast closes). */
  readonly onUndo?: () => void
  readonly icon?: React.ReactNode
  /** Default {@link TOAST_DURATION_MS}. */
  readonly duration?: number
}

export interface ToastEntry extends ToastOptions {
  readonly id: number
  readonly message: React.ReactNode
}

export interface ToastApi {
  /** Shows a toast; returns its id. */
  toast: (message: React.ReactNode, options?: ToastOptions) => number
  dismiss: (id: number) => void
}

/**
 * The toast queue without React (for tests and hosts with their own renderer): `show()` adds an
 * entry that `dismiss()` (or the timer, after `duration`) removes; listeners get the list.
 */
export function createToastStore(schedule: (run: () => void, ms: number) => unknown = setTimeout, cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)) {
  let entries: readonly ToastEntry[] = []
  let next = 1
  const timers = new Map<number, unknown>()
  const listeners = new Set<(entries: readonly ToastEntry[]) => void>()
  const emit = () => { for (const listener of listeners) listener(entries) }
  const dismiss = (id: number) => {
    const timer = timers.get(id)
    if (timer !== undefined) cancel(timer)
    timers.delete(id)
    if (!entries.some((entry) => entry.id === id)) return
    entries = entries.filter((entry) => entry.id !== id)
    emit()
  }
  const show = (message: React.ReactNode, options: ToastOptions = {}) => {
    const id = next++
    entries = [...entries, { id, message, ...options }]
    timers.set(id, schedule(() => dismiss(id), options.duration ?? TOAST_DURATION_MS))
    emit()
    return id
  }
  return {
    show,
    dismiss,
    get: () => entries,
    subscribe(listener: (entries: readonly ToastEntry[]) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const ToastContext = createContext<ToastApi | null>(null)

/** Shows toasts from anywhere below a {@link Toaster}. Outside one, calls are ignored (returns -1). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}

const NOOP: ToastApi = { toast: () => -1, dismiss: () => undefined }

export interface ToasterProps {
  children?: React.ReactNode
  className?: string
}

/**
 * Hosts the toasts: wrap the app (or a page) once, then `useToast().toast('已保存', { onUndo })`.
 * Toasts stack at the bottom centre, disappear after 2.5 s and fade in (reduced motion: fade only).
 */
export function Toaster({ children, className }: ToasterProps) {
  const storeRef = useRef<ReturnType<typeof createToastStore> | null>(null)
  if (!storeRef.current) storeRef.current = createToastStore()
  const store = storeRef.current
  const [entries, setEntries] = useState<readonly ToastEntry[]>(() => store.get())
  useEffect(() => store.subscribe(setEntries), [store])
  const api = useMemo<ToastApi>(() => ({ toast: store.show, dismiss: store.dismiss }), [store])
  const undo = useCallback((entry: ToastEntry) => {
    entry.onUndo?.()
    store.dismiss(entry.id)
  }, [store])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={cn("console-toaster", className)} data-slot="toaster" aria-live="polite" aria-relevant="additions">
        {entries.map((entry) => (
          <Toast key={entry.id} icon={entry.icon} onUndo={entry.onUndo ? () => undo(entry) : undefined}>{entry.message}</Toast>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export { Toast }
