/**
 * 组合类型字段渲染器
 * 处理: union, intersect
 */

import { Flex, Box, Text, TextField, Select, Card, Badge } from '@radix-ui/themes'
import { Icons } from '@zhin.js/client'
import type { FieldRendererProps, SchemaField } from './types.js'

interface CompositeFieldProps extends FieldRendererProps {
  renderNestedField: (
    fieldName: string,
    field: SchemaField,
    value: any,
    onChange: (val: any) => void
  ) => React.ReactElement
}

export function UnionFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const unionFields = field.list || []
  
  if (unionFields.length === 0) {
    return (
      <TextField.Root
        size="2"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.description || '请输入值'}
        className="hover:border-blue-500 dark:hover:border-blue-400 transition-colors focus-within:ring-2 focus-within:ring-blue-500/20"
      />
    )
  }
  
  // 如果所有选项都是简单类型，使用下拉选择 - 优化样式
  const options = unionFields.map((uf: any) => uf.default || uf.type)
  
  return (
    <div className="p-3 rounded-lg bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-900/20 dark:to-rose-900/20 border border-pink-200 dark:border-pink-800">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Icons.GitBranch className="w-4 h-4 text-pink-600 dark:text-pink-400" />
        </Flex>
        <Select.Root
          size="2"
          value={value?.toString() || ''}
          onValueChange={onChange}
        >
          <Select.Trigger className="w-full hover:border-pink-500 dark:hover:border-pink-400 transition-colors" />
          <Select.Content className="shadow-lg">
            {options.map((option: any, index: number) => (
              <Select.Item 
                key={index} 
                value={String(option)}
                className="hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors"
              >
                <Flex align="center" gap="2">
                  <Text>{String(option)}</Text>
                </Flex>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
    </div>
  )
}

export function IntersectFieldRenderer({
  fieldName,
  field,
  value,
  onChange,
  renderNestedField
}: CompositeFieldProps) {
  const intersectFields = field.list || []
  
  return (
    <div className="rounded-lg border-2 border-teal-200 dark:border-teal-800 bg-gradient-to-br from-teal-50/50 to-emerald-50/50 dark:from-teal-900/10 dark:to-emerald-900/10 overflow-hidden">
      <div className="px-4 py-2 bg-teal-100 dark:bg-teal-900/30 border-b border-teal-200 dark:border-teal-800">
        <Flex align="center" gap="2">
          <Icons.Layers className="w-4 h-4 text-teal-600 dark:text-teal-400" />
        </Flex>
      </div>
      <div className="p-4 space-y-3">
        {intersectFields.map((iField: any, index: number) => (
          <div 
            key={index}
            className="p-3 rounded-md bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800"
          >
            <Flex direction="column" gap="2">
              {iField.description && (
                <Text size="1" color="gray">
                  {iField.description}
                </Text>
              )}
              <div className="mt-1">
                {renderNestedField(`${fieldName}[${index}]`, iField, value, onChange)}
              </div>
            </Flex>
          </div>
        ))}
      </div>
    </div>
  )
}
