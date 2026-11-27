import type { ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * State of an object as shown in lists (ADR 0063 D15 第 1 条, soft cards D39): a dot and a word,
 * never colour alone. The five soft-card tones are `ok`, `warn`, `danger`, `neutral` and
 * `progress` (ink text, a breathing progress dot). The older names stay: `warning` = `warn`,
 * `error` = `danger`, `info` / `pending` = `progress`.
 */
export type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'progress'
export type ConsoleStatus = StatusTone | 'info' | 'pending' | 'warning' | 'error'

const TONE: Readonly<Record<ConsoleStatus, StatusTone>> = {
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
  neutral: 'neutral',
  progress: 'progress',
  info: 'progress',
  pending: 'progress',
  warning: 'warn',
  error: 'danger',
}

/** The soft-card tone of a status (`warning` → `warn`, `error` → `danger`, `info` / `pending` → `progress`). */
export function statusTone(status: ConsoleStatus): StatusTone {
  return TONE[status] ?? 'neutral'
}

export interface StatusBadgeProps {
  status: ConsoleStatus
  children: ReactNode
  className?: string
}

/** Whether a status needs attention (ok and neutral are quiet; the rest stand out). */
export function isAttentionStatus(status: ConsoleStatus): boolean {
  const tone = statusTone(status)
  return tone !== 'ok' && tone !== 'neutral'
}

/** 「点 + 文字」 status (soft cards). Same component as {@link StatusDot}. */
export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  const tone = statusTone(status)
  return (
    <span className={cn('console-status', className)} data-slot="status" data-status={status} data-tone={tone}>
      {children}
    </span>
  )
}

export interface StatusDotProps {
  tone: StatusTone
  children: ReactNode
  className?: string
}

/** The soft-card status: a coloured dot and its word (`<StatusDot tone="ok">在线</StatusDot>`). */
export function StatusDot({ tone, children, className }: StatusDotProps) {
  return <StatusBadge status={tone} className={className}>{children}</StatusBadge>
}
