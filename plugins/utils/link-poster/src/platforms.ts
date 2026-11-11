import type { LinkMeta } from './types.js'
import { resolveLocale, type Locale } from 'zhin.js/i18n'
import { messages as t } from './i18n.js'
import { fetchPublic, readCappedBody } from './public-fetch.js'

// ── 工具函数 ──────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT = 10_000

/** Upper bound for a cover/avatar image; larger bodies are dropped instead of buffered. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Upper bound for a platform page or API response. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024

/** Read a text body under the page cap; an oversized body is cancelled and reported as an error. */
async function readText(res: Response): Promise<string> {
  const body = await readCappedBody(res, MAX_PAGE_BYTES)
  if (!body) throw new Error('link-poster: response body is too large')
  return body.toString('utf8')
}

/**
 * Fetch with redirects followed by hand. Every hop must pass `isAllowed` (the platform host
 * allow-list, or the structural image rule) AND resolve to public addresses only, so neither an
 * allowed short link nor a public CDN name pointing at a private address can reach an internal
 * host. One timeout bounds all hops and the body.
 */
async function fetchWithTimeout(
  url: string,
  init?: Omit<RequestInit, 'redirect' | 'signal'>,
  isAllowed: (url: string) => boolean = isSupportedLinkHost,
): Promise<Response> {
  const { response } = await fetchPublic(url, {
    timeoutMs: FETCH_TIMEOUT,
    init,
    allow: (hop) => isAllowed(hop.href),
  })
  return response
}

/**
 * Cover/avatar URLs come from third-party page metadata and live on CDN hosts that cannot be
 * enumerated, so they are checked structurally: https only, a real DNS name (no IP literal,
 * no single-label or internal-suffix host). The resolved addresses are checked separately by
 * `fetchPublic` on every hop.
 */
export function isPublicImageUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname.startsWith('[') || /^[\d.]+$/.test(hostname) || !hostname.includes('.')) return false
  return !/(?:^|\.)(?:localhost|local|internal|lan|home|corp|intranet)$/.test(hostname)
}

/** 将远程图片下载并转为 data URI，避免渲染时遇到防盗链/CORS */
async function imageToDataUri(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  try {
    if (url.startsWith('//')) url = 'https:' + url
    if (url.startsWith('http:')) url = url.replace('http:', 'https:')
    const res = await fetchWithTimeout(url, {
      headers: { Referer: new URL(url).origin, 'User-Agent': 'Mozilla/5.0' },
    }, isPublicImageUrl)
    if (!res.ok) return undefined
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0]!.trim()
    // The value is interpolated into a data URI inside rendered HTML: accept plain image types only.
    if (!/^image\/[\w.+-]+$/i.test(mime)) {
      await res.body?.cancel()
      return undefined
    }
    const buf = await readCappedBody(res, MAX_IMAGE_BYTES)
    if (!buf) return undefined
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

function formatNumber(n: number | undefined, locale?: Locale): string {
  if (n == null) return '-'
  if (resolveLocale(locale) === 'en') return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '亿'
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '万'
  return String(n)
}

function extractMeta(html: string, property: string): string | undefined {
  // 匹配 <meta property="og:title" content="..."> 或 <meta name="..." content="...">
  const re = new RegExp(
    `<meta\\s+(?:property|name)=["']${property}["']\\s+content=["']([^"']*?)["']`,
    'i',
  )
  const m = html.match(re)
  if (m) return m[1]
  // 反转属性顺序：content 在前
  const re2 = new RegExp(
    `<meta\\s+content=["']([^"']*?)["']\\s+(?:property|name)=["']${property}["']`,
    'i',
  )
  return html.match(re2)?.[1]
}

// ── Bilibili ──────────────────────────────────────────────────────────────────

const BILIBILI_RE = /(?:bilibili\.com\/video\/|b23\.tv\/)/i

async function parseBilibili(url: string, locale?: Locale): Promise<LinkMeta | null> {
  // 短链跳转
  if (url.includes('b23.tv')) {
    const res = await fetchWithTimeout(url)
    url = res.url
  }
  const bvMatch = url.match(/BV[\w]+/)
  if (!bvMatch) return null

  const api = `https://api.bilibili.com/x/web-interface/view?bvid=${bvMatch[0]}`
  const res = await fetchWithTimeout(api, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
  })
  const json = JSON.parse(await readText(res)) as any
  if (json.code !== 0) return null

  const d = json.data
  return {
    platform: 'bilibili',
    title: d.title,
    description: d.desc || undefined,
    author: d.owner?.name,
    authorAvatar: await imageToDataUri(d.owner?.face),
    cover: await imageToDataUri(d.pic),
    url: `https://www.bilibili.com/video/${bvMatch[0]}`,
    stats: {
      [t(locale, 'views')]: formatNumber(d.stat?.view, locale),
      [t(locale, 'danmaku')]: formatNumber(d.stat?.danmaku, locale),
      [t(locale, 'likes')]: formatNumber(d.stat?.like, locale),
    },
  }
}

// ── GitHub ────────────────────────────────────────────────────────────────────

const GITHUB_RE = /github\.com\/([\w.-]+)\/([\w.-]+)/i

async function parseGithub(url: string, locale?: Locale): Promise<LinkMeta | null> {
  const repoMatch = url.match(GITHUB_RE)
  if (!repoMatch) return null
  const [, owner, repo] = repoMatch
  const headers = { 'User-Agent': 'zhin-bot', Accept: 'application/vnd.github+json' }

  // Issue 或 PR
  const issueMatch = url.match(/\/(issues|pull)\/(\d+)/)
  if (issueMatch) {
    const [, type, num] = issueMatch
    const apiType = type === 'pull' ? 'pulls' : 'issues'
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/${apiType}/${num}`,
      { headers },
    )
    if (!res.ok) return null
    const d = JSON.parse(await readText(res)) as any
    return {
      platform: 'github',
      title: `${type === 'pull' ? 'PR' : 'Issue'} #${num}: ${d.title}`,
      description: d.body?.slice(0, 200) || undefined,
      author: d.user?.login,
      authorAvatar: await imageToDataUri(d.user?.avatar_url),
      url,
      stats: {
        [t(locale, 'status')]: d.state === 'open' ? '🟢 Open' : '🟣 Closed',
        [t(locale, 'comments')]: String(d.comments ?? 0),
      },
    }
  }

  // 仓库
  const res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!res.ok) return null
  const d = JSON.parse(await readText(res)) as any
  return {
    platform: 'github',
    title: d.full_name || `${owner}/${repo}`,
    description: d.description || undefined,
    author: d.owner?.login,
    authorAvatar: await imageToDataUri(d.owner?.avatar_url),
    cover: await imageToDataUri(`https://opengraph.githubassets.com/1/${owner}/${repo}`),
    url,
    stats: {
      'Star': formatNumber(d.stargazers_count, locale),
      'Fork': formatNumber(d.forks_count, locale),
      [t(locale, 'language')]: d.language || '-',
    },
  }
}

// ── 抖音 ──────────────────────────────────────────────────────────────────────

const DOUYIN_RE = /(?:douyin\.com\/video\/|v\.douyin\.com\/)/i

async function parseDouyin(url: string, locale?: Locale): Promise<LinkMeta | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      },
    })
    const html = await readText(res)
    const title = extractMeta(html, 'og:title')
    if (!title) return null

    return {
      platform: 'douyin',
      title,
      description: extractMeta(html, 'og:description'),
      cover: await imageToDataUri(extractMeta(html, 'og:image')),
      url: res.url || url,
      author: extractMeta(html, 'og:site_name') || t(locale, 'douyin'),
    }
  } catch {
    return null
  }
}

// ── 小红书 ────────────────────────────────────────────────────────────────────

const XIAOHONGSHU_RE = /(?:xiaohongshu\.com\/(?:explore|discovery)|xhslink\.com\/)/i

async function parseXiaohongshu(url: string, locale?: Locale): Promise<LinkMeta | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      },
    })
    const html = await readText(res)
    const title = extractMeta(html, 'og:title')
    if (!title) return null

    return {
      platform: 'xiaohongshu',
      title,
      description: extractMeta(html, 'og:description'),
      cover: await imageToDataUri(extractMeta(html, 'og:image')),
      url: res.url || url,
      author: extractMeta(html, 'author') || extractMeta(html, 'og:site_name') || t(locale, 'xiaohongshu'),
    }
  } catch {
    return null
  }
}

// ── 统一检测 ──────────────────────────────────────────────────────────────────

interface PlatformParser {
  test: RegExp
  parse: (url: string, locale?: Locale) => Promise<LinkMeta | null>
}

/**
 * Hosts this plugin is allowed to fetch. The platform regexes match anywhere in the URL, so
 * without a hostname check `http://10.0.0.5/x?v.douyin.com/` would be fetched server-side
 * for any chat user (SSRF).
 */
const SUPPORTED_HOSTS = [
  'bilibili.com', 'b23.tv', 'github.com', 'douyin.com', 'xiaohongshu.com', 'xhslink.com',
] as const

export function isSupportedLinkHost(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  return SUPPORTED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

const PARSERS: PlatformParser[] = [
  { test: BILIBILI_RE, parse: parseBilibili },
  { test: GITHUB_RE, parse: parseGithub },
  { test: DOUYIN_RE, parse: parseDouyin },
  { test: XIAOHONGSHU_RE, parse: parseXiaohongshu },
]

/**
 * 从消息文本中检测第一个匹配的平台链接并解析元数据。
 * 仅返回第一个命中结果，避免单条消息产生过多海报。
 */
export async function detectAndParse(text: string, locale?: Locale): Promise<LinkMeta | null> {
  // 提取所有 URL
  const urls = text.match(/https?:\/\/[^\s<>)"']+/gi)
  if (!urls) return null

  for (const url of urls) {
    if (!isSupportedLinkHost(url)) continue
    for (const { test, parse } of PARSERS) {
      if (test.test(url)) {
        const meta = await parse(url, locale)
        if (meta) return meta
      }
    }
  }
  return null
}
