import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'

export interface MessageSegment {
    type: 'text' | 'at' | 'face' | 'image' | 'video' | 'audio' | 'file'
    data: Record<string, any>
}

export interface RichTextEditorProps {
    placeholder?: string
    onSend?: (text: string, segments: MessageSegment[]) => void
    onChange?: (text: string, segments: MessageSegment[]) => void
    onAtTrigger?: (show: boolean, searchQuery: string, position?: { top: number; left: number }) => void
    minHeight?: string
    maxHeight?: string
}

export interface RichTextEditorRef {
    focus: () => void
    clear: () => void
    insertFace: (faceId: number) => void
    insertImage: (url: string) => void
    insertAt: (name: string, id?: string) => void
    replaceAtTrigger: (name: string, id?: string) => void
    getContent: () => { text: string; segments: MessageSegment[] }
}

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
    ({ placeholder = '输入消息...', onSend, onChange, onAtTrigger, minHeight = '44px', maxHeight = '200px' }, ref) => {
        const editorRef = useRef<HTMLDivElement>(null)
        const atTriggerTextRef = useRef<Text | null>(null)

        // 解析编辑器内容为文本和消息段
        const parseEditorContent = (): { text: string; segments: MessageSegment[] } => {
            if (!editorRef.current) return { text: '', segments: [] }

            let text = ''
            const segments: MessageSegment[] = []
            const nodes = editorRef.current.childNodes

            for (const node of nodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const textContent = node.textContent || ''
                    if (textContent) {
                        text += textContent
                        segments.push({ type: 'text', data: { text: textContent } })
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement

                    if (el.classList.contains('editor-face')) {
                        const faceId = el.dataset.id
                        text += `[face:${faceId}]`
                        segments.push({ type: 'face', data: { id: Number(faceId) } })
                    } else if (el.classList.contains('editor-image')) {
                        const imageUrl = el.dataset.url
                        text += `[image:${imageUrl}]`
                        segments.push({ type: 'image', data: { url: imageUrl } })
                    } else if (el.classList.contains('editor-at')) {
                        const name = el.dataset.name
                        const id = el.dataset.id
                        text += `[@${name}]`
                        segments.push({ type: 'at', data: { name, qq: id } })
                    } else if (el.tagName === 'BR') {
                        text += '\n'
                    }
                }
            }

            return { text, segments }
        }

        // 插入表情
        const insertFace = (faceId: number) => {
            if (!editorRef.current) return

            const img = document.createElement('img')
            img.src = `https://face.viki.moe/apng/${faceId}.png`
            img.alt = `[face:${faceId}]`
            img.dataset.type = 'face'
            img.dataset.id = String(faceId)
            img.className = 'editor-face'

            insertNodeAtCursor(img)
            handleChange()
        }

        // 插入图片
        const insertImage = (url: string) => {
            if (!editorRef.current || !url.trim()) return

            const img = document.createElement('img')
            img.src = url.trim()
            img.alt = `[image:${url.trim()}]`
            img.dataset.type = 'image'
            img.dataset.url = url.trim()
            img.className = 'editor-image'

            insertNodeAtCursor(img)
            handleChange()
        }

        // 插入 @ 提及
        const insertAt = (name: string, id?: string) => {
            if (!editorRef.current || !name.trim()) return

            // 创建 @ 标签容器
            const atBox = document.createElement('span')
            atBox.dataset.type = 'at'
            atBox.dataset.name = name
            if (id) atBox.dataset.id = id
            atBox.className = 'editor-at'
            atBox.contentEditable = 'false' // 不可编辑
            
            // 创建 @ 符号
            const atSymbol = document.createElement('span')
            atSymbol.textContent = '@'
            atSymbol.className = 'editor-at-symbol'
            
            // 创建名称
            const nameText = document.createElement('span')
            nameText.textContent = name
            nameText.className = 'editor-at-name'
            
            atBox.appendChild(atSymbol)
            atBox.appendChild(nameText)

            insertNodeAtCursor(atBox)
            handleChange()
        }

        // 在光标位置插入节点
        const insertNodeAtCursor = (node: Node) => {
            if (!editorRef.current) return

            // 先聚焦编辑器
            editorRef.current.focus()
            const selection = window.getSelection()
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0)

                // 检查光标是否在编辑器内部
                const isInsideEditor = editorRef.current.contains(range.commonAncestorContainer)

                if (isInsideEditor) {
                    // 光标在编辑器内，插入到光标位置
                    range.deleteContents()
                    range.insertNode(node)
                    range.collapse(false)
                    selection.removeAllRanges()
                    selection.addRange(range)
                } else {
                    // 光标不在编辑器内，追加到末尾
                    editorRef.current.appendChild(node)

                    // 移动光标到新插入的节点后面
                    const newRange = document.createRange()
                    newRange.setStartAfter(node)
                    newRange.collapse(true)
                    selection.removeAllRanges()
                    selection.addRange(newRange)
                }
            } else {
                // 没有选区，直接追加到末尾
                editorRef.current.appendChild(node)

                // 创建新选区并移动光标到末尾
                const selection = window.getSelection()
                if (selection) {
                    const newRange = document.createRange()
                    newRange.setStartAfter(node)
                    newRange.collapse(true)
                    selection.removeAllRanges()
                    selection.addRange(newRange)
                }
            }

        }

        // 清空编辑器
        const clear = () => {
            if (editorRef.current) {
                editorRef.current.innerHTML = ''
                handleChange()
            }
        }

        // 聚焦编辑器
        const focus = () => {
            editorRef.current?.focus()
        }

        // 获取内容
        const getContent = () => {
            return parseEditorContent()
        }

        // 检测 @ 输入
        const checkAtTrigger = () => {
            if (!editorRef.current || !onAtTrigger) return

            const selection = window.getSelection()
            if (!selection || selection.rangeCount === 0) {
                onAtTrigger(false, '')
                atTriggerTextRef.current = null
                return
            }

            const range = selection.getRangeAt(0)
            
            // 检查光标是否在编辑器内
            if (!editorRef.current.contains(range.commonAncestorContainer)) {
                onAtTrigger(false, '')
                atTriggerTextRef.current = null
                return
            }

            // 获取光标前的文本节点
            const node = range.startContainer
            if (node.nodeType !== Node.TEXT_NODE) {
                onAtTrigger(false, '')
                atTriggerTextRef.current = null
                return
            }

            const textNode = node as Text
            const textBeforeCursor = textNode.textContent?.substring(0, range.startOffset) || ''
            
            // 查找最近的 @ 符号位置
            const atIndex = textBeforeCursor.lastIndexOf('@')
            
            // 检查是否找到 @ 且后面没有空格（表示仍在输入 @提及）
            if (atIndex !== -1) {
                const textAfterAt = textBeforeCursor.substring(atIndex + 1)
                
                // 如果 @ 后面有空格，则不触发
                if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
                    onAtTrigger(false, '')
                    atTriggerTextRef.current = null
                    return
                }
                
                atTriggerTextRef.current = textNode
                
                // 计算 @ 位置
                const tempRange = document.createRange()
                tempRange.setStart(textNode, atIndex)
                tempRange.setEnd(textNode, atIndex + 1)
                const rect = tempRange.getBoundingClientRect()
                const editorRect = editorRef.current.getBoundingClientRect()
                
                // 传递搜索查询（@ 后面的文本）
                onAtTrigger(true, textAfterAt, {
                    top: rect.bottom - editorRect.top,
                    left: rect.left - editorRect.left
                })
            } else {
                onAtTrigger(false, '')
                atTriggerTextRef.current = null
            }
        }

        // 处理内容变化
        const handleChange = () => {
            checkAtTrigger()
            
            if (onChange) {
                const { text, segments } = parseEditorContent()
                onChange(text, segments)
            }
        }

        // 删除触发的 @ 符号和搜索文本并插入用户
        const replaceAtTrigger = (name: string, id?: string) => {
            if (!atTriggerTextRef.current) return

            const textNode = atTriggerTextRef.current
            const text = textNode.textContent || ''
            const atIndex = text.lastIndexOf('@')
            
            if (atIndex !== -1) {
                // 找到 @ 后面的内容（搜索文本）
                const textAfter = text.substring(atIndex + 1)
                const endIndex = atIndex + 1 + textAfter.split(/[\s\n]/)[0].length
                
                // 删除 @ 符号和搜索文本
                const beforeAt = text.substring(0, atIndex)
                const afterSearch = text.substring(endIndex)
                textNode.textContent = beforeAt + afterSearch
                
                // 移动光标到删除位置
                const selection = window.getSelection()
                if (selection) {
                    const range = document.createRange()
                    range.setStart(textNode, atIndex)
                    range.collapse(true)
                    selection.removeAllRanges()
                    selection.addRange(range)
                }
            }
            
            atTriggerTextRef.current = null
            insertAt(name, id)
        }

        // 处理键盘事件
        const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (onSend) {
                    const { text, segments } = parseEditorContent()
                    onSend(text, segments)
                }
            }
        }

        // 暴露方法给父组件
        useImperativeHandle(ref, () => ({
            focus,
            clear,
            insertFace,
            insertImage,
            insertAt,
            replaceAtTrigger,
            getContent
        }))

        return (
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleChange}
                onKeyDown={handleKeyDown}
                data-placeholder={placeholder}
                className="rich-text-editor"
                style={{
                    width: '100%',
                    minHeight,
                    maxHeight,
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--gray-6)',
                    borderRadius: '6px',
                    backgroundColor: 'var(--gray-1)',
                    fontSize: 'var(--font-size-2)',
                    outline: 'none',
                    overflowY: 'auto',
                    lineHeight: '1.5',
                    wordWrap: 'break-word',
                    color: 'var(--gray-12)'
                }}
            />
        )
    }
)

RichTextEditor.displayName = 'RichTextEditor'

export default RichTextEditor

