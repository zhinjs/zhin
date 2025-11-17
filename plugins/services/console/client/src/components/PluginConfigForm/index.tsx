/**
 * PluginConfigForm 主组件
 * 插件配置表单 - 基于 Schema 自动生成
 * 改为折叠面板形式，使用 WebSocket 传递配置
 */

import { useState, useEffect } from 'react'
import { 
  Flex, 
  Box, 
  Text, 
  Button, 
  Spinner,
  Callout,
  Separator,
  Badge,
  ScrollArea,
  Card
} from '@radix-ui/themes'
import { Accordion } from 'radix-ui'
import { useConfig } from '@zhin.js/client'
import type { PluginConfigFormProps, SchemaField, Schema } from './types.js'
import { Settings, ChevronDown, CheckCircle, AlertCircle, X, Save } from 'lucide-react'
import { FieldRenderer, isComplexField } from './FieldRenderer.js'
import { NestedFieldRenderer } from './NestedFieldRenderer.js'

export function PluginConfigForm({ pluginName, onSuccess }: Omit<PluginConfigFormProps, 'schema' | 'initialConfig'>) {
  const [localConfig, setLocalConfig] = useState<Record<string, any>>({})
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState<string | undefined>(undefined)

  // 使用 WebSocket 配置管理
  const { config, schema, loading, error, connected, setConfig } = useConfig(pluginName)
  // 当远程配置改变时更新本地配置
  useEffect(() => {
    if (config) {
      setLocalConfig(config)
    }
  }, [config])

  const handleSave = async () => {
    if (!connected) {
      setSuccessMessage(null)
      return
    }

    try {
      await setConfig(localConfig)
      setSuccessMessage('配置已保存成功')
      setTimeout(() => {
        setIsExpanded(undefined) // 收起面板
        onSuccess?.()
        setSuccessMessage(null)
      }, 1500)
    } catch (err) {
      console.error('保存配置失败:', err)
    }
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    setLocalConfig(prev => ({ ...prev, [fieldName]: value }))
  }

  const handleNestedFieldChange = (parentPath: string, childKey: string, value: any) => {
    setLocalConfig(prev => ({
      ...prev,
      [parentPath]: {
        ...(prev[parentPath] || {}),
        [childKey]: value
      }
    }))
  }

  const handleArrayItemChange = (fieldName: string, index: number, value: any) => {
    setLocalConfig(prev => {
      const arr = Array.isArray(prev[fieldName]) ? [...prev[fieldName]] : []
      arr[index] = value
      return { ...prev, [fieldName]: arr }
    })
  }

  const renderField = (fieldName: string, field: SchemaField, parentPath?: string): React.ReactElement => {
    const fullPath = parentPath ? `${parentPath}.${fieldName}` : fieldName
    const value = parentPath 
      ? localConfig[parentPath]?.[fieldName] ?? field.default
      : localConfig[fieldName] ?? field.default

    const onChange = parentPath
      ? (val: any) => handleNestedFieldChange(parentPath, fieldName, val)
      : (val: any) => handleFieldChange(fieldName, val)

    return (
      <FieldRenderer
        fieldName={fieldName}
        field={field}
        value={value}
        onChange={onChange}
        parentPath={parentPath}
        onNestedChange={handleNestedFieldChange}
        onArrayItemChange={handleArrayItemChange}
        renderField={renderField}
        renderNestedField={(fn, f, v, oc) => (
          <NestedFieldRenderer fieldName={fn} field={f} value={v} onChange={oc} />
        )}
      />
    )
  }

  const fields = schema?.properties || schema?.dict || {}
  
  if (!schema || !fields || Object.keys(fields).length === 0) {
    return null // 没有配置则不显示
  }

  return (
    <Card size="2" className="mt-4">
      <Accordion.Root 
        type="single" 
        collapsible 
        value={isExpanded}
        onValueChange={setIsExpanded}
      >
        <Accordion.Item value="config" className="border-none">
          <Accordion.Header>
            <Accordion.Trigger className="w-full group">
              <Flex 
                justify="between" 
                align="center" 
                className="w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 rounded-lg transition-colors"
              >
                <Flex align="center" gap="2">
                  <Settings className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <Text size="3" weight="bold">插件配置</Text>
                  <Badge size="1" color="gray" variant="soft">
                    {Object.keys(fields).length} 项
                  </Badge>
                </Flex>
                <ChevronDown 
                  className="w-5 h-5 text-gray-500 transition-transform duration-200 group-data-[state=open]:rotate-180" 
                />
              </Flex>
            </Accordion.Trigger>
          </Accordion.Header>
          
          <Accordion.Content className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
            <Box className="pt-2 pb-4">
              {/* 成功提示 */}
              {successMessage && (
                <div className="mb-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <Callout.Root color="green" size="1" className="shadow-sm">
                    <Callout.Icon><CheckCircle /></Callout.Icon>
                    <Callout.Text className="font-medium">{successMessage}</Callout.Text>
                  </Callout.Root>
                </div>
              )}

              {/* 错误提示 */}
              {error && (
                <div className="mb-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <Callout.Root color="red" size="1" className="shadow-sm">
                    <Callout.Icon><AlertCircle /></Callout.Icon>
                    <Callout.Text className="font-medium">{error}</Callout.Text>
                  </Callout.Root>
                </div>
              )}

              {/* 配置表单 */}
              <Flex direction="column" gap="3">
                {Object.entries(fields).map(([fieldName, field]) => {
                  const schemaField = field as SchemaField
                  return (
                    <div 
                      key={fieldName} 
                      className="group p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors border border-gray-200 dark:border-gray-800"
                    >
                      <Flex direction="column" gap="2">
                        <Flex align="center" gap="1">
                          <Text size="2" weight="bold" className="text-gray-900 dark:text-gray-100">
                            {schemaField.key || fieldName}
                          </Text>
                          {schemaField.required && (
                            <Text size="2" weight="bold" color="red" className="leading-none">
                              *
                            </Text>
                          )}
                        </Flex>
                        {schemaField.description && (
                          <Text size="1" color="gray" className="leading-relaxed">
                            {schemaField.description}
                          </Text>
                        )}
                        <div className="mt-1">
                          {renderField(schemaField.key || fieldName, schemaField)}
                        </div>
                      </Flex>
                    </div>
                  )
                })}
              </Flex>

              {/* 操作按钮 */}
              <Flex gap="2" justify="end" className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
                <Button 
                  size="2" 
                  variant="soft" 
                  onClick={() => setIsExpanded(undefined)} 
                  disabled={loading}
                  className="hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                  取消
                </Button>
                <Button 
                  size="2" 
                  onClick={handleSave} 
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white transition-colors shadow-sm"
                >
                  {loading ? (
                    <>
                      <Spinner />
                      <span>保存中...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>保存配置</span>
                    </>
                  )}
                </Button>
              </Flex>
            </Box>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </Card>
  )
}
