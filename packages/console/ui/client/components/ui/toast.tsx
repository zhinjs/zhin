import type * as React from "react"
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { cn } from '../../cn.js'
import { useConsoleUiI18n } from '../../i18n/index.js'

/** How long a toast stays (soft cards D39): 2.5 s. */
export const TOAST_DURATION_MS = 2500

/** A toast with 「撤销」 stays at least this long (5 s), so there is time to reach the button. */
export const TOAST_UNDO_DURATION_MS = 5000

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

/** Inside a {@link Toaster}: the toaster is the one live region, so its toasts carry no role. */
const InToasterContext = createContext(false)

/**
 * Toast (`sc-toast`): an inverse pill with one sentence and an optional 「撤销」. On its own it is a
 * polite live region (`role="status"`); inside a {@link Toaster} the toaster announces it instead.
 */
const Toast = forwardRef<HTMLDivElement, ToastProps>(({ children, icon, onUndo, undoLabel, className, ...props }, ref) => {
  const i18n = useConsoleUiI18n()
  const inToaster = useContext(InToasterContext)
  return (
    <div
      ref={ref}
      role={inToaster ? undefined : "status"}
      aria-live={inToaster ? undefined : "polite"}
      data-slot="toast"
      className={cn("console-toast", className)}
      {...props}
    >
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
  /**
   * Default {@link TOAST_DURATION_MS}; with `onUndo` at least {@link TOAST_UNDO_DURATION_MS}
   * (a shorter value is raised to it).
   */
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

/** How long a toast with these options stays. */
export function toastDuration(options: ToastOptions = {}): number {
  const duration = options.duration ?? TOAST_DURATION_MS
  return options.onUndo ? Math.max(duration, TOAST_UNDO_DURATION_MS) : duration
}

/**
 * The toast queue without React (for tests and hosts with their own renderer): `show()` adds an
 * entry that `dismiss()` (or the timer, after {@link toastDuration}) removes; listeners get the
 * list. `pause()` stops every timer (the pointer is over the toasts, or focus is in them) and
 * `resume()` continues each from the time it had left; a toast shown while paused waits too.
 */
export function createToastStore(
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => number = () => Date.now(),
) {
  let entries: readonly ToastEntry[] = []
  let next = 1
  let paused = false
  /** Per toast: the running timer (if any), the time left and when the timer started. */
  const clocks = new Map<number, { timer?: unknown; left: number; since: number }>()
  const listeners = new Set<(entries: readonly ToastEntry[]) => void>()
  const emit = () => { for (const listener of listeners) listener(entries) }
  const start = (id: number) => {
    const clock = clocks.get(id)
    if (!clock || clock.timer !== undefined) return
    clock.since = now()
    clock.timer = schedule(() => dismiss(id), clock.left)
  }
  const stop = (id: number) => {
    const clock = clocks.get(id)
    if (!clock || clock.timer === undefined) return
    cancel(clock.timer)
    clock.timer = undefined
    clock.left = Math.max(0, clock.left - (now() - clock.since))
  }
  const dismiss = (id: number) => {
    stop(id)
    clocks.delete(id)
    if (!entries.some((entry) => entry.id === id)) return
    entries = entries.filter((entry) => entry.id !== id)
    emit()
  }
  const show = (message: React.ReactNode, options: ToastOptions = {}) => {
    const id = next++
    entries = [...entries, { id, message, ...options }]
    clocks.set(id, { left: toastDuration(options), since: now() })
    if (!paused) start(id)
    emit()
    return id
  }
  return {
    show,
    dismiss,
    pause() {
      paused = true
      for (const id of clocks.keys()) stop(id)
    },
    resume() {
      if (!paused) return
      paused = false
      for (const id of clocks.keys()) start(id)
    },
    isPaused: () => paused,
    get: () => entries,
    subscribe(listener: (entries: readonly ToastEntry[]) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const ToastContext = createContext<ToastApi | null>(null)

declare const process: { env?: { NODE_ENV?: string } } | undefined

let warnedOutsideToaster = false
function isProduction(): boolean {
  // Bundlers replace `process.env.NODE_ENV`; browsers without a bundler have no `process`.
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production"
}

const NOOP: ToastApi = {
  toast: () => {
    if (!warnedOutsideToaster && !isProduction()) {
      warnedOutsideToaster = true
      console.warn("[@zhin.js/console-ui] useToast().toast() was called outside a <Toaster>: nothing is shown. Wrap the app (or the page) in <Toaster> once.")
    }
    return -1
  },
  dismiss: () => undefined,
}

/**
 * Shows toasts from anywhere below a {@link Toaster}. Outside one, calls show nothing and return -1;
 * in development the first such call logs a warning.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}

export interface ToasterProps {
  children?: React.ReactNode
  className?: string
}

/**
 * Hosts the toasts: wrap the app (or a page) once, then `useToast().toast('已保存', { onUndo })`.
 * Toasts stack at the bottom centre and disappear after 2.5 s (5 s with 「撤销」); the time stops
 * while the pointer is over them or focus is in them. The toaster is the one polite live region.
 * They fade in (reduced motion: fade only).
 */
export function Toaster({ children, className }: ToasterProps) {
  const storeRef = useRef<ReturnType<typeof createToastStore> | null>(null)
  if (!storeRef.current) storeRef.current = createToastStore()
  const store = storeRef.current
  const [entries, setEntries] = useState<readonly ToastEntry[]>(() => store.get())
  useEffect(() => store.subscribe(setEntries), [store])
  const api = useMemo<ToastApi>(() => ({ toast: store.show, dismiss: store.dismiss }), [store])
  const hold = useRef({ pointer: false, focus: false })
  const sync = useCallback(() => {
    if (hold.current.pointer || hold.current.focus) store.pause()
    else store.resume()
  }, [store])
  const undo = useCallback((entry: ToastEntry) => {
    entry.onUndo?.()
    store.dismiss(entry.id)
  }, [store])
  // The last toast closed while the pointer or focus was in it: nothing holds the timers any more.
  useEffect(() => {
    if (entries.length === 0 && (hold.current.pointer || hold.current.focus)) {
      hold.current = { pointer: false, focus: false }
      sync()
    }
  }, [entries.length, sync])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className={cn("console-toaster", className)}
        data-slot="toaster"
        aria-live="polite"
        aria-relevant="additions"
        onPointerEnter={() => { hold.current.pointer = true; sync() }}
        onPointerLeave={() => { hold.current.pointer = false; sync() }}
        onFocus={() => { hold.current.focus = true; sync() }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          hold.current.focus = false
          sync()
        }}
      >
        <InToasterContext.Provider value>
          {entries.map((entry) => (
            <Toast key={entry.id} icon={entry.icon} onUndo={entry.onUndo ? () => undo(entry) : undefined}>{entry.message}</Toast>
          ))}
        </InToasterContext.Provider>
      </div>
    </ToastContext.Provider>
  )
}

export { Toast }
