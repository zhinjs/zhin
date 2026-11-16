import type * as React from 'react'
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { CONSOLE_ICON_STROKE_WIDTH } from '../icon.js'
import { cn } from '../../cn.js'
import { useConsoleUiI18n } from '../../i18n/index.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import type { ControlVariant } from './control-variant.js'
import { groupSelectOptions, navigableValues, type SearchableSelectOption } from './searchable-select-model.js'

export type { SearchableSelectOption }

export interface SearchableSelectFieldProps {
  options: readonly SearchableSelectOption[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  /** Placeholder of the search box. */
  searchPlaceholder?: string
  /** Shown when nothing matches the search. */
  emptyText?: string
  /** `ghost`: no border until hovered, focused or open, for secondary fields (ADR 0063 D29). */
  variant?: ControlVariant
}

/**
 * A select for long lists: a popover with a search box and grouped options (combobox / listbox
 * pattern). Same controlled contract as SelectField (`options` / `value` / `onValueChange`), plus
 * `group`, `description` and `keywords` per option. ↑ / ↓ move, Enter picks, Esc closes.
 */
export const SearchableSelectField = forwardRef<HTMLButtonElement, SearchableSelectFieldProps>(({
  options, value, onValueChange, disabled, className, id, searchPlaceholder, emptyText, variant, ...aria
}, ref) => {
  const i18n = useConsoleUiI18n()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.value === value)
  const grouped = useMemo(() => groupSelectOptions(options, query), [options, query])
  const order = useMemo(() => navigableValues(grouped), [grouped])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    setActive(order.includes(value) ? value : order[0] ?? null)
  }, [open]) // only on open / close: active and order are read, not tracked
  useEffect(() => {
    if (open && (active === null || !order.includes(active))) setActive(order[0] ?? null)
  }, [order]) // only when the visible options change
  useEffect(() => {
    if (!open || active === null) return
    // The list mounts with the popover: wait a frame so the chosen option can be scrolled into view.
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [active, open])

  const pick = (next: string) => {
    onValueChange(next)
    setOpen(false)
  }
  const move = (step: number) => {
    if (!order.length) return
    const index = active === null ? -1 : order.indexOf(active)
    setActive(order[(index + step + order.length) % order.length])
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(order[0] ?? null) }
    else if (event.key === 'End') { event.preventDefault(); setActive(order[order.length - 1] ?? null) }
    else if (event.key === 'Enter') { event.preventDefault(); if (active !== null) pick(active) }
  }
  const optionId = (optionValue: string) => `${listId}-${order.indexOf(optionValue)}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          id={id}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          data-slot="input"
          data-variant={variant === 'ghost' ? 'ghost' : undefined}
          className={cn('console-control console-searchable-select-trigger', className)}
          {...aria}
        >
          <span className="console-searchable-select-value">{selected ? selected.label : value}</span>
          <ChevronDown strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" className="console-searchable-select-chevron" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="console-searchable-select-popover" sideOffset={4} onOpenAutoFocus={event => event.preventDefault()}>
        <div className="console-searchable-select-search">
          <Search strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder ?? i18n.t('select.searchPlaceholder')}
            aria-label={searchPlaceholder ?? i18n.t('select.searchPlaceholder')}
            aria-controls={listId}
            aria-activedescendant={active !== null && order.includes(active) ? optionId(active) : undefined}
            aria-autocomplete="list"
            role="combobox"
            aria-expanded="true"
          />
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label={aria['aria-label']} className="console-searchable-select-list">
          {grouped.length ? grouped.map(entry => {
            const items = entry.options.map(option => (
              <div
                key={option.value}
                id={option.disabled ? undefined : optionId(option.value)}
                role="option"
                data-value={option.value}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={cn('console-searchable-select-option', option.value === active && 'is-active', option.value === value && 'is-selected')}
                onMouseMove={() => { if (!option.disabled && active !== option.value) setActive(option.value) }}
                onMouseDown={event => event.preventDefault()}
                onClick={() => { if (!option.disabled) pick(option.value) }}
                title={typeof option.label === 'string' ? option.label : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="console-searchable-select-label">{option.label}</span>
                  {option.description ? <span className="console-searchable-select-description">{option.description}</span> : null}
                </span>
                {option.value === value ? <Check strokeWidth={CONSOLE_ICON_STROKE_WIDTH} aria-hidden="true" className="console-searchable-select-check" /> : null}
              </div>
            ))
            return entry.group === null ? <div key="__top" role="group">{items}</div> : (
              <div key={entry.group} role="group" aria-label={entry.group} className="console-searchable-select-group">
                <div className="console-searchable-select-group-label" aria-hidden="true">{entry.group}<span>{entry.options.length}</span></div>
                {items}
              </div>
            )
          }) : <p className="console-searchable-select-empty">{emptyText ?? i18n.t('select.noMatch')}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
})
SearchableSelectField.displayName = 'SearchableSelectField'
