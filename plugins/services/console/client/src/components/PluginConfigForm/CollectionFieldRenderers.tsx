/**
 * Collection type field renderers
 */

import { List, Trash2, Plus, Package, Code, Info } from 'lucide-react'
import type { FieldRendererProps, SchemaField } from './types.js'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Separator } from '../ui/separator'

interface CollectionFieldProps extends FieldRendererProps {
  renderNestedField: (fieldName: string, field: SchemaField, value: any, onChange: (val: any) => void) => React.ReactElement
}

export function ListFieldRenderer({
  fieldName, field, value, onChange, onArrayItemChange, renderNestedField
}: CollectionFieldProps) {
  const arrayValue = Array.isArray(value) ? value : []
  const innerField = field.inner || field.items

  if (innerField && ['string', 'number'].includes(innerField.type)) {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
        <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <List className="w-3 h-3" /> 列表输入 (每行一个值)
        </p>
        <Textarea
          value={arrayValue.join('\n')}
          onChange={(e) => {
            const lines = e.target.value.split('\n').filter(Boolean)
            onChange(innerField.type === 'number' ? lines.map(l => parseFloat(l) || 0) : lines)
          }}
          placeholder={`每行一个值\n${field.description || ''}`}
          rows={4} className="font-mono text-sm"
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {arrayValue.map((item, index) => (
        <Card key={index} className="group">
          <div className="p-3 space-y-2">
            <div className="flex justify-between items-center">
              <Badge variant="secondary" className="font-mono">{index + 1}</Badge>
              <Button variant="ghost" size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                onClick={() => onChange(arrayValue.filter((_, i) => i !== index))}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <div className="pl-2 border-l-2">
              {innerField && renderNestedField(`${fieldName}[${index}]`, innerField, item, (val) => {
                onArrayItemChange?.(fieldName, index, val)
              })}
            </div>
          </div>
        </Card>
      ))}
      <Button variant="outline" size="sm" className="w-full border-dashed"
        onClick={() => onChange([...arrayValue, innerField?.default || (innerField?.type === 'object' ? {} : '')])}
      >
        <Plus className="w-4 h-4 mr-1" /> 添加项
      </Button>
    </div>
  )
}

export function ArrayFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <List className="w-3 h-3" /> 数组输入 (每行一个值)
      </p>
      <Textarea
        value={Array.isArray(value) ? value.join('\n') : ''}
        onChange={(e) => onChange(e.target.value.split('\n').filter(Boolean))}
        placeholder={`每行一个值\n${field.description || ''}`}
        rows={3} className="font-mono text-sm"
      />
    </div>
  )
}

export function TupleFieldRenderer({
  fieldName, field, value, onArrayItemChange, renderNestedField
}: CollectionFieldProps) {
  const tupleValue = Array.isArray(value) ? value : []
  const tupleFields = field.list || []

  return (
    <div className="space-y-2">
      {tupleFields.map((tupleField, index) => (
        <div key={index} className="p-3 rounded-lg bg-muted/50 border space-y-2">
          <Badge variant="secondary" className="font-mono">#{index + 1}</Badge>
          {tupleField.description && <p className="text-xs text-muted-foreground">{tupleField.description}</p>}
          <div className="mt-1">
            {renderNestedField(`${fieldName}[${index}]`, tupleField, tupleValue[index], (val) => {
              onArrayItemChange?.(fieldName, index, val)
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function ObjectFieldRenderer({
  fieldName, field, renderField
}: CollectionFieldProps & { renderField: (fieldName: string, field: SchemaField, parentPath?: string) => React.ReactElement }) {
  const objectFields = field.dict || field.properties || {}

  return (
    <div className="rounded-lg border-2 bg-muted/30 overflow-hidden">
      <div className="px-4 py-2 bg-muted border-b flex items-center gap-2">
        <Package className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">对象</span>
      </div>
      <div className="p-3 space-y-2">
        {Object.entries(objectFields).map(([key, nestedField]: [string, any], index) => (
          <div key={key}>
            <div className="p-3 rounded-md bg-background border space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-sm font-semibold">{nestedField.key || key}</span>
                {nestedField.required && <span className="text-destructive font-bold">*</span>}
              </div>
              {nestedField.description && <p className="text-xs text-muted-foreground">{nestedField.description}</p>}
              <div className="mt-1">{renderField(key, nestedField, fieldName)}</div>
            </div>
            {index < Object.entries(objectFields).length - 1 && <Separator className="my-2" />}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DictFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Code className="w-3 h-3" /> 键值对编辑
      </p>
      <Textarea
        value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || '{}'}
        onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch {} }}
        placeholder={field.description || '请输入 JSON 格式'} rows={6} className="font-mono text-sm"
      />
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Info className="w-3 h-3" /> 键值对格式: {"{"}"key": "value"{"}"}
      </p>
    </div>
  )
}
