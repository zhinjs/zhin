/**
 * PluginConfigForm 类型定义
 */

export interface SchemaField {
  key?: string
  type: string
  description?: string
  default?: any
  required?: boolean
  enum?: any[]
  min?: number
  max?: number
  step?: number  // 用于 percent 类型
  pattern?: string
  inner?: SchemaField  // 用于 list/dict 类型
  items?: SchemaField  // 兼容旧格式
  list?: SchemaField[]  // 用于 tuple/union/intersect 类型
  properties?: Record<string, SchemaField>
  dict?: Record<string, SchemaField>  // object 类型的字段
  component?: string  // UI 组件提示
}

export interface Schema {
  type: string
  properties?: Record<string, SchemaField>
  dict?: Record<string, SchemaField>
  description?: string
}

export interface PluginConfigFormProps {
  pluginName: string
  schema: Schema | null
  initialConfig?: Record<string, any>
  onSuccess?: () => void
}

export interface FieldRendererProps {
  fieldName: string
  field: SchemaField
  value: any
  onChange: (value: any) => void
  parentPath?: string
  onNestedChange?: (parentPath: string, childKey: string, value: any) => void
  onArrayItemChange?: (fieldName: string, index: number, value: any) => void
}
