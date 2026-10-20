import type { LinkMeta } from './types.js'

// ── 工具函数 ──────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT = 10_000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 将远程图片下载并转为 data URI，避免 satori 渲染时遇到防盗链/CORS */
async function imageToDataUri(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  try {
    if (url.startsWith('//')) url = 'https:' + url
    if (url.startsWith('http:')) url = url.replace('http:', 'https:')
    const res = await fetchWithTimeout(url, {
      headers: { Referer: new URL(url).origin, 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

function formatNumber(n: number | undefined): string {
  if (n == null) return '-'
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

async function parseBilibili(url: string): Promise<LinkMeta | null> {
  // 短链跳转
  if (url.includes('b23.tv')) {
    const res = await fetchWithTimeout(url, { redirect: 'follow' })
    url = res.url
  }
  const bvMatch = url.match(/BV[\w]+/)
  if (!bvMatch) return null

  const api = `https://api.bilibili.com/x/web-interface/view?bvid=${bvMatch[0]}`
  const res = await fetchWithTimeout(api, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
  })
  const json = await res.json() as any
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
      '播放': formatNumber(d.stat?.view),
      '弹幕': formatNumber(d.stat?.danmaku),
      '点赞': formatNumber(d.stat?.like),
    },
  }
}

// ── GitHub ────────────────────────────────────────────────────────────────────

const GITHUB_RE = /github\.com\/([\w.-]+)\/([\w.-]+)/i

async function parseGithub(url: string): Promise<LinkMeta | null> {
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
    const d = await res.json() as any
    return {
      platform: 'github',
      title: `${type === 'pull' ? 'PR' : 'Issue'} #${num}: ${d.title}`,
      description: d.body?.slice(0, 200) || undefined,
      author: d.user?.login,
      authorAvatar: await imageToDataUri(d.user?.avatar_url),
      url,
      stats: {
        '状态': d.state === 'open' ? '🟢 Open' : '🟣 Closed',
        '评论': String(d.comments ?? 0),
      },
    }
  }

  // 仓库
  const res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!res.ok) return null
  const d = await res.json() as any
  return {
    platform: 'github',
    title: d.full_name || `${owner}/${repo}`,
    description: d.description || undefined,
    author: d.owner?.login,
    authorAvatar: await imageToDataUri(d.owner?.avatar_url),
    cover: await imageToDataUri(`https://opengraph.githubassets.com/1/${owner}/${repo}`),
    url,
    stats: {
      'Star': formatNumber(d.stargazers_count),
      'Fork': formatNumber(d.forks_count),
      '语言': d.language || '-',
    },
  }
}

// ── 抖音 ──────────────────────────────────────────────────────────────────────

const DOUYIN_RE = /(?:douyin\.com\/video\/|v\.douyin\.com\/)/i

async function parseDouyin(url: string): Promise<LinkMeta | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      },
      redirect: 'follow',
    })
    const html = await res.text()
    const title = extractMeta(html, 'og:title')
    if (!title) return null

    return {
      platform: 'douyin',
      title,
      description: extractMeta(html, 'og:description'),
      cover: await imageToDataUri(extractMeta(html, 'og:image')),
      url: res.url || url,
      author: extractMeta(html, 'og:site_name') || '抖音',
    }
  } catch {
    return null
  }
}

// ── 小红书 ────────────────────────────────────────────────────────────────────

const XIAOHONGSHU_RE = /(?:xiaohongshu\.com\/(?:explore|discovery)|xhslink\.com\/)/i

async function parseXiaohongshu(url: string): Promise<LinkMeta | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      },
      redirect: 'follow',
    })
    const html = await res.text()
    const title = extractMeta(html, 'og:title')
    if (!title) return null

    return {
      platform: 'xiaohongshu',
      title,
      description: extractMeta(html, 'og:description'),
      cover: await imageToDataUri(extractMeta(html, 'og:image')),
      url: res.url || url,
      author: extractMeta(html, 'author') || extractMeta(html, 'og:site_name') || '小红书',
    }
  } catch {
    return null
  }
}

// ── 统一检测 ──────────────────────────────────────────────────────────────────

interface PlatformParser {
  test: RegExp
  parse: (url: string) => Promise<LinkMeta | null>
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
export async function detectAndParse(text: string): Promise<LinkMeta | null> {
  // 提取所有 URL
  const urls = text.match(/https?:\/\/[^\s<>)"']+/gi)
  if (!urls) return null

  for (const url of urls) {
    for (const { test, parse } of PARSERS) {
      if (test.test(url)) {
        const meta = await parse(url)
        if (meta) return meta
      }
    }
  }
  return null
}
