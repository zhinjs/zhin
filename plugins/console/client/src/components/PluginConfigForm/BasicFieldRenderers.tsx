/**
 * 基础类型字段渲染器
 * 处理: string, number, boolean, percent, date, regexp, const
 */

import { Flex, Box, Text, TextField, TextArea, Switch, Select, Badge, Callout } from '@radix-ui/themes'
import { Icons } from '@zhin.js/client'
import type { FieldRendererProps } from './types.js'

export function StringFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  // 枚举类型 - 下拉选择 - 优化样式
  if (field.enum) {
    return (
      <Select.Root
        size="2"
        value={value?.toString() || ''}
        onValueChange={onChange}
      >
        <Select.Trigger className="w-full hover:border-blue-500 dark:hover:border-blue-400 transition-colors" />
        <Select.Content className="shadow-lg">
          {field.enum.map((option) => (
            <Select.Item 
              key={option} 
              value={option.toString()}
              className="hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              {option.toString()}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    )
  }
  
  // 多行文本 - 优化样式
  if (field.description?.includes('多行') || field.key?.includes('description')) {
    return (
      <TextArea
        size="2"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.description || `请输入`}
        rows={3}
        className="font-sans resize-y hover:border-blue-500 dark:hover:border-blue-400 transition-colors focus:ring-2 focus:ring-blue-500/20"
      />
    )
  }
  
  // 单行文本 - 优化样式
  return (
    <TextField.Root
      size="2"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.description || `请输入`}
      className="hover:border-blue-500 dark:hover:border-blue-400 transition-colors focus-within:ring-2 focus-within:ring-blue-500/20"
    />
  )
}

export function NumberFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <TextField.Root
      size="2"
      type="number"
      value={value?.toString() || ''}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      placeholder={field.description || `请输入数字`}
      min={field.min}
      max={field.max}
      className="hover:border-blue-500 dark:hover:border-blue-400 transition-colors focus-within:ring-2 focus-within:ring-blue-500/20"
    />
  )
}

export function BooleanFieldRenderer({ value, onChange }: FieldRendererProps) {
  return (
    <Flex align="center" gap="3" className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      <Switch
        size="2"
        checked={value === true}
        onCheckedChange={onChange}
        className="cursor-pointer"
      />
      <Flex direction="column" gap="1">
        <Text size="2" weight="bold" color={value ? 'green' : 'gray'}>
          {value ? '已启用' : '已禁用'}
        </Text>
        <Text size="1" color="gray">
          {value ? '功能当前处于开启状态' : '功能当前处于关闭状态'}
        </Text>
      </Flex>
    </Flex>
  )
}

export function PercentFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const percentValue = typeof value === 'number' ? value : (field.default || 0)
  
  return (
    <div className="p-4 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border border-blue-200 dark:border-blue-800">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <input
            type="range"
            min={field.min || 0}
            max={field.max || 1}
            step={field.step || 0.01}
            value={percentValue}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-blue-200 dark:bg-blue-800 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 dark:[&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:cursor-pointer hover:[&::-webkit-slider-thumb]:bg-blue-700 dark:hover:[&::-webkit-slider-thumb]:bg-blue-300 transition-all"
          />
          <TextField.Root
            size="2"
            type="number"
            value={(percentValue * 100).toFixed(0)}
            onChange={(e) => onChange(parseFloat(e.target.value) / 100)}
            min={(field.min || 0) * 100}
            max={(field.max || 1) * 100}
            className="w-24"
          >
            <TextField.Slot side="right">
              <Text size="1" weight="bold" className="text-blue-600 dark:text-blue-400">%</Text>
            </TextField.Slot>
          </TextField.Root>
        </Flex>
        <Flex align="center" justify="between">
          <Text size="1" color="gray">
            当前值
          </Text>
          <Badge color="blue" size="2" variant="soft" className="font-mono">
            {(percentValue * 100).toFixed(1)}%
          </Badge>
        </Flex>
      </Flex>
    </div>
  )
}

export function DateFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const dateValue = value instanceof Date 
    ? value.toISOString().split('T')[0]
    : value || ''
    
  return (
    <div className="relative">
      <TextField.Root
        size="2"
        type="date"
        value={dateValue}
        onChange={(e) => onChange(new Date(e.target.value))}
        placeholder={field.description || '选择日期'}
        className="hover:border-blue-500 dark:hover:border-blue-400 transition-colors focus-within:ring-2 focus-within:ring-blue-500/20"
      >
        <TextField.Slot side="left">
          <Icons.Calendar className="w-4 h-4 text-gray-500" />
        </TextField.Slot>
      </TextField.Root>
    </div>
  )
}

export function RegexpFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const regexpValue = value instanceof RegExp 
    ? value.source 
    : (typeof value === 'string' ? value : '')
    
  return (
    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
      <Flex direction="column" gap="2">
        <TextField.Root
          size="2"
          value={regexpValue}
          onChange={(e) => {
            try {
              onChange(new RegExp(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          placeholder={field.description || '请输入正则表达式'}
          className="font-mono text-sm hover:border-amber-500 dark:hover:border-amber-400 transition-colors"
        >
          <TextField.Slot side="left">
            <Text size="1" className="text-amber-600 dark:text-amber-400 font-bold">/</Text>
          </TextField.Slot>
          <TextField.Slot side="right">
            <Text size="1" className="text-amber-600 dark:text-amber-400 font-bold">/</Text>
          </TextField.Slot>
        </TextField.Root>
        <Flex align="center" gap="2">
          <Icons.Info className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          <Text size="1" className="text-amber-700 dark:text-amber-300">
            输入正则表达式模式 (省略斜杠)
          </Text>
        </Flex>
      </Flex>
    </div>
  )
}

export function ConstFieldRenderer({ field, value }: FieldRendererProps) {
  const constValue = field.default || value
  
  return (
    <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700">
      <Flex align="center" gap="3">
        <Icons.Lock className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <Badge variant="soft" size="2" className="font-mono">
          {String(constValue)}
        </Badge>
        <Text size="1" color="gray" className="ml-auto">
          (常量，不可修改)
        </Text>
      </Flex>
    </div>
  )
}

export function AnyFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="2">
          <Icons.Code className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <Text size="1" weight="bold" className="text-purple-700 dark:text-purple-300">
            JSON 格式输入
          </Text>
        </Flex>
        <TextArea
          size="2"
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '')}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          placeholder={field.description || '支持任意类型 (JSON 格式)'}
          rows={4}
          className="font-mono text-sm bg-white dark:bg-gray-950 hover:border-purple-500 dark:hover:border-purple-400 transition-colors"
        />
        <Flex align="center" gap="2">
          <Icons.Info className="w-3 h-3 text-purple-600 dark:text-purple-400" />
          <Text size="1" className="text-purple-700 dark:text-purple-300">
            支持: 字符串、数字、布尔值、对象、数组
          </Text>
        </Flex>
      </Flex>
    </div>
  )
}
