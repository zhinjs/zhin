import { useEffect, useState, type RefObject } from 'react'

/** Root font size in px (rem breakpoints are compared against element widths in px). */
function remInPx(): number {
  if (typeof document === 'undefined') return 16
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : 16
}

/**
 * Whether the element is at least `rem` wide (ADR 0063 D18: components follow the width of their
 * own container, not the viewport). `undefined` until measured (and during server rendering).
 */
export function useContainerAtLeast(ref: RefObject<HTMLElement | null>, rem: number): boolean | undefined {
  const [wide, setWide] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWide(element.getBoundingClientRect().width >= rem * remInPx())
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rem])
  return wide
}

/** Breakpoints of the size scale in rem (tokens/tokens.mjs `breakpoints`). */
export const CONSOLE_BREAKPOINTS_REM = Object.freeze({ sm: 40, md: 48, lg: 64, xl: 90 } as const)
