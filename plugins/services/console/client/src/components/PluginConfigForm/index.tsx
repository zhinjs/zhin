/**
 * PluginConfigForm - Plugin configuration form with accordion
 */

import { useState, useEffect } from 'react'
import { useConfig } from '@zhin.js/client'
import type { PluginConfigFormProps, SchemaField } from './types.js'
import { Settings, ChevronDown, CheckCircle, AlertCircle, X, Save, Loader2 } from 'lucide-react'
import { FieldRenderer, isComplexField } from './FieldRenderer.js'
import { NestedFieldRenderer } from './NestedFieldRenderer.js'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion'

export function PluginConfigForm({ pluginName, onSuccess }: Omit<PluginConfigFormProps, 'schema' | 'initialConfig'>) {
  const [localConfig, setLocalConfig] = useState<Record<string, any>>({})
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState<string | undefined>(undefined)

  const { config, schema, loading, error, connected, setConfig } = useConfig(pluginName)

  useEffect(() => {
    if (config) setLocalConfig(config)
  }, [config])

  const handleSave = async () => {
    if (!connected) return
    try {
      await setConfig(localConfig)
      setSuccessMessage('配置已保存成功')
      setTimeout(() => { setIsExpanded(undefined); onSuccess?.(); setSuccessMessage(null) }, 1500)
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
      [parentPath]: { ...(prev[parentPath] || {}), [childKey]: value }
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
    const value = parentPath
      ? localConfig[parentPath]?.[fieldName] ?? field.default
      : localConfig[fieldName] ?? field.default

    const onChange = parentPath
      ? (val: any) => handleNestedFieldChange(parentPath, fieldName, val)
      : (val: any) => handleFieldChange(fieldName, val)

    return (
      <FieldRenderer
        fieldName={fieldName} field={field} value={value} onChange={onChange}
        parentPath={parentPath} onNestedChange={handleNestedFieldChange}
        onArrayItemChange={handleArrayItemChange} renderField={renderField}
        renderNestedField={(fn, f, v, oc) => <NestedFieldRenderer fieldName={fn} field={f} value={v} onChange={oc} />}
      />
    )
  }

  const fields = schema?.properties || schema?.dict || {}
  if (!schema || !fields || Object.keys(fields).length === 0) return null

  return (
    <Card className="mt-4">
      <Accordion type="single" collapsible value={isExpanded} onValueChange={setIsExpanded}>
        <AccordionItem value="config" className="border-none">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span className="font-semibold">插件配置</span>
              <Badge variant="secondary">{Object.keys(fields).length} 项</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {successMessage && (
              <Alert variant="success" className="mb-3">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              {Object.entries(fields).map(([fieldName, field]) => {
                const schemaField = field as SchemaField
                return (
                  <div key={fieldName} className="p-3 rounded-lg bg-muted/50 border space-y-2">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold">{schemaField.key || fieldName}</span>
                      {schemaField.required && <span className="text-destructive font-bold">*</span>}
                    </div>
                    {schemaField.description && (
                      <p className="text-xs text-muted-foreground">{schemaField.description}</p>
                    )}
                    <div className="mt-1">{renderField(schemaField.key || fieldName, schemaField)}</div>
                  </div>
                )
              })}
            </div>

            <div className="flex gap-2 justify-end mt-4 pt-3 border-t">
              <Button variant="outline" size="sm" onClick={() => setIsExpanded(undefined)} disabled={loading}>
                <X className="w-4 h-4 mr-1" /> 取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</> : <><Save className="w-4 h-4 mr-1" />保存配置</>}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  )
}
