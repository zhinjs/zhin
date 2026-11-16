import type { ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * Line-art illustrations of `EmptyState` (ADR 0063 D28, zhinjs/console#125): drawn on a 64 × 64
 * grid, one 1.5px stroke (kept at 1.5px at every size), no fill, a single color — `brand-text`
 * from the `.console-empty-art` class, i.e. `currentColor`.
 */
export const EMPTY_ILLUSTRATIONS = Object.freeze([
  'messages',
  'tasks',
  'logs',
  'table',
  'record',
  'not-found',
  'generic',
] as const)

export type EmptyIllustrationName = (typeof EMPTY_ILLUSTRATIONS)[number]

const ART: Readonly<Record<EmptyIllustrationName, ReactNode>> = {
  // 无消息: a speech bubble in front of a second one.
  messages: (
    <>
      <path d="M48 24h4a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-3v5l-6-5h-9" />
      <path d="M12 16h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H24l-7 6v-6h-5a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z" />
      <path d="M16 24h20" />
      <path d="M16 30h12" />
      <path d="M54 8v6M51 11h6" />
    </>
  ),
  // 无任务: a clipboard with two ticked items and an open one.
  tasks: (
    <>
      <path d="M22 14h-6a4 4 0 0 0-4 4v32a4 4 0 0 0 4 4h28a4 4 0 0 0 4-4V18a4 4 0 0 0-4-4h-6" />
      <path d="M25 10h10a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3z" />
      <path d="M19 27l2.5 2.5L26 25" />
      <path d="M30 27h11" />
      <path d="M19 36l2.5 2.5L26 34" />
      <path d="M30 36h11" />
      <circle cx="22.5" cy="45" r="2.5" />
      <path d="M30 45h7" />
    </>
  ),
  // 无日志: a terminal window with a prompt and nothing after it.
  logs: (
    <>
      <path d="M12 12h40a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" />
      <path d="M8 20h48" />
      <path d="M13 16h.01M17 16h.01M21 16h.01" />
      <path d="M15 29l4 3-4 3" />
      <path d="M23 35h8" />
      <path d="M15 43h18M37 43h6" />
    </>
  ),
  // 未选中数据表: a database with a pointer — pick a table first.
  table: (
    <>
      <ellipse cx="28" cy="16" rx="14" ry="5" />
      <path d="M14 16v28c0 2.8 6.3 5 14 5s14-2.2 14-5V16" />
      <path d="M14 26c0 2.8 6.3 5 14 5s14-2.2 14-5" />
      <path d="M14 35c0 2.8 6.3 5 14 5s14-2.2 14-5" />
      <path d="M45 39l11 4.5-5 2-2 5z" />
    </>
  ),
  // 未选中记录: a list whose middle row is waiting to be picked.
  record: (
    <>
      <rect x="8" y="10" width="40" height="11" rx="3" />
      <rect x="8" y="26.5" width="40" height="11" rx="3" strokeDasharray="3 3" />
      <rect x="8" y="43" width="40" height="11" rx="3" />
      <path d="M13 15.5h16M13 48.5h12" />
      <path d="M42 30l11 4.5-5 2-2 5z" />
    </>
  ),
  // 找不到页面: a page with a folded corner and a question mark.
  'not-found': (
    <>
      <path d="M20 8h18l12 12v32a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" />
      <path d="M38 8v8a4 4 0 0 0 4 4h8" />
      <path d="M28 30a5 5 0 1 1 7.5 4.3c-1.5.9-2.5 2-2.5 3.7V39" />
      <path d="M33 45h.01" />
    </>
  ),
  // 通用空: an empty tray.
  generic: (
    <>
      <path d="M8 36l8-18h32l8 18" />
      <path d="M8 36v12a4 4 0 0 0 4 4h40a4 4 0 0 0 4-4V36" />
      <path d="M8 36h14l3 6h14l3-6h14" />
      <path d="M32 6v6M22 9l2.5 4M42 9l-2.5 4" />
    </>
  ),
}

export interface EmptyIllustrationProps {
  readonly name: EmptyIllustrationName
  /** Pixel size; 64 by default (48 in a compact `EmptyState`). The stroke stays 1.5px. */
  readonly size?: number
  readonly className?: string
}

/** One empty-state illustration (decorative: `aria-hidden`). */
export function EmptyIllustration({ name, size, className }: EmptyIllustrationProps) {
  return (
    <svg
      className={cn('console-empty-art', className)}
      data-illustration={name}
      style={size === undefined ? undefined : { width: size, height: size }}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {ART[name]}
    </svg>
  )
}
