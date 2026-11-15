import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '../cn.js'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js'

/**
 * An ⓘ label whose explanation opens on click, Enter or Space: for statements about how a number
 * was counted, which readers need once and not on every visit. `label` stays visible; `children`
 * is the explanation.
 */
export function InfoHint({ label, children, className, tone }: { label: ReactNode; children: ReactNode; className?: string; tone?: 'warning' }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('console-info-hint', tone === 'warning' && 'is-warning', className)}>
          <span>{label}</span>
          <Info aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="console-info-hint-panel" align="start">{children}</PopoverContent>
    </Popover>
  )
}
