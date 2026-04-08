import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addCommand, addTool, logger } = usePlugin()

// ── helpers ──────────────────────────────────────────────

function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

async function shortenUrl(url: string): Promise<string> {
  const api = `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`
  const res = await fetch(api)
  if (!res.ok) throw new Error(`is.gd 返回 ${res.status}`)
  const data = (await res.json()) as { shorturl?: string; errorcode?: number; errormessage?: string }
  if (data.errorcode) throw new Error(data.errormessage ?? '缩短失败')
  return data.shorturl!
}

async function expandUrl(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (location) return location
  if (res.ok) return url
  throw new Error(`无法展开链接 (${res.status})`)
}

// ── commands ─────────────────────────────────────────────

addCommand(
  new MessageCommand('短链 <url:text>')
    .desc('缩短一个 URL')
    .action(async (_message, result) => {
      const url = result.params.url as string
      if (!isValidUrl(url)) return '请提供有效的 HTTP/HTTPS 链接'
      try {
        const short = await shortenUrl(url)
        return `短链接: ${short}`
      } catch (e: any) {
        logger.warn('短链生成失败', e)
        return `缩短失败: ${e.message}`
      }
    }),
)

addCommand(
  new MessageCommand('展开 <url:text>')
    .desc('展开一个短链接，显示原始地址')
    .action(async (_message, result) => {
      const url = result.params.url as string
      if (!isValidUrl(url)) return '请提供有效的 HTTP/HTTPS 链接'
      try {
        const original = await expandUrl(url)
        return `原始链接: ${original}`
      } catch (e: any) {
        logger.warn('链接展开失败', e)
        return `展开失败: ${e.message}`
      }
    }),
)

// ── AI tool ──────────────────────────────────────────────

addTool(
  new ZhinTool('short_url')
    .desc('缩短一个 URL，返回短链接')
    .keyword('短链', '缩短', 'shorten', 'short url')
    .param('url', { type: 'string', description: '要缩短的完整 URL' }, true)
    .execute(async (args) => {
      const url = args.url as string
      if (!isValidUrl(url)) return '无效的 URL，需要 http:// 或 https:// 开头'
      try {
        return await shortenUrl(url)
      } catch (e: any) {
        return `缩短失败: ${e.message}`
      }
    })
    .toTool(),
)
