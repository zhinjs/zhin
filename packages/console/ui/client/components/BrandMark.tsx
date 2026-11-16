import type { CSSProperties } from 'react'
import { cn } from '../cn.js'

/** The product name shown next to the mark (zhinjs/console#125: one name everywhere). */
export const CONSOLE_PRODUCT_NAME = 'Zhin Console'

export interface BrandMarkProps {
  /** `sm` 20px, `md` 28px (default), `lg` 40px, or a pixel size. */
  readonly size?: 'sm' | 'md' | 'lg' | number
  /** Show the product name next to the mark. */
  readonly withText?: boolean
  /** Product name; defaults to 「Zhin Console」. Also the accessible name of a mark without text. */
  readonly label?: string
  readonly className?: string
}

/*
 * The Console favicon (zhinjs/console client/favicon.svg): rounded square, Z, dot. Colors are the
 * brand tokens, never the palette (ADR 0063 「色板角色与信号色」): the square is `brand`
 * (#76EEC6 light / #7FFFD4 dark, owner 2026-11-16), the Z `brand-foreground`, the dot
 * `brand-foreground` at half strength. The fallbacks keep the mark right without tokens.css.
 */
const SQUARE = 'hsl(var(--console-brand, 160 78% 69.8%))'
const INK = 'hsl(var(--console-brand-foreground, 160 80% 10%))'

/**
 * The Zhin brand mark (SVG), optionally with the product name. Same shape and colors under every
 * palette; only the light / dark brand value differs.
 */
export function BrandMark({ size = 'md', withText = false, label = CONSOLE_PRODUCT_NAME, className }: BrandMarkProps) {
  const preset = typeof size === 'number' ? undefined : size
  const style: CSSProperties | undefined = typeof size === 'number' ? { width: size, height: size } : undefined
  return (
    <span className={cn('console-brand', className)} data-slot="brand-mark" data-size={preset ?? 'custom'}>
      <svg
        className="console-brand-mark"
        style={style}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        {...(withText ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      >
        <rect width="64" height="64" rx="18" fill={SQUARE} />
        <path d="M18 18H46L43.4 24.2L28.5 40H45.5V47H17.5L20.1 40.8L35 25H18V18Z" fill={INK} />
        <circle cx="49" cy="15" r="5" fill={INK} fillOpacity={0.5} />
      </svg>
      {withText ? <span className="console-brand-name">{label}</span> : null}
    </span>
  )
}
