import type * as React from 'react'
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '../../cn.js'
import { useConsoleUiI18n } from '../../i18n/index.js'
import { CONSOLE_ICON_STROKE_WIDTH } from '../icon.js'
import { Button } from './button.js'
import type { ControlVariant } from './control-variant.js'
import { Input } from './input.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import {
  addDays, addMonths, calendarMonth, clampDate, clampTimePart, formatDateTimeValue, formatDateValue, fromDate,
  isWithin, parseDateTimeValue, parseDateValue, sameDate, startOfWeek, type CalendarDate,
} from './date-field-model.js'

export interface DateFieldProps {
  /** ISO value in local time: `YYYY-MM-DD` (DateField) or `YYYY-MM-DDTHH:mm` (DateTimeField); `''` when empty. */
  value: string
  onValueChange: (value: string) => void
  /** Earliest / latest selectable day (ISO; only the date part is compared). */
  min?: string
  max?: string
  placeholder?: string
  disabled?: boolean
  /** Show the clear button and accept Delete / Backspace on the trigger. Default `true`. */
  clearable?: boolean
  /** `ghost`: no border until hovered, focused or open (ADR 0063 D29). */
  variant?: ControlVariant
  /** First day of the week: 1 Monday (default for zh-CN), 0 Sunday (default for en). */
  weekStartsOn?: 0 | 1
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

export type DateTimeFieldProps = DateFieldProps

type Mode = 'date' | 'datetime'

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * Date picker (ADR 0063 D29, zhinjs/console#125): replaces `<input type="date">`. A trigger that
 * looks like `SelectTrigger`, and a popover month calendar (grid pattern): ← → ↑ ↓ move by day /
 * week, Home / End to the week's start / end, PageUp / PageDown by month (with Shift by year),
 * Enter or Space picks, Esc closes. Delete / Backspace on the trigger clears the value.
 */
export const DateField = forwardRef<HTMLButtonElement, DateFieldProps>((props, ref) => (
  <CalendarField ref={ref} mode="date" {...props} />
))
DateField.displayName = 'DateField'

/** `DateField` plus hour and minute: replaces `<input type="datetime-local">` (value `YYYY-MM-DDTHH:mm`). */
export const DateTimeField = forwardRef<HTMLButtonElement, DateTimeFieldProps>((props, ref) => (
  <CalendarField ref={ref} mode="datetime" {...props} />
))
DateTimeField.displayName = 'DateTimeField'

const CalendarField = forwardRef<HTMLButtonElement, DateFieldProps & { mode: Mode }>(({
  mode, value, onValueChange, min, max, placeholder, disabled, clearable = true, variant, weekStartsOn,
  className, id, ...aria
}, ref) => {
  const i18n = useConsoleUiI18n()
  const locale = i18n.locale
  const weekStart: 0 | 1 = weekStartsOn ?? (locale === 'en' ? 0 : 1)
  const time = mode === 'datetime' ? parseDateTimeValue(value) : null
  const selected: CalendarDate | null = mode === 'datetime' ? time : parseDateValue(value)
  const selectedDate = selected ? { year: selected.year, month: selected.month, day: selected.day } : null
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState<CalendarDate>(() => clampDate(selectedDate ?? fromDate(new Date()), min, max))
  const [hourText, setHourText] = useState('')
  const [minuteText, setMinuteText] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const moveFocus = useRef(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    setFocus(clampDate(selectedDate ?? fromDate(new Date()), min, max))
    setHourText(pad(time?.hour ?? 0))
    setMinuteText(pad(time?.minute ?? 0))
  }, [open]) // only on open: the value is read, not tracked
  useEffect(() => {
    if (!open || !moveFocus.current) return
    moveFocus.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${formatDateValue(focus)}"]`)?.focus()
  }, [focus, open])

  const weeks = useMemo(() => calendarMonth(focus.year, focus.month, weekStart), [focus.year, focus.month, weekStart])
  const today = fromDate(new Date())
  const monthTitle = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(focus.year, focus.month - 1, 1))
  const dayLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full' })
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: locale === 'en' ? 'short' : 'narrow' })
  const weekdayFull = new Intl.DateTimeFormat(locale, { weekday: 'long' })

  const emit = (date: CalendarDate, hour = time?.hour ?? 0, minute = time?.minute ?? 0) => {
    onValueChange(mode === 'datetime' ? formatDateTimeValue({ ...date, hour, minute }) : formatDateValue(date))
  }
  const pick = (date: CalendarDate) => {
    if (!isWithin(date, min, max)) return
    if (mode === 'datetime') {
      emit(date, clampTimePart(hourText, 23) ?? 0, clampTimePart(minuteText, 59) ?? 0)
      setFocus(date)
    } else {
      emit(date)
      setOpen(false)
    }
  }
  const go = (next: CalendarDate) => {
    moveFocus.current = true
    setFocus(clampDate(next, min, max))
  }
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, () => CalendarDate> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => startOfWeek(focus, weekStart),
      End: () => addDays(startOfWeek(focus, weekStart), 6),
      PageUp: () => addMonths(focus, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, event.shiftKey ? 12 : 1),
    }
    const next = step[event.key]
    if (!next) return
    event.preventDefault()
    go(next())
  }
  const commitTime = (hourInput = hourText, minuteInput = minuteText) => {
    const hour = clampTimePart(hourInput, 23)
    const minute = clampTimePart(minuteInput, 59)
    setHourText(pad(hour ?? time?.hour ?? 0))
    setMinuteText(pad(minute ?? time?.minute ?? 0))
    if (hour === null || minute === null) return
    emit(selectedDate ?? focus, hour, minute)
  }
  const timeKeyDown = (part: 'hour' | 'minute') => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commitTime(); return }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const limit = part === 'hour' ? 24 : 60
    const current = clampTimePart(part === 'hour' ? hourText : minuteText, limit - 1) ?? 0
    const next = pad((current + (event.key === 'ArrowUp' ? 1 : -1) + limit) % limit)
    if (part === 'hour') { setHourText(next); commitTime(next, minuteText) } else { setMinuteText(next); commitTime(hourText, next) }
  }
  const setNow = () => {
    const now = new Date()
    const date = clampDate(fromDate(now), min, max)
    if (mode === 'datetime') {
      emit(date, now.getHours(), now.getMinutes())
      setHourText(pad(now.getHours()))
      setMinuteText(pad(now.getMinutes()))
      go(date)
    } else {
      emit(date)
      setOpen(false)
    }
  }
  const clear = () => {
    onValueChange('')
    setOpen(false)
  }

  const display = selectedDate
    ? mode === 'datetime' && time ? `${formatDateValue(selectedDate)} ${pad(time.hour)}:${pad(time.minute)}` : formatDateValue(selectedDate)
    : null
  const canClear = clearable && !disabled && Boolean(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('console-date-field', className)} data-variant={variant === 'ghost' ? 'ghost' : undefined}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            type="button"
            id={id}
            disabled={disabled}
            aria-haspopup="dialog"
            data-slot="input"
            className="console-control console-date-field-trigger"
            onKeyDown={event => {
              if (canClear && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); clear() }
              else if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true) }
            }}
            {...aria}
          >
            <Calendar aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} className="console-date-field-icon" />
            <span className={cn('console-date-field-value', !display && 'is-placeholder')}>
              {display ?? placeholder ?? i18n.t(mode === 'datetime' ? 'date.placeholderDateTime' : 'date.placeholder')}
            </span>
            {canClear ? <span aria-hidden="true" className="console-date-field-spacer" /> : null}
          </button>
        </PopoverTrigger>
        {canClear ? (
          <button type="button" className="console-date-field-clear console-touch" aria-label={i18n.t('date.clear')} onClick={clear}>
            <X aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} />
          </button>
        ) : null}
      </div>
      <PopoverContent
        className="console-date-popover"
        sideOffset={4}
        aria-labelledby={titleId}
        onOpenAutoFocus={event => { event.preventDefault(); moveFocus.current = true; setFocus(current => ({ ...current })) }}
      >
        <div className="console-date-header">
          <Button type="button" variant="ghost" size="icon" aria-label={i18n.t('date.prevMonth')} onClick={() => setFocus(clampDate(addMonths(focus, -1), min, max))}>
            <ChevronLeft aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} />
          </Button>
          <p id={titleId} className="console-date-title" aria-live="polite">{monthTitle}</p>
          <Button type="button" variant="ghost" size="icon" aria-label={i18n.t('date.nextMonth')} onClick={() => setFocus(clampDate(addMonths(focus, 1), min, max))}>
            <ChevronRight aria-hidden="true" strokeWidth={CONSOLE_ICON_STROKE_WIDTH} />
          </Button>
        </div>
        <div ref={gridRef} role="grid" aria-labelledby={titleId} className="console-date-grid" onKeyDown={onGridKeyDown}>
          <div role="row" className="console-date-row">
            {weeks[0].map(day => (
              <span key={formatDateValue(day)} role="columnheader" className="console-date-weekday" aria-label={weekdayFull.format(new Date(day.year, day.month - 1, day.day))}>
                {weekdayName.format(new Date(day.year, day.month - 1, day.day))}
              </span>
            ))}
          </div>
          {weeks.map(week => (
            <div role="row" key={formatDateValue(week[0])} className="console-date-row">
              {week.map(day => {
                const iso = formatDateValue(day)
                const inMonth = day.month === focus.month
                const enabled = isWithin(day, min, max)
                const isSelected = sameDate(day, selectedDate)
                return (
                  <span key={iso} role="gridcell" aria-selected={isSelected}>
                    <button
                      type="button"
                      data-date={iso}
                      tabIndex={sameDate(day, focus) ? 0 : -1}
                      disabled={!enabled}
                      aria-label={dayLabel.format(new Date(day.year, day.month - 1, day.day))}
                      aria-current={sameDate(day, today) ? 'date' : undefined}
                      className={cn('console-date-day', !inMonth && 'is-outside', isSelected && 'is-selected', sameDate(day, today) && 'is-today')}
                      onClick={() => pick(day)}
                    >
                      {day.day}
                    </button>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
        {mode === 'datetime' ? (
          <div className="console-date-time">
            <span className="console-date-time-label">{i18n.t('date.time')}</span>
            <Input
              inputMode="numeric"
              maxLength={2}
              aria-label={i18n.t('date.hour')}
              value={hourText}
              onChange={event => setHourText(event.target.value)}
              onBlur={() => commitTime()}
              onKeyDown={timeKeyDown('hour')}
              className="console-date-time-input"
            />
            <span aria-hidden="true">:</span>
            <Input
              inputMode="numeric"
              maxLength={2}
              aria-label={i18n.t('date.minute')}
              value={minuteText}
              onChange={event => setMinuteText(event.target.value)}
              onBlur={() => commitTime()}
              onKeyDown={timeKeyDown('minute')}
              className="console-date-time-input"
            />
          </div>
        ) : null}
        <div className="console-date-footer">
          <Button type="button" variant="ghost" size="sm" onClick={setNow}>{i18n.t(mode === 'datetime' ? 'date.now' : 'date.today')}</Button>
          <span className="console-date-footer-end">
            {canClear ? <Button type="button" variant="ghost" size="sm" onClick={clear}>{i18n.t('date.clear')}</Button> : null}
            {mode === 'datetime' ? <Button type="button" variant="soft" size="sm" onClick={() => { commitTime(); setOpen(false) }}>{i18n.t('date.done')}</Button> : null}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
})
CalendarField.displayName = 'CalendarField'
