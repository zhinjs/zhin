import type { ReactNode } from 'react'

/**
 * Pure part of SearchableSelectField: which options a query keeps and how they are grouped.
 * Groups appear in the order their first option appears; ungrouped options (such as 「未设置」)
 * come first and are never filtered out, so clearing a choice stays one click away.
 */

export interface SearchableSelectOption {
  value: string
  label: ReactNode
  /** Heading the option is listed under; omitted for top-level choices such as 「未设置」. */
  group?: string
  /** Secondary line under the label (e.g. `model · account`). */
  description?: string
  /** Extra text the search box matches (the label is used when it is a string). */
  keywords?: string
  disabled?: boolean
}

export interface SearchableSelectGroup<T extends SearchableSelectOption = SearchableSelectOption> {
  group: string | null
  options: T[]
}

const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLocaleLowerCase()

/** Text a query is matched against: explicit keywords, else a string label, plus value, description and group. */
export function optionSearchText(option: SearchableSelectOption): string {
  const label = typeof option.label === 'string' ? option.label : ''
  return normalize([option.keywords ?? '', label, option.value, option.description ?? '', option.group ?? ''].join(' '))
}

/** Every whitespace-separated term must appear somewhere in the option's search text. */
export function optionMatches(option: SearchableSelectOption, query: string): boolean {
  const terms = normalize(query).split(/\s+/u).filter(Boolean)
  if (!terms.length) return true
  const text = optionSearchText(option)
  return terms.every(term => text.includes(term))
}

/** `[{ group: string | null, options }]` for the options matching `query`; empty groups are dropped. */
export function groupSelectOptions<T extends SearchableSelectOption>(options: readonly T[], query = ''): SearchableSelectGroup<T>[] {
  const groups = new Map<string, T[]>()
  const loose: T[] = []
  for (const option of options) {
    if (!option.group) {
      if (!query || option.value === '' || optionMatches(option, query)) loose.push(option)
      continue
    }
    if (!groups.has(option.group)) groups.set(option.group, [])
    if (optionMatches(option, query)) groups.get(option.group)!.push(option)
  }
  return [
    ...(loose.length ? [{ group: null, options: loose }] : []),
    ...[...groups].filter(([, items]) => items.length).map(([group, items]) => ({ group, options: items })),
  ]
}

/** Values in display order, for arrow-key movement (disabled options are skipped). */
export function navigableValues(grouped: readonly SearchableSelectGroup[]): string[] {
  return grouped.flatMap(entry => entry.options.filter(option => !option.disabled).map(option => option.value))
}
