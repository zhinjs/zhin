/**
 * Composite type field renderers
 */

import { GitBranch, Layers } from 'lucide-react'
import type { FieldRendererProps, SchemaField } from './types.js'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

interface CompositeFieldProps extends FieldRendererProps {
  renderNestedField: (fieldName: string, field: SchemaField, value: any, onChange: (val: any) => void) => React.ReactElement
}

export function UnionFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const unionFields = field.list || []

  if (unionFields.length === 0) {
    return (
      <Input
        value={value || ''} onChange={(e) => onChange(e.target.value)}
        placeholder={field.description || '请输入值'}
      />
    )
  }

  const options = unionFields.map((uf: any) => uf.default || uf.type)

  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <GitBranch className="w-3 h-3" /> 联合类型
      </p>
      <Select value={value?.toString() || ''} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent>
          {options.map((option: any, index: number) => (
            <SelectItem key={index} value={String(option)}>{String(option)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function IntersectFieldRenderer({
  fieldName, field, value, onChange, renderNestedField
}: CompositeFieldProps) {
  const intersectFields = field.list || []

  return (
    <div className="rounded-lg border-2 bg-muted/30 overflow-hidden">
      <div className="px-4 py-2 bg-muted border-b flex items-center gap-2">
        <Layers className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">交叉类型</span>
      </div>
      <div className="p-3 space-y-2">
        {intersectFields.map((iField: any, index: number) => (
          <div key={index} className="p-3 rounded-md bg-background border space-y-1">
            {iField.description && <p className="text-xs text-muted-foreground">{iField.description}</p>}
            <div className="mt-1">{renderNestedField(`${fieldName}[${index}]`, iField, value, onChange)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
