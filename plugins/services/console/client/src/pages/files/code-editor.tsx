import { useMemo, useCallback, useRef, type KeyboardEvent } from 'react'
import { editorFontStyle } from './editor-constants'
export function CodeEditor({
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
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
