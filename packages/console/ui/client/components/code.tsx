import type { HTMLAttributes } from 'react'
import { cn } from '../cn.js'

export interface InlineCodeProps extends HTMLAttributes<HTMLElement> {
  /** `subtle` (default): a very light fill; `plain`: no fill, only the monospace face. */
  readonly tone?: 'subtle' | 'plain'
}

/**
 * Short identifiers inside text — package names, RPC names, IDs, cron expressions (ADR 0063 D31):
 * `--console-font-mono`, no border, a very light fill or none. Also available as the
 * `console-code` class for elements that are not React components.
 */
export function InlineCode({ tone = 'subtle', className, ...props }: InlineCodeProps) {
  return <code data-slot="code" data-tone={tone === 'plain' ? 'plain' : undefined} className={cn('console-code', className)} {...props} />
}
