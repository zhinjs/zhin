import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '../cn.js'
import { useConsoleUiI18n } from '../i18n/index.js'
import { Button } from './ui/button.js'
import { SelectField } from './ui/select.js'
import {
  DEFAULT_REFRESH_INTERVALS,
  formatRefreshTime,
  intervalSeconds,
  refreshIntervalOptions,
} from './refresh-control-model.js'

export interface RefreshControlProps {
  /** Runs on the refresh button and on every auto-refresh tick; a returned promise keeps the control busy until it settles. */
  onRefresh: () => void | Promise<unknown>
  /** Time of the last successful load, shown as 「更新于 hh:mm:ss」. */
  updatedAt?: Date | number | string | null
  /** Auto-refresh interval in ms (0 = manual). Controlled when set. */
  intervalMs?: number
  /** Initial interval when uncontrolled; defaults to 0 (manual). */
  defaultIntervalMs?: number
  onIntervalChange?: (intervalMs: number) => void
  /** Offered intervals in ms; defaults to manual / 5s / 15s / 30s. */
  intervals?: readonly number[]
  /** Busy state owned by the caller (e.g. a data hook); merged with the control's own in-flight state. */
  refreshing?: boolean
  disabled?: boolean
  className?: string
}

/**
 * The one refresh control for Console and plugin pages (ADR 0063 D5): 「更新于 hh:mm:ss」, an
 * auto-refresh interval (Radix select: manual / 5s / 15s / 30s) and a refresh button.
 * Auto-refresh skips ticks while the tab is hidden or a refresh is still running.
 */
export function RefreshControl({
  onRefresh, updatedAt, intervalMs, defaultIntervalMs = 0, onIntervalChange,
  intervals = DEFAULT_REFRESH_INTERVALS, refreshing, disabled, className,
}: RefreshControlProps) {
  const i18n = useConsoleUiI18n()
  const [ownInterval, setOwnInterval] = useState(defaultIntervalMs)
  const [inFlight, setInFlight] = useState(false)
  const inFlightRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const interval = intervalMs ?? ownInterval
  const busy = Boolean(refreshing) || inFlight

  const run = useCallback(() => {
    if (inFlightRef.current) return
    let result: void | Promise<unknown>
    try {
      result = onRefreshRef.current()
    } catch {
      return
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      inFlightRef.current = true
      setInFlight(true)
      void (result as Promise<unknown>).catch(() => undefined).finally(() => {
        inFlightRef.current = false
        setInFlight(false)
      })
    }
  }, [])

  useEffect(() => {
    if (!(interval > 0) || disabled) return
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (refreshing) return
      run()
    }, interval)
    return () => clearInterval(timer)
  }, [interval, disabled, refreshing, run])

  const options = refreshIntervalOptions(interval, intervals).map(value => ({
    value: String(value),
    label: value === 0 ? i18n.t('refresh.manual') : i18n.t('refresh.auto', [intervalSeconds(value)]),
  }))
  const time = formatRefreshTime(updatedAt)

  return (
    <div className={cn('console-refresh-control flex flex-wrap items-center gap-2', className)}>
      <span className="console-refresh-control-time text-label text-muted-foreground tabular-nums" aria-live="polite">
        {time ? i18n.t('refresh.updatedAt', [time]) : i18n.t('refresh.notYet')}
      </span>
      <SelectField
        aria-label={i18n.t('refresh.interval')}
        className="h-control-compact w-auto min-w-32 text-label"
        options={options}
        value={String(interval)}
        disabled={disabled}
        onValueChange={next => {
          const value = Number(next)
          if (intervalMs === undefined) setOwnInterval(value)
          onIntervalChange?.(value)
        }}
      />
      <Button variant="outline" size="sm" onClick={run} disabled={disabled || busy} aria-busy={busy || undefined}>
        <RefreshCw aria-hidden="true" className={cn(busy && 'animate-spin')} />
        {busy ? i18n.t('refresh.refreshing') : i18n.t('refresh.refresh')}
      </Button>
    </div>
  )
}
