import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConfigYaml } from '@zhin.js/client'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  Settings, AlertCircle, CheckCircle, Save, Loader2, X,
  RefreshCw, FileCode, FormInput
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { Separator } from '../components/ui/separator'

function GeneralConfigForm({
  config,
  pluginKeys,
  onSave,
  saving
}: {
  config: Record<string, any>
  pluginKeys: string[]
  onSave: (patch: Record<string, any>) => Promise<void>
  saving: boolean
}) {
  const generalKeys = useMemo(() => {
    const excludeSet = new Set(pluginKeys)
    excludeSet.add('plugins')
    return Object.keys(config).filter(k => !excludeSet.has(k))
  }, [config, pluginKeys])

  const [localValues, setLocalValues] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setDirty(false)
  }, [config, generalKeys])

  const handleChange = (key: string, value: any) => {
    setLocalValues(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    await onSave(localValues)
    setDirty(false)
  }

  const handleReset = () => {
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setDirty(false)
  }

  if (generalKeys.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
            <Settings className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">暂无通用配置</h3>
          <p className="text-sm text-muted-foreground">配置文件中未发现可编辑的通用字段</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {generalKeys.map(key => (
          <ConfigFieldEditor
            key={key}
            fieldKey={key}
            value={localValues[key]}
            onChange={val => handleChange(key, val)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>
        {dirty && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <X className="w-4 h-4 mr-1" />撤销
          </Button>
        )}
        {dirty && <span className="text-xs text-muted-foreground">有未保存的更改</span>}
      </div>
    </div>
  )
}

function ConfigFieldEditor({
  fieldKey,
  value,
  onChange
}: {
  fieldKey: string
  value: any
  onChange: (val: any) => void
}) {
  const valueType = typeof value

  if (value === null || value === undefined) {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">null</Badge>
        </div>
        <Input
          value=""
          placeholder="(空值)"
          onChange={e => onChange(e.target.value || null)}
          className="h-8 text-sm"
        />
      </div>
    )
  }

  if (valueType === 'boolean') {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{fieldKey}</span>
            <Badge variant="outline" className="text-[10px] px-1 py-0">boolean</Badge>
          </div>
          <button
            type="button"
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                value ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    )
  }

  if (valueType === 'number') {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">number</Badge>
        </div>
        <Input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="h-8 text-sm"
        />
      </div>
    )
  }

  if (valueType === 'string') {
    const isMultiline = value.includes('\n') || value.length > 80
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">string</Badge>
        </div>
        {isMultiline ? (
          <Textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            className="text-sm font-mono min-h-[80px]"
          />
        ) : (
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            className="h-8 text-sm"
          />
        )}
      </div>
    )
  }

  if (Array.isArray(value)) {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">array[{value.length}]</Badge>
        </div>
        <Textarea
          value={stringifyYaml(value).trim()}
          onChange={e => {
            try {
              const parsed = parseYaml(e.target.value)
              if (Array.isArray(parsed)) onChange(parsed)
            } catch { /* ignore parse errors during typing */ }
          }}
          className="text-sm font-mono min-h-[80px]"
        />
      </div>
    )
  }

  if (valueType === 'object') {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">object</Badge>
        </div>
        <Textarea
          value={stringifyYaml(value).trim()}
          onChange={e => {
            try {
              const parsed = parseYaml(e.target.value)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onChange(parsed)
            } catch { /* ignore parse errors during typing */ }
          }}
          className="text-sm font-mono min-h-[100px]"
        />
      </div>
    )
  }

  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{fieldKey}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0">{valueType}</Badge>
      </div>
      <Input
        value={String(value)}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-sm"
      />
    </div>
  )
}

export default function DashboardConfig() {
  const { yaml, pluginKeys, loading, error, load, save } = useConfigYaml()
  const [mode, setMode] = useState<'form' | 'yaml'>('form')
  const [yamlText, setYamlText] = useState('')
  const [yamlDirty, setYamlDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (yaml) {
      setYamlText(yaml)
      setYamlDirty(false)
    }
  }, [yaml])

  const parsedConfig = useMemo(() => {
    try {
      return parseYaml(yaml) || {}
    } catch {
      return {}
    }
  }, [yaml])

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleYamlSave = async () => {
    setSaving(true)
    try {
      await save(yamlText)
      setYamlDirty(false)
      showMessage('success', '配置已保存，需重启生效')
    } catch (err) {
      showMessage('error', `保存失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleFormSave = async (patch: Record<string, any>) => {
    setSaving(true)
    try {
      const currentParsed = parseYaml(yaml) || {}
      const merged = { ...currentParsed, ...patch }
      const newYaml = stringifyYaml(merged, { lineWidth: 0 })
      await save(newYaml)
      showMessage('success', '配置已保存，需重启生效')
    } catch (err) {
      showMessage('error', `保存失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleRefresh = async () => {
    try {
      await load()
      showMessage('success', '已刷新')
    } catch {
      showMessage('error', '刷新失败')
    }
  }

  if (loading && !yaml) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">配置管理</h1>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">加载配置中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">配置管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理 zhin.config.yml 中的通用配置项（不含插件配置）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'success'} className="py-2">
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {error && !message && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={mode} onValueChange={v => setMode(v as 'form' | 'yaml')}>
        <TabsList>
          <TabsTrigger value="form" className="gap-1.5">
            <FormInput className="w-4 h-4" />
            表单模式
          </TabsTrigger>
          <TabsTrigger value="yaml" className="gap-1.5">
            <FileCode className="w-4 h-4" />
            YAML 模式
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <GeneralConfigForm
            config={parsedConfig}
            pluginKeys={pluginKeys}
            onSave={handleFormSave}
            saving={saving}
          />
        </TabsContent>

        <TabsContent value="yaml">
          <div className="space-y-3">
            <div className="relative">
              <Textarea
                value={yamlText}
                onChange={e => { setYamlText(e.target.value); setYamlDirty(true) }}
                className="font-mono text-sm min-h-[400px] resize-y"
                placeholder="# zhin.config.yml"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleYamlSave} disabled={saving || !yamlDirty}>
                {saving
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
                  : <><Save className="w-4 h-4 mr-1" />保存</>}
              </Button>
              {yamlDirty && (
                <Button variant="outline" size="sm" onClick={() => { setYamlText(yaml); setYamlDirty(false) }}>
                  <X className="w-4 h-4 mr-1" />撤销
                </Button>
              )}
              {yamlDirty && <span className="text-xs text-muted-foreground">有未保存的更改</span>}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
