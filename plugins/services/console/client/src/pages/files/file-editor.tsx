import { useState, useEffect, useCallback } from 'react'
import { Save, Loader2, AlertCircle, CheckCircle, X } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { CodeEditor } from './code-editor'
import { getFileIcon } from './file-icons'
import { getLanguage } from './language'

export function FileEditor({
  filePath,
  readFile,
  saveFile,
  onClose,
}: {
  filePath: string
  readFile: (path: string) => Promise<string>
  saveFile: (path: string, content: string) => Promise<unknown>
  onClose: () => void
}) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadContent = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const text = await readFile(filePath)
      setContent(text)
      setOriginalContent(text)
    } catch (err) {
      setMessage({ type: 'error', text: `加载失败: ${err instanceof Error ? err.message : '未知错误'}` })
    } finally {
      setLoading(false)
    }
  }, [filePath, readFile])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      await saveFile(filePath, content)
      setOriginalContent(content)
      setMessage({ type: 'success', text: '已保存' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: `保存失败: ${err instanceof Error ? err.message : '未知错误'}` })
    } finally {
      setSaving(false)
    }
  }, [filePath, content, saveFile])

  const dirty = content !== originalContent

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && !saving) void handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dirty, saving, handleSave])

  const fileName = filePath.split('/').pop() || filePath

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          {getFileIcon(fileName)}
          <span className="text-sm font-medium">{filePath}</span>
          {dirty && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">未保存</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onClose} title="关闭">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'success'} className="mx-4 mt-2 py-2">
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 min-h-0">
        <CodeEditor
          value={content}
          onChange={setContent}
          language={getLanguage(fileName)}
        />
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !dirty}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>
        {dirty && (
          <Button variant="outline" size="sm" onClick={() => setContent(originalContent)}>
            撤销更改
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {content.split('\n').length} 行 · Ctrl+S 保存
        </span>
      </div>
    </div>
  )
}
