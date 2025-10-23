/**
 * 嵌套字段渲染器
 * 用于渲染数组项、元组项等嵌套字段
 */

import { Flex, Box, Text, TextField, TextArea, Switch, Card } from '@radix-ui/themes'
import type { SchemaField } from './types.js'

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
        <TextField.Root
          size="1"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description || '请输入'}
        />
      )
    
    case 'number':
    case 'integer':
      return (
        <TextField.Root
          size="1"
          type="number"
          value={value?.toString() || ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder={field.description || '请输入数字'}
          min={field.min}
          max={field.max}
        />
      )
    
    case 'boolean':
      return (
        <Flex align="center" gap="2">
          <Switch
            checked={value === true}
            onCheckedChange={onChange}
          />
          <Text size="2" color={value ? 'green' : 'gray'}>
            {value ? '已启用' : '已禁用'}
          </Text>
        </Flex>
      )
    
    case 'object': {
      const objectFields = field.dict || field.properties || {}
      return (
        <Card size="1">
          <Flex direction="column" gap="2" p="2">
            {Object.entries(objectFields).map(([key, nestedField]: [string, any]) => (
              <Box key={key}>
                <Text size="1" weight="bold">{key}</Text>
                <NestedFieldRenderer
                  fieldName={key}
                  field={nestedField}
                  value={value?.[key]}
                  onChange={(val) => {
                    onChange({ ...value, [key]: val })
                  }}
                />
              </Box>
            ))}
          </Flex>
        </Card>
      )
    }
    
    default:
      return (
        <TextArea
          size="1"
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : value || ''}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          rows={3}
          className="font-mono text-xs"
        />
      )
  }
}
