import type { ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * State of an object as shown in lists (ADR 0063 D15 第 1 条): colored badges only for states that
 * are abnormal or need attention; 「正常」 and neutral states are muted text.
 */
export type ConsoleStatus = 'ok' | 'neutral' | 'info' | 'pending' | 'warning' | 'error'

const QUIET: ReadonlySet<ConsoleStatus> = new Set(['ok', 'neutral'])

const BADGE_CLASS: Readonly<Record<Exclude<ConsoleStatus, 'ok' | 'neutral'>, string>> = {
  info: 'console-badge-info',
  pending: 'console-badge-info',
  warning: 'console-badge-warning',
  error: 'console-badge-danger',
}

export interface StatusBadgeProps {
  status: ConsoleStatus
  children: ReactNode
  className?: string
}

/** Whether a status is rendered as a colored badge (only abnormal / attention states are). */
export function isAttentionStatus(status: ConsoleStatus): boolean {
  return !QUIET.has(status)
}

export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  if (QUIET.has(status)) {
    return <span className={cn('console-status-quiet', className)} data-slot="status" data-status={status}>{children}</span>
  }
  return (
    <span
      className={cn('console-badge', BADGE_CLASS[status as keyof typeof BADGE_CLASS], className)}
      data-slot="badge"
      data-status={status}
    >
      {children}
    </span>
  )
}
