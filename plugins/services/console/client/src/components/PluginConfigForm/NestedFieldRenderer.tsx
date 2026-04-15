/**
 * Nested field renderer for array items, tuple slots, etc.
 */

import type { SchemaField } from './types.js'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { Card } from '../ui/card'

interface NestedFieldRendererProps {
  fieldName: string
  field: SchemaField
  value: any
  onChange: (val: any) => void
}

export function NestedFieldRenderer({ field, value, onChange }: NestedFieldRendererProps): React.ReactElement {
  switch (field.type) {
    case 'string':
      return (
        <Input
          value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder={field.description || '请输入'} className="h-8 text-sm"
        />
      )

    case 'number':
    case 'integer':
      return (
        <Input
          type="number" value={value?.toString() || ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder={field.description || '请输入数字'}
          min={field.min} max={field.max} className="h-8 text-sm"
        />
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch checked={value === true} onCheckedChange={onChange} />
          <span className={`text-sm ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
            {value ? '已启用' : '已禁用'}
          </span>
        </div>
      )

    case 'object': {
      const objectFields = field.dict || field.properties || {}
      return (
        <Card className="p-2 space-y-2">
          {Object.entries(objectFields).map(([key, nestedField]: [string, any]) => (
            <div key={key} className="space-y-1">
              <span className="text-xs font-semibold">{key}</span>
              <NestedFieldRenderer
                fieldName={key} field={nestedField} value={value?.[key]}
                onChange={(val) => onChange({ ...value, [key]: val })}
              />
            </div>
          ))}
        </Card>
      )
    }

    default:
      return (
        <Textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || ''}
          onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { onChange(e.target.value) } }}
          rows={3} className="font-mono text-xs"
        />
      )
  }
}
