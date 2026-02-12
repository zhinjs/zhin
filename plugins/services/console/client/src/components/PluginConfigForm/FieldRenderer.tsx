/**
 * Field renderer - dispatches to type-specific renderers
 */

import type { FieldRendererProps, SchemaField } from './types.js'
import { Textarea } from '../ui/textarea'
import {
  StringFieldRenderer, NumberFieldRenderer, BooleanFieldRenderer,
  PercentFieldRenderer, DateFieldRenderer, RegexpFieldRenderer,
  ConstFieldRenderer, AnyFieldRenderer
} from './BasicFieldRenderers.js'
import {
  ListFieldRenderer, ArrayFieldRenderer, TupleFieldRenderer,
  ObjectFieldRenderer, DictFieldRenderer
} from './CollectionFieldRenderers.js'
import { UnionFieldRenderer, IntersectFieldRenderer } from './CompositeFieldRenderers.js'

interface FieldRendererConfig extends FieldRendererProps {
  renderField: (fieldName: string, field: SchemaField, parentPath?: string) => React.ReactElement
  renderNestedField: (fieldName: string, field: SchemaField, value: any, onChange: (val: any) => void) => React.ReactElement
}

export function FieldRenderer(props: FieldRendererConfig) {
  const { field } = props

  switch (field.type) {
    case 'string': return <StringFieldRenderer {...props} />
    case 'number': case 'integer': return <NumberFieldRenderer {...props} />
    case 'boolean': return <BooleanFieldRenderer {...props} />
    case 'percent': return <PercentFieldRenderer {...props} />
    case 'date': return <DateFieldRenderer {...props} />
    case 'regexp': return <RegexpFieldRenderer {...props} />
    case 'const': return <ConstFieldRenderer {...props} />
    case 'any': return <AnyFieldRenderer {...props} />
    case 'list': return <ListFieldRenderer {...props} />
    case 'array': return <ArrayFieldRenderer {...props} />
    case 'tuple': return <TupleFieldRenderer {...props} />
    case 'object': return <ObjectFieldRenderer {...props} />
    case 'dict': return <DictFieldRenderer {...props} />
    case 'union': return <UnionFieldRenderer {...props} />
    case 'intersect': return <IntersectFieldRenderer {...props} />
    default:
      return (
        <Textarea
          value={typeof props.value === 'object' ? JSON.stringify(props.value, null, 2) : props.value || ''}
          onChange={(e) => {
            try { props.onChange(JSON.parse(e.target.value)) } catch { props.onChange(e.target.value) }
          }}
          placeholder={field.description || '请输入 JSON 格式'}
          rows={4}
          className="font-mono text-xs"
        />
      )
  }
}

export function isComplexField(field: SchemaField): boolean {
  return ['object', 'list', 'tuple', 'union', 'intersect', 'any'].includes(field.type)
    || (field.type === 'dict' && !!field.dict)
}
