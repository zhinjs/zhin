/** 用于 img / video / audio 的 src 解析时的媒体类别 */
export type MediaKind = 'image' | 'video' | 'audio'

const BASE64_PROTO = 'base64://'

/**
 * 将消息段中的 url/file 等转为浏览器可用的媒体地址。
 *
 * 支持：
 * - `http(s)://`、`blob:`、`data:` → 原样返回
 * - `base64://<纯 base64>` → `data:{默认MIME};base64,<payload>`（默认按 kind：图 png / 视频 mp4 / 音频 mpeg）
 * - `base64://image/png;base64,xxxx` → `data:image/png;base64,xxxx`
 *
 * 与群内日报、html-test 等插件生成的 `base64://${buffer.toString('base64')}` 一致。
 */
export function resolveMediaSrc(
  raw: string | undefined | null,
  kind: MediaKind = 'image',
): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined
  const s = raw.trim()
  if (!s) return undefined

  if (s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('http://') || s.startsWith('https://')) {
    return s
  }

  if (!s.startsWith(BASE64_PROTO)) {
    return s
  }

  const payload = s.slice(BASE64_PROTO.length).replace(/^\s+/, '')
  if (!payload) return undefined

  // 已是 type/subtype;base64, 片段（不含 data: 前缀）
  if (/^[\w+.-]+\/[\w+.-]+;base64,/i.test(payload)) {
    return `data:${payload}`
  }

  const defaultMime =
    kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg'
  const b64 = payload.replace(/\s/g, '')
  return `data:${defaultMime};base64,${b64}`
}

/** 从 segment.data 取常见媒体字段 */
export function pickMediaRawUrl(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined
  const v = data.url ?? data.file ?? data.src ?? data.href
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
