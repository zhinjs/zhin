/**
 * Basic type field renderers
 */

import type { FieldRendererProps } from './types.js'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Badge } from '../ui/badge'
import { Calendar, Info, Lock, Code } from 'lucide-react'

export function StringFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  if (field.enum) {
    return (
      <Select value={value?.toString() || ''} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent>
          {field.enum.map((option) => (
            <SelectItem key={option} value={option.toString()}>{option.toString()}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.description?.includes('多行') || field.key?.includes('description')) {
    return (
      <Textarea
        value={value || ''} onChange={(e) => onChange(e.target.value)}
        placeholder={field.description || '请输入'} rows={3}
      />
    )
  }

  return (
    <Input
      value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={field.description || '请输入'}
    />
  )
}

export function NumberFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <Input
      type="number" value={value?.toString() || ''}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      placeholder={field.description || '请输入数字'}
      min={field.min} max={field.max}
    />
  )
}

export function BooleanFieldRenderer({ value, onChange }: FieldRendererProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
      <Switch checked={value === true} onCheckedChange={onChange} />
      <div className="flex flex-col gap-0.5">
        <span className={`text-sm font-medium ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
          {value ? '已启用' : '已禁用'}
        </span>
        <span className="text-xs text-muted-foreground">
          {value ? '功能当前处于开启状态' : '功能当前处于关闭状态'}
        </span>
      </div>
    </div>
  )
}

export function PercentFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const percentValue = typeof value === 'number' ? value : (field.default || 0)
  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="range" min={field.min || 0} max={field.max || 1}
          step={field.step || 0.01} value={percentValue}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-secondary"
        />
        <div className="flex items-center gap-1">
          <Input
            type="number" className="w-20 h-8 text-xs"
            value={(percentValue * 100).toFixed(0)}
            onChange={(e) => onChange(parseFloat(e.target.value) / 100)}
            min={(field.min || 0) * 100} max={(field.max || 1) * 100}
          />
          <span className="text-xs font-bold text-muted-foreground">%</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">当前值</span>
        <Badge variant="secondary" className="font-mono">{(percentValue * 100).toFixed(1)}%</Badge>
      </div>
    </div>
  )
}

export function DateFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const dateValue = value instanceof Date ? value.toISOString().split('T')[0] : value || ''
  return (
    <div className="relative">
      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        type="date" value={dateValue}
        onChange={(e) => onChange(new Date(e.target.value))}
        placeholder={field.description || '选择日期'} className="pl-9"
      />
    </div>
  )
}

export function RegexpFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const regexpValue = value instanceof RegExp ? value.source : (typeof value === 'string' ? value : '')
  return (
    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-sm font-bold text-amber-600 dark:text-amber-400">/</span>
        <Input
          value={regexpValue} className="font-mono text-sm"
          onChange={(e) => { try { onChange(new RegExp(e.target.value)) } catch { onChange(e.target.value) } }}
          placeholder={field.description || '请输入正则表达式'}
        />
        <span className="text-sm font-bold text-amber-600 dark:text-amber-400">/</span>
      </div>
      <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
        <Info className="w-3 h-3" /> 输入正则表达式模式 (省略斜杠)
      </p>
    </div>
  )
}

export function ConstFieldRenderer({ field, value }: FieldRendererProps) {
  const constValue = field.default || value
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted border">
      <Lock className="w-4 h-4 text-muted-foreground" />
      <Badge variant="secondary" className="font-mono">{String(constValue)}</Badge>
      <span className="text-xs text-muted-foreground ml-auto">(常量，不可修改)</span>
    </div>
  )
}

export function AnyFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Code className="w-3 h-3" /> JSON 格式输入
      </p>
      <Textarea
        value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '')}
        onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { onChange(e.target.value) } }}
        placeholder={field.description || '支持任意类型 (JSON 格式)'} rows={4} className="font-mono text-sm"
      />
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Info className="w-3 h-3" /> 支持: 字符串、数字、布尔值、对象、数组
      </p>
    </div>
  )
}
