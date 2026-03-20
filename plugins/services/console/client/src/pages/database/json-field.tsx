import type { ChangeEvent } from 'react'
import { Input } from '../../components/ui/input'

export function JsonField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} className="font-mono text-xs" />
    </div>
  )
}
