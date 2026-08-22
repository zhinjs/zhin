/** 用于 img / video / audio 的 src 解析时的媒体类别 */
export type MediaKind = 'image' | 'video' | 'audio'

const BASE64_PROTO = 'base64://'

const SAFE_DATA_MIME: Readonly<Record<MediaKind, ReadonlySet<string>>> = Object.freeze({
  image: new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/ogg', 'video/webm']),
  audio: new Set(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm']),
})

function resolveSafeRemoteUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'blob:') {
      return undefined
    }
    if (parsed.username || parsed.password) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

function resolveSafeDataUrl(value: string, kind: MediaKind): string | undefined {
  if (!value.startsWith('data:')) return undefined
  const separator = value.indexOf(',')
  if (separator < 0) return undefined
  const header = value.slice('data:'.length, separator).toLowerCase()
  if (!header.endsWith(';base64')) return undefined
  const mime = header.slice(0, -';base64'.length)
  if (!SAFE_DATA_MIME[kind].has(mime)) return undefined
  const payload = compactBase64(value.slice(separator + 1))
  return payload ? `data:${mime};base64,${payload}` : undefined
}

function compactBase64(value: string): string | undefined {
  let compact = ''
  for (const character of value) {
    if (character === ' ' || character === '\n' || character === '\r' || character === '\t') continue
    const code = character.charCodeAt(0)
    const allowed = (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || character === '+' || character === '/' || character === '='
    if (!allowed) return undefined
    compact += character
  }
  const padding = compact.indexOf('=')
  if (padding >= 0 && (compact.length - padding > 2 || compact.slice(padding).replace(/=/g, '') !== '')) {
    return undefined
  }
  return compact || undefined
}

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

  const dataUrl = resolveSafeDataUrl(s, kind)
  if (dataUrl) return dataUrl

  const remoteUrl = resolveSafeRemoteUrl(s)
  if (remoteUrl) return remoteUrl

  if (!s.startsWith(BASE64_PROTO)) {
    return undefined
  }

  const payload = s.slice(BASE64_PROTO.length).trimStart()
  if (!payload) return undefined

  // 已是 type/subtype;base64, 片段（不含 data: 前缀）
  const declared = resolveSafeDataUrl(`data:${payload}`, kind)
  if (declared) {
    return declared
  }

  const defaultMime =
    kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg'
  const b64 = compactBase64(payload)
  return b64 ? `data:${defaultMime};base64,${b64}` : undefined
}

/** 从 segment.data 取常见媒体字段（优先 canonical MediaRef） */
export function pickMediaRawUrl(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined
  const media = data.media
  if (media && typeof media === 'object' && media !== null) {
    const value = (media as { value?: unknown }).value
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const v = data.url ?? data.file ?? data.src ?? data.href
  if (typeof v === 'string' && v.trim()) return v.trim()
  // agent 出站媒体段（media-publisher）直接携带纯 base64，无 url/file；
  // 有 mime 时拼成 data: URL 透传，否则走 base64:// 让 resolveMediaSrc 按 kind 补默认 MIME
  const b64 = data.base64
  if (typeof b64 === 'string' && b64.trim()) {
    const payload = b64.trim()
    if (payload.startsWith('data:') || payload.startsWith('base64://')
      || payload.startsWith('http://') || payload.startsWith('https://')) {
      return payload
    }
    const mime = typeof data.mime === 'string' && data.mime.trim() ? data.mime.trim() : ''
    return mime
      ? `data:${mime};base64,${payload.replace(/\s/g, '')}`
      : `base64://${payload}`
  }
  return undefined
}
