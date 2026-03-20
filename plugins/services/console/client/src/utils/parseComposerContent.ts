/** 与机器人消息段结构一致，供解析/规范化使用 */
export type MessageContent = Array<{ type: string; data?: Record<string, unknown> }>

/**
 * 解析输入框文本为消息段（与沙盒约定一致）。
 * 支持 [@名称]、[face:id]、[image:url]、[video:url]、[audio:url]
 */
export function parseComposerToSegments(text: string): MessageContent {
  const segments: MessageContent = []
  const regex =
    /\[@([^\]]+)\]|\[face:(\d+)\]|\[image:([^\]]+)\]|\[video:([^\]]+)\]|\[audio:([^\]]+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const t = text.substring(lastIndex, match.index)
      if (t) segments.push({ type: 'text', data: { text: t } })
    }
    if (match[1]) segments.push({ type: 'at', data: { qq: match[1], name: match[1] } })
    else if (match[2]) segments.push({ type: 'face', data: { id: parseInt(match[2], 10) } })
    else if (match[3]) segments.push({ type: 'image', data: { url: match[3] } })
    else if (match[4]) segments.push({ type: 'video', data: { url: match[4] } })
    else if (match[5]) segments.push({ type: 'audio', data: { url: match[5] } })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    const r = text.substring(lastIndex)
    if (r) segments.push({ type: 'text', data: { text: r } })
  }
  return segments.length > 0 ? segments : [{ type: 'text', data: { text } }]
}

export function hasRenderableComposerSegments(segments: MessageContent): boolean {
  if (!segments.length) return false
  return segments.some((s) => {
    if (s.type === 'text') return Boolean(String(s.data?.text ?? '').trim())
    return true
  })
}

/** 统一 WS 推送 / 收件箱里的 content（数组、JSON 字符串、纯文本） */
export function normalizeInboundContent(raw: unknown): MessageContent {
  if (Array.isArray(raw)) {
    return raw as MessageContent
  }
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) return p as MessageContent
    } catch {
      /* 非 JSON */
    }
    return [{ type: 'text', data: { text: raw } }]
  }
  return []
}
