import type { Locale } from 'zhin.js/i18n';
import { rssMessages as t } from './i18n.js';
/**
 * RSS feed fetch/preview helpers (no Plugin host).
 */
import Parser from 'rss-parser';
import { fetchPublic, readCappedBody, type HostLookup } from './public-fetch.js';

/** Feeds larger than this are refused instead of buffered. */
const MAX_FEED_BYTES = 5 * 1024 * 1024;

export interface FeedItem {
  title: string;
  link: string;
  date: string;
  summary: string;
  guid: string;
}

export interface RssConfig {
  readonly pollCron: string;
  readonly maxPerGroup: number;
  readonly maxItems: number;
  readonly timeout: number;
  readonly maxItemsPerPoll?: number;
  readonly fetchTimeoutMs?: number;
  /** Let feeds live on loopback/LAN addresses (self-hosted RSSHub and the like). Default false. */
  readonly allowPrivateNetwork?: boolean;
}

export const DEFAULT_RSS_CONFIG: RssConfig = {
  pollCron: '0 */5 * * * *',
  maxPerGroup: 30,
  maxItems: 5,
  timeout: 15_000,
};

export function resolveRssConfig(raw: Partial<RssConfig> | undefined): RssConfig {
  const merged = { ...DEFAULT_RSS_CONFIG, ...raw };
  return {
    ...merged,
    maxItemsPerPoll: raw?.maxItemsPerPoll ?? merged.maxItems,
    fetchTimeoutMs: raw?.fetchTimeoutMs ?? merged.timeout,
  };
}

/**
 * 剔除 HTML 标签与 `&nbsp;` 实体并折叠空白。
 * 线性单遍扫描实现（手写状态机），语义等价于原先的
 * `/<[^>]*>/g` → `/&nbsp;/g` → `/\s+/g` 三步 replace，但避免：
 * - js/polynomial-redos：大量 `<` 无闭合时正则逐位重扫的二次方回溯；
 * - js/incomplete-multi-character-sanitization：多趟 replace 的残留问题。
 */
export function stripHtml(html: string): string {
  let out = '';
  let pendingSpace = false;
  let mayHaveTagEnd = html.includes('>');
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === '<' && mayHaveTagEnd) {
      const end = html.indexOf('>', i + 1);
      if (end >= 0) {
        i = end + 1;
        continue;
      }
      // 后续不再有 `>`：剩余的 `<` 都是字面字符，不再重复扫描。
      mayHaveTagEnd = false;
    }
    if (ch === '&' && html.startsWith('&nbsp;', i)) {
      pendingSpace = true;
      i += '&nbsp;'.length;
      continue;
    }
    if (/\s/u.test(ch)) {
      pendingSpace = true;
      i += 1;
      continue;
    }
    if (pendingSpace && out.length > 0) out += ' ';
    pendingSpace = false;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Fetch and parse a feed. The URL comes from chat users, so it is requested through the
 * public-address policy (every redirect hop re-checked), with one timeout for the whole
 * exchange and a body cap.
 */
export async function fetchFeed(
  url: string,
  options: number | Pick<RssConfig, 'timeout' | 'allowPrivateNetwork'> = DEFAULT_RSS_CONFIG,
  lookup?: HostLookup,
): Promise<{ title: string; items: FeedItem[] }> {
  const { timeout, allowPrivateNetwork = false } = typeof options === 'number' ? { timeout: options } : options;
  const { response } = await fetchPublic(url, {
    timeoutMs: timeout,
    lookup,
    allowPrivateNetwork,
    init: {
      headers: {
        'User-Agent': 'ZhinBot-RSS/1.0',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Status code ${response.status}`);
  }
  const body = await readCappedBody(response, MAX_FEED_BYTES);
  if (!body) throw new Error(`Feed is larger than ${MAX_FEED_BYTES} bytes`);
  const feed = await new Parser().parseString(body.toString('utf8'));
  const items: FeedItem[] = (feed.items || []).slice(0, 20).map((item) => ({
    title: (item.title || '').trim(),
    link: (item.link || '').trim(),
    date: item.isoDate || item.pubDate || '',
    summary: stripHtml(item.contentSnippet || item.content || '').slice(0, 200),
    guid: item.guid || item.link || item.title || '',
  }));
  return { title: (feed.title || url).trim(), items };
}

export function formatFeedPreview(title: string, items: FeedItem[], locale: Locale = 'zh-CN'): string {
  if (items.length === 0) return t(locale, 'previewEmpty', { title });
  const lines = [t(locale, 'previewTitle', { title, count: items.length })];
  for (const item of items.slice(0, 5)) {
    lines.push('');
    lines.push(`${item.title}`);
    if (item.date) lines.push(`  ${new Date(item.date).toLocaleString(locale)}`);
    if (item.link) lines.push(`  ${item.link}`);
  }
  if (items.length > 5) lines.push(t(locale, 'more', { count: items.length - 5 }));
  return lines.join('\n');
}
