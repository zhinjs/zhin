import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../cn.js'

export interface StatCardProps {
  icon: LucideIcon
  label: string
  value: ReactNode
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
export function StatCard({ icon: Icon, label, value, sub, tone, aside, onOpen, pressed }: StatCardProps) {
  const className = cn('console-stat-card', tone && `is-${tone}`, onOpen && 'is-link', pressed && 'is-pressed')
  const content = (
    <>
      <span className="console-stat-label"><Icon aria-hidden="true" />{label}</span>
      <span className="console-stat-value-row">
        <strong className="console-stat-value">{value}</strong>
        {aside}
      </span>
      {sub !== undefined ? <span className="console-stat-sub">{sub}</span> : null}
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

export function StatGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="console-cq" aria-label={label} data-slot="stat-grid">
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
