import { useState, useEffect, useCallback } from 'react'
import { useEnvFiles } from '@zhin.js/client'
import {
  KeyRound, AlertCircle, CheckCircle, Save, Loader2,
  RefreshCw, FileWarning, Eye, EyeOff
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'

const SENSITIVE_PATTERN = /^(.*(?:PASSWORD|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL).*?=\s*)(.+)$/gim

function maskSensitiveValues(content: string): string {
  return content.replace(SENSITIVE_PATTERN, (_match, prefix, value) => {
    if (value.startsWith('${') || value.trim() === '') return prefix + value
    const visible = value.length > 4 ? value.slice(0, 2) : ''
    return prefix + visible + '●'.repeat(Math.min(value.length - visible.length, 20))
  })
}

function EnvFileEditor({
  filename,
  getFile,
  saveFile,
  exists,
}: {
  filename: string
  getFile: (f: string) => Promise<string>
  saveFile: (f: string, c: string) => Promise<any>
  exists: boolean
}) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [masked, setMasked] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  const loadContent = useCallback(async () => {
    setLoading(true)
    try {
      const text = await getFile(filename)
      setContent(text)
      setOriginalContent(text)
      setLoaded(true)
    } catch (err) {
      setMessage({ type: 'error', text: `加载失败: ${err instanceof Error ? err.message : '未知错误'}` })
    } finally {
      setLoading(false)
    }
  }, [filename, getFile])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await saveFile(filename, content)
      setOriginalContent(content)
      setMessage({ type: 'success', text: '已保存，需重启生效' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: `保存失败: ${err instanceof Error ? err.message : '未知错误'}` })
    } finally {
      setSaving(false)
    }
  }

  const dirty = content !== originalContent

  const displayContent = masked && !dirty ? maskSensitiveValues(content) : content

  if (loading && !loaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!exists && !dirty && (
        <Alert className="py-2 border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
          <FileWarning className="h-4 w-4" />
          <AlertDescription>文件不存在，保存后将自动创建</AlertDescription>
        </Alert>
      )}

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'success'} className="py-2">
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="relative">
        <Textarea
          value={displayContent}
          onChange={e => { setContent(e.target.value); setMasked(false) }}
          onFocus={() => setMasked(false)}
          className="font-mono text-sm min-h-[350px] resize-y"
          placeholder="KEY=VALUE"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>
        {dirty && (
          <Button variant="outline" size="sm" onClick={() => { setContent(originalContent); setMasked(true) }}>
            撤销
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMasked(prev => !prev)}
          disabled={dirty}
          title={masked ? '显示敏感值' : '隐藏敏感值'}
        >
          {masked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">有未保存的更改</span>}
      </div>
    </div>
  )
}

export default function EnvManagePage() {
  const { files, loading, error, listFiles, getFile, saveFile } = useEnvFiles()
  const [activeTab, setActiveTab] = useState('.env')

  const handleRefresh = async () => {
    try {
      await listFiles()
    } catch {
      // hook will set error state
    }
  }

  if (loading && files.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="环境变量" description="加载文件列表…" />
        <div className="flex items-center justify-center py-12 rounded-lg border border-dashed">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="环境变量"
        description="管理 .env / .env.* 中的键值；含 PASSWORD、TOKEN、SECRET 等关键字的行可在未编辑时自动遮罩显示。保存后需重启进程生效。"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-muted/40 p-1">
          {['.env', '.env.development', '.env.production'].map(name => {
            const fileInfo = files.find(f => f.name === name)
            return (
              <TabsTrigger key={name} value={name} className="gap-1.5 data-[state=active]:shadow-sm">
                <KeyRound className="w-3.5 h-3.5" />
                {name}
                {fileInfo && !fileInfo.exists && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">新</Badge>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {['.env', '.env.development', '.env.production'].map(name => (
          <TabsContent key={name} value={name} className="mt-0">
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">{name}</CardTitle>
                <CardDescription>
                  键值对一行一条，格式 <code className="rounded bg-muted px-1 py-0.5 text-xs">KEY=VALUE</code>
                  ；编辑时始终显示真实内容，保存前请确认环境安全。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EnvFileEditor
                  filename={name}
                  getFile={getFile}
                  saveFile={saveFile}
                  exists={files.find(f => f.name === name)?.exists ?? false}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
