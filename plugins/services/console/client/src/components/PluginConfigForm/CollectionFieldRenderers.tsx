/**
 * 集合类型字段渲染器
 * 处理: list, tuple, object, dict
 */

import { Flex, Box, Text, TextArea, Button, Badge, Card, Separator } from '@radix-ui/themes'
import { List, Trash2, Plus, Package, Code, Info } from 'lucide-react'
import type { FieldRendererProps, SchemaField } from './types.js'

interface CollectionFieldProps extends FieldRendererProps {
  renderNestedField: (
    fieldName: string,
    field: SchemaField,
    value: any,
    onChange: (val: any) => void
  ) => React.ReactElement
}

export function ListFieldRenderer({ 
  fieldName,
  field, 
  value, 
  onChange,
  onArrayItemChange,
  renderNestedField
}: CollectionFieldProps) {
  const arrayValue = Array.isArray(value) ? value : []
  const innerField = field.inner || field.items
  
  // 简单类型 - 使用多行文本 - 优化样式
  if (innerField && ['string', 'number'].includes(innerField.type)) {
    return (
      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <List className="w-4 h-4 text-green-600 dark:text-green-400" />
            <Text size="1" weight="bold" className="text-green-700 dark:text-green-300">
              列表输入 (每行一个值)
            </Text>
          </Flex>
          <TextArea
            size="2"
            value={arrayValue.join('\n')}
            onChange={(e) => {
              const lines = e.target.value.split('\n').filter(Boolean)
              const parsed = innerField.type === 'number' 
                ? lines.map(l => parseFloat(l) || 0)
                : lines
              onChange(parsed)
            }}
            placeholder={`每行一个值\n${field.description || ''}`}
            rows={4}
            className="font-mono text-sm bg-white dark:bg-gray-950 hover:border-green-500 dark:hover:border-green-400 transition-colors"
          />
        </Flex>
      </div>
    )
  }
  
  // 复杂类型 - Card 列表 - 优化样式
  return (
    <Flex direction="column" gap="2">
      <div className="space-y-2">
        {arrayValue.map((item, index) => (
          <Card 
            key={index} 
            size="1" 
            variant="surface"
            className="border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors group"
          >
            <Flex direction="column" gap="2" className="p-3">
              <Flex justify="between" align="center">
                <Flex align="center" gap="2">
                  <Badge size="1" variant="soft" color="blue" className="font-mono">
                    {index + 1}
                  </Badge>
                </Flex>
                <Button
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={() => {
                    const newArr = arrayValue.filter((_, i) => i !== index)
                    onChange(newArr)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </Flex>
              <div className="pl-2 border-l-2 border-blue-200 dark:border-blue-800">
                {innerField && renderNestedField(`${fieldName}[${index}]`, innerField, item, (val) => {
                  onArrayItemChange?.(fieldName, index, val)
                })}
              </div>
            </Flex>
          </Card>
        ))}
      </div>
      <Button
        size="2"
        variant="soft"
        onClick={() => {
          const newItem = innerField?.default || (innerField?.type === 'object' ? {} : '')
          onChange([...arrayValue, newItem])
        }}
        className="w-full hover:bg-blue-100 dark:hover:bg-blue-900/30 border-2 border-dashed border-blue-300 dark:border-blue-700 hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
      >
        <Plus className="w-4 h-4" />
        添加项
      </Button>
    </Flex>
  )
}

export function ArrayFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  // 兼容旧格式 - 优化样式
  return (
    <div className="p-3 rounded-lg bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <List className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <Text size="1" weight="bold" className="text-cyan-700 dark:text-cyan-300">
            数组输入 (每行一个值)
          </Text>
        </Flex>
        <TextArea
          size="2"
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={(e) => onChange(e.target.value.split('\n').filter(Boolean))}
          placeholder={`每行一个值\n${field.description || ''}`}
          rows={3}
          className="font-mono text-sm bg-white dark:bg-gray-950 hover:border-cyan-500 dark:hover:border-cyan-400 transition-colors"
        />
      </Flex>
    </div>
  )
}

export function TupleFieldRenderer({
  fieldName,
  field,
  value,
  onArrayItemChange,
  renderNestedField
}: CollectionFieldProps) {
  const tupleValue = Array.isArray(value) ? value : []
  const tupleFields = field.list || []
  
  return (
    <div className="space-y-3">
      {tupleFields.map((tupleField, index) => (
        <div 
          key={index}
          className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
        >
          <Flex direction="column" gap="2">
            <Flex align="center" gap="2">
              <Badge size="1" variant="soft" color="indigo" className="font-mono">
                #{index + 1}
              </Badge>
            </Flex>
            {tupleField.description && (
              <Text size="1" className="text-indigo-700 dark:text-indigo-300">
                {tupleField.description}
              </Text>
            )}
            <div className="mt-1">
              {renderNestedField(`${fieldName}[${index}]`, tupleField, tupleValue[index], (val) => {
                onArrayItemChange?.(fieldName, index, val)
              })}
            </div>
          </Flex>
        </div>
      ))}
    </div>
  )
}

export function ObjectFieldRenderer({
  fieldName,
  field,
  value,
  renderField
}: CollectionFieldProps & { renderField: (fieldName: string, field: SchemaField, parentPath?: string) => React.ReactElement }) {
  const objectFields = field.dict || field.properties || {}
  
  return (
    <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50/50 to-cyan-50/50 dark:from-blue-900/10 dark:to-cyan-900/10 overflow-hidden">
      <div className="px-4 py-2 bg-blue-100 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800">
        <Flex align="center" gap="2">
          <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </Flex>
      </div>
      <div className="p-4 space-y-3">
        {Object.entries(objectFields).map(([key, nestedField]: [string, any], index) => (
          <div key={key}>
            <div className="p-3 rounded-md bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
              <Flex direction="column" gap="2">
                <Flex align="center" gap="1">
                  <Text size="2" weight="bold" className="text-gray-900 dark:text-gray-100">
                    {nestedField.key || key}
                  </Text>
                  {nestedField.required && (
                    <Text size="2" weight="bold" color="red" className="leading-none">
                      *
                    </Text>
                  )}
                </Flex>
                {nestedField.description && (
                  <Text size="1" color="gray">
                    {nestedField.description}
                  </Text>
                )}
                <div className="mt-1">
                  {renderField(key, nestedField, fieldName)}
                </div>
              </Flex>
            </div>
            {index < Object.entries(objectFields).length - 1 && (
              <Separator size="4" className="my-2" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DictFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="2">
          <Code className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </Flex>
        <TextArea
          size="2"
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || '{}'}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value)
              onChange(parsed)
            } catch {
              // 忽略解析错误，继续编辑
            }
          }}
          placeholder={field.description || '请输入 JSON 格式'}
          rows={6}
          className="font-mono text-sm bg-white dark:bg-gray-950 hover:border-violet-500 dark:hover:border-violet-400 transition-colors"
        />
        <Flex align="center" gap="2">
          <Info className="w-3 h-3 text-violet-600 dark:text-violet-400" />
          <Text size="1" className="text-violet-700 dark:text-violet-300">
            键值对格式: &#123;"key": "value"&#125;
          </Text>
        </Flex>
      </Flex>
    </div>
  )
}
