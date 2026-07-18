/**
 * RSS feed fetch/preview helpers (no Plugin host).
 */
import Parser from 'rss-parser';

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
}

export const DEFAULT_RSS_CONFIG: RssConfig = {
  pollCron: '0 */5 * * * *',
  maxPerGroup: 30,
  maxItems: 5,
  timeout: 15_000,
};

export function resolveRssConfig(raw: Partial<RssConfig> | undefined): RssConfig {
  return { ...DEFAULT_RSS_CONFIG, ...raw };
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function fetchFeed(
  url: string,
  timeout = DEFAULT_RSS_CONFIG.timeout,
): Promise<{ title: string; items: FeedItem[] }> {
  const parser = new Parser({
    timeout,
    headers: {
      'User-Agent': 'ZhinBot-RSS/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  const feed = await parser.parseURL(url);
  const items: FeedItem[] = (feed.items || []).slice(0, 20).map((item) => ({
    title: (item.title || '').trim(),
    link: (item.link || '').trim(),
    date: item.isoDate || item.pubDate || '',
    summary: stripHtml(item.contentSnippet || item.content || '').slice(0, 200),
    guid: item.guid || item.link || item.title || '',
  }));
  return { title: (feed.title || url).trim(), items };
}

export function formatFeedPreview(title: string, items: FeedItem[]): string {
  if (items.length === 0) return `${title}: 暂无内容`;
  const lines = [`${title} (共 ${items.length} 条)`];
  for (const item of items.slice(0, 5)) {
    lines.push('');
    lines.push(`${item.title}`);
    if (item.date) lines.push(`  ${new Date(item.date).toLocaleString('zh-CN')}`);
    if (item.link) lines.push(`  ${item.link}`);
  }
  if (items.length > 5) lines.push(`\n...还有 ${items.length - 5} 条`);
  return lines.join('\n');
}
