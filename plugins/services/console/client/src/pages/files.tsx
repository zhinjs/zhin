import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useFiles } from '@zhin.js/client'
import type { FileTreeNode } from '@zhin.js/client'
import {
  FolderOpen, File, ChevronRight, ChevronDown, Save, Loader2,
  RefreshCw, AlertCircle, CheckCircle, FileCode, X
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { ScrollArea } from '../components/ui/scroll-area'

// ── 文件图标 & 语言检测 ─────────────────────────────────────────────

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode className="w-4 h-4 text-blue-500" />
    case 'js':
    case 'jsx':
      return <FileCode className="w-4 h-4 text-yellow-500" />
    case 'json':
      return <File className="w-4 h-4 text-green-500" />
    case 'yml':
    case 'yaml':
      return <File className="w-4 h-4 text-red-400" />
    case 'md':
      return <File className="w-4 h-4 text-gray-400" />
    case 'env':
      return <File className="w-4 h-4 text-orange-500" />
    default:
      if (name.startsWith('.env')) return <File className="w-4 h-4 text-orange-500" />
      return <File className="w-4 h-4 text-muted-foreground" />
  }
}

// ── Highlight.js 集成 ───────────────────────────────────────────────

declare global {
  interface Window {
    hljs?: {
      highlight: (code: string, options: { language: string }) => { value: string }
      getLanguage: (name: string) => any
    }
  }
}

const HLJS_CDN = 'https://cdn.jsdelivr.net.cn/npm/@highlightjs/cdn-assets@11/styles'

function getLanguage(fileName: string): string | null {
  const name = fileName.split('/').pop()?.toLowerCase() || ''
  if (name === '.env' || name.startsWith('.env.')) return 'ini'
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript'
    case 'js': case 'jsx': return 'javascript'
    case 'css': return 'css'
    case 'scss': return 'scss'
    case 'less': return 'less'
    case 'json': return 'json'
    case 'yml': case 'yaml': return 'yaml'
    case 'md': return 'markdown'
    case 'xml': case 'html': return 'xml'
    case 'sh': case 'bash': return 'bash'
    default: return null
  }
}

function useHljsTheme() {
  useEffect(() => {
    const linkId = 'hljs-theme-css'
    let link = document.getElementById(linkId) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    const update = () => {
      const isDark = document.documentElement.classList.contains('dark')
      link!.href = `${HLJS_CDN}/${isDark ? 'github-dark' : 'github'}.min.css`
    }
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
}

const editorFontStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: '13px',
  lineHeight: '20px',
  tabSize: 2,
  whiteSpace: 'pre' as const,
}

function CodeEditor({
  value,
  onChange,
  language,
}: {
  value: string
  onChange: (v: string) => void
  language: string | null
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const highlighted = useMemo(() => {
    if (window.hljs && language && window.hljs.getLanguage(language)) {
      try {
        return window.hljs.highlight(value, { language }).value
      } catch { /* fallback */ }
    }
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }, [value, language])

  const handleScroll = useCallback(() => {
    if (preRef.current && textareaRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop
      preRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const ta = e.currentTarget
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const next = value.substring(0, start) + '  ' + value.substring(end)
        onChange(next)
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2
        })
      }
    },
    [value, onChange],
  )

  return (
    <div className="relative h-full w-full overflow-hidden">
      <pre
        ref={preRef}
        className="absolute inset-0 m-0 p-4 overflow-auto pointer-events-none"
        style={editorFontStyle}
        aria-hidden
      >
        <code
          className={language ? `hljs language-${language}` : ''}
          dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
          style={{ background: 'transparent', padding: 0, display: 'block' }}
        />
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        wrap="off"
        className="absolute inset-0 w-full h-full resize-none p-4 bg-transparent outline-none border-0"
        style={{
          ...editorFontStyle,
          color: 'transparent',
          caretColor: 'hsl(var(--foreground))',
          WebkitTextFillColor: 'transparent',
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  )
}

// ── 文件树节点组件 ──────────────────────────────────────────────────

function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: FileTreeNode
  selectedPath: string | null
  onSelect: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isSelected = node.path === selectedPath
  const isDir = node.type === 'directory'

  return (
    <div>
      <button
        className={`
          w-full flex items-center gap-1.5 px-2 py-1 text-sm rounded-sm text-left
          hover:bg-accent transition-colors
          ${isSelected ? 'bg-accent text-accent-foreground font-medium' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) {
            setExpanded(!expanded)
          } else {
            onSelect(node.path)
          }
        }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        {isDir ? (
          <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" />
        ) : (
          getFileIcon(node.name)
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 文件编辑器组件 ──────────────────────────────────────────────────

function FileEditor({
  filePath,
  readFile,
  saveFile,
  onClose,
}: {
  filePath: string
  readFile: (path: string) => Promise<string>
  saveFile: (path: string, content: string) => Promise<any>
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

  const handleSave = async () => {
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
  }

  // Ctrl+S / Cmd+S 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && !saving) handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const dirty = content !== originalContent
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
      {/* 标题栏 */}
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

      {/* 消息提示 */}
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'success'} className="mx-4 mt-2 py-2">
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* 编辑区 */}
      <div className="flex-1 min-h-0">
        <CodeEditor
          value={content}
          onChange={setContent}
          language={getLanguage(fileName)}
        />
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
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

// ── 主页面组件 ──────────────────────────────────────────────────────

export default function FileMangePage() {
  useHljsTheme()
  const { tree, loading, error, loadTree, readFile, saveFile } = useFiles()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">文件管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            浏览和编辑工作空间中的配置文件和源代码
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadTree()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 主体区域：左侧文件树 + 右侧编辑器 */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex" style={{ height: '600px' }}>
            {/* 文件树 */}
            <div className="w-64 border-r flex flex-col shrink-0">
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">文件浏览器</span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && tree.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : tree.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">暂无文件</p>
                  ) : (
                    tree.map((node) => (
                      <TreeNode
                        key={node.path}
                        node={node}
                        selectedPath={selectedFile}
                        onSelect={setSelectedFile}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* 编辑器 */}
            <div className="flex-1 min-w-0">
              {selectedFile ? (
                <FileEditor
                  key={selectedFile}
                  filePath={selectedFile}
                  readFile={readFile}
                  saveFile={saveFile}
                  onClose={() => setSelectedFile(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">在左侧选择一个文件开始编辑</p>
                    <p className="text-xs mt-1 opacity-60">支持 .env、src/、package.json 等关键文件</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
