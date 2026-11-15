import { createElement, isValidElement, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../cn.js'

export interface StatCardProps {
  /** A Lucide icon component, an element, or an image URL (declarative stats, ADR 0063 P2). */
  icon?: LucideIcon | ReactNode
  label: ReactNode
  value: ReactNode
  /** After the value, in label size (e.g. 「ms」). */
  unit?: ReactNode
  /** On the label row, right-aligned (status badge). */
  badge?: ReactNode
  /** Under the value (progress meter). */
  footer?: ReactNode
  sub?: ReactNode
  tone?: 'danger' | 'warning'
  /** 数值右侧的附加内容，如环形进度 */
  aside?: ReactNode
  /** 提供时整张卡片可点击（跳转或筛选） */
  onOpen?: () => void
  /** 作为筛选器使用时的选中状态 */
  pressed?: boolean
}

/**
 * 指标卡：图标 + 标签、大号数值、说明文字。总览页与列表页共用。
 */
export function StatCard({ icon, label, value, unit, badge, footer, sub, tone, aside, onOpen, pressed }: StatCardProps) {
  const className = cn('console-stat-card', tone && `is-${tone}`, onOpen && 'is-link', pressed && 'is-pressed')
  const labelRow = <span className="console-stat-label">{statIcon(icon)}{label}</span>
  const content = (
    <>
      {badge != null ? <span className="console-stat-head">{labelRow}{badge}</span> : labelRow}
      <span className="console-stat-value-row">
        <strong className="console-stat-value">
          {value}
          {unit != null ? <span className="console-stat-unit">{unit}</span> : null}
        </strong>
        {aside}
      </span>
      {footer}
      {sub !== undefined && sub !== null ? <span className="console-stat-sub">{sub}</span> : null}
    </>
  )
  if (!onOpen) return <div className={className} data-slot="stat-card">{content}</div>
  return (
    // eslint-disable-next-line console-ui/no-native-controls -- the stat card itself is the button (focus ring and size come from .console-stat-card)
    <button type="button" className={className} onClick={onOpen} aria-pressed={pressed} data-slot="stat-card" data-interactive="">
      {content}
    </button>
  )
}

function statIcon(icon: StatCardProps['icon']): ReactNode {
  if (icon == null || icon === '') return null
  if (typeof icon === 'string') return <img src={icon} alt="" className="console-stat-icon" />
  if (isValidElement(icon)) return icon
  if (typeof icon === 'function' || (typeof icon === 'object' && '$$typeof' in icon)) return createElement(icon as LucideIcon, { 'aria-hidden': true })
  return icon as ReactNode
}

export function StatGrid({ children, label, ...data }: { children: ReactNode; label: string; [data: `data-${string}`]: string | undefined }) {
  return (
    <section className="console-cq" aria-label={label} data-slot="stat-grid" {...data}>
      <div className="console-stat-grid">{children}</div>
    </section>
  )
}

export function MiniRingGauge({ percent, tone = 'primary' }: { percent: number; tone?: 'primary' | 'success' | 'warning' }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const r = 16
  const c = 2 * Math.PI * r
  const offset = c - (clamped / 100) * c
  const stroke =
    tone === 'success'
      ? 'hsl(var(--success))'
      : tone === 'warning'
        ? 'hsl(var(--warning))'
        : 'hsl(var(--primary))'
  return (
    <span className="console-ring-gauge" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth="3.5" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="console-ring-gauge-label">{clamped}%</span>
    </span>
  )
}
