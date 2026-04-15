import type { LinkMeta, PlatformTheme } from './types.js'

const THEMES: Record<LinkMeta['platform'], PlatformTheme> = {
  bilibili: { name: 'Bilibili', color: '#00A1D6', bg: '#E3F6FC' },
  github: { name: 'GitHub', color: '#24292e', bg: '#F0F0F0' },
  douyin: { name: '抖音', color: '#FE2C55', bg: '#FFF0F3' },
  xiaohongshu: { name: '小红书', color: '#FF2442', bg: '#FFF0F2' },
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function renderStats(stats: Record<string, string> | undefined, color: string): string {
  if (!stats) return ''
  const items = Object.entries(stats)
    .map(
      ([k, v]) =>
        `<span style="display:flex;align-items:center;margin-right:16px;font-size:12px;color:#888;">`
        + `<span style="color:${color};font-weight:600;margin-right:4px;">${escapeHtml(k)}</span>`
        + `<span>${escapeHtml(v)}</span>`
        + `</span>`,
    )
    .join('')
  return `<div style="display:flex;flex-wrap:wrap;margin-top:12px;">${items}</div>`
}

/**
 * 生成 satori 兼容的海报 HTML
 */
export function renderPoster(meta: LinkMeta): string {
  const theme = THEMES[meta.platform]

  // ── 封面区域 ──
  const coverHtml = meta.cover
    ? `<img src="${meta.cover}" style="width:480px;height:252px;object-fit:cover;" />`
    : `<div style="display:flex;align-items:center;justify-content:center;width:480px;height:80px;background:${theme.bg};">`
      + `<span style="font-size:28px;font-weight:700;color:${theme.color};">${escapeHtml(theme.name)}</span>`
      + `</div>`

  // ── 头像 + 作者 ──
  const avatarHtml = meta.authorAvatar
    ? `<img src="${meta.authorAvatar}" style="width:28px;height:28px;border-radius:14px;margin-right:8px;" />`
    : ''
  const authorHtml = meta.author
    ? `<div style="display:flex;align-items:center;margin-top:12px;">`
      + avatarHtml
      + `<span style="font-size:13px;color:#666;">${escapeHtml(meta.author)}</span>`
      + `</div>`
    : ''

  // ── 描述 ──
  const descHtml = meta.description
    ? `<span style="font-size:13px;color:#888;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">`
      + `${escapeHtml(truncate(meta.description, 80))}`
      + `</span>`
    : ''

  // ── 统计 ──
  const statsHtml = renderStats(meta.stats, theme.color)

  // ── 链接 ──
  const displayUrl = truncate(meta.url.replace(/^https?:\/\//, ''), 60)

  return `<div style="display:flex;flex-direction:column;width:480px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Noto Sans SC,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,0.08);">`
    // 封面
    + coverHtml
    // 内容区
    + `<div style="display:flex;flex-direction:column;padding:18px 20px 16px;">`
      // 平台标签
      + `<div style="display:flex;align-items:center;margin-bottom:10px;">`
        + `<span style="display:flex;align-items:center;background:${theme.color};color:#ffffff;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.5px;">`
          + escapeHtml(theme.name)
        + `</span>`
      + `</div>`
      // 标题
      + `<span style="font-size:18px;font-weight:700;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">`
        + escapeHtml(truncate(meta.title, 50))
      + `</span>`
      // 描述
      + descHtml
      // 作者
      + authorHtml
      // 统计
      + statsHtml
      // 底部链接
      + `<div style="display:flex;margin-top:14px;padding-top:12px;border-top:1px solid #f0f0f0;">`
        + `<span style="font-size:11px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">`
          + escapeHtml(displayUrl)
        + `</span>`
      + `</div>`
    + `</div>`
  + `</div>`
}
