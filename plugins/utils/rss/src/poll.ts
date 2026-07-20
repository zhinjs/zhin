/**
 * Feed poll helpers: detect new items; optional OutboundHost push to subscribers.
 */
import { fetchFeed, type FeedItem, type RssConfig } from './feed.js';
import { getRssSeen, getRssSubs } from './db-store.js';

export type RssOutboundPush = (input: {
  readonly adapterName: string;
  readonly endpointId: string;
  readonly channelType: string;
  readonly channelId: string;
  readonly content: string;
}) => Promise<void>;

let _outboundPush: RssOutboundPush | null = null;

export function setRssOutboundPush(push: RssOutboundPush | null): void {
  _outboundPush = push;
}

export function getRssOutboundPush(): RssOutboundPush | null {
  return _outboundPush;
}

function ts(): string {
  return new Date().toISOString();
}

export function formatNewItems(feedTitle: string, items: FeedItem[], maxItems: number): string {
  const lines = [`${feedTitle} 有 ${items.length} 条新内容：`];
  for (const item of items.slice(0, maxItems)) {
    lines.push('');
    lines.push(`${item.title}`);
    if (item.summary) lines.push(item.summary);
    if (item.link) lines.push(item.link);
  }
  if (items.length > maxItems) {
    lines.push(`\n...还有 ${items.length - maxItems} 条，请查看源站`);
  }
  return lines.join('\n');
}

export async function markItemsSeen(feedUrl: string, items: FeedItem[]): Promise<void> {
  const Seen = getRssSeen();
  if (!Seen) return;
  for (const item of items) {
    const dup = await Seen.select().where({ feed_url: feedUrl, item_guid: item.guid });
    if (dup.length === 0) {
      await Seen.insert({
        feed_url: feedUrl,
        item_guid: item.guid,
        item_title: item.title,
        seen_at: ts(),
      });
    }
  }
}

export interface CheckResult {
  readonly text: string;
  readonly totalNew: number;
  readonly pushed: number;
}

async function pushToSubscribers(feedUrl: string, content: string): Promise<number> {
  const push = _outboundPush;
  const Subs = getRssSubs();
  if (!push || !Subs) return 0;
  const subscribers = await Subs.select().where({ url: feedUrl });
  let pushed = 0;
  for (const sub of subscribers) {
    const adapterName = String(sub.adapter_name ?? '');
    const channelId = String(sub.channel_id ?? '');
    if (!adapterName || !channelId) continue;
    try {
      await push({
        adapterName,
        endpointId: String(sub.endpoint_id ?? adapterName),
        channelType: String(sub.channel_type ?? 'private'),
        channelId,
        content,
      });
      pushed += 1;
    } catch {
      // OutboundHost already logs; continue other subscribers.
    }
  }
  return pushed;
}

/**
 * Check subscribed feeds for new items and mark them seen.
 * When OutboundHost is wired, pushes formatted text to each subscriber channel.
 */
export async function checkSubscriptions(options: {
  urls: readonly string[];
  config: RssConfig;
}): Promise<CheckResult> {
  const Seen = getRssSeen();
  const Subs = getRssSubs();
  if (!Seen || !Subs) {
    return { text: 'RSS 数据库尚未就绪', totalNew: 0, pushed: 0 };
  }

  const parts: string[] = [];
  let totalNew = 0;
  let pushed = 0;

  for (const url of options.urls) {
    try {
      const { title, items } = await fetchFeed(url, options.config.timeout);
      const seenRows = await Seen.select().where({ feed_url: url });
      const seenGuids = new Set(seenRows.map((r) => String(r.item_guid ?? '')));
      const newItems = items.filter((item) => item.guid && !seenGuids.has(item.guid));
      if (newItems.length === 0) {
        parts.push(`${title || url}: 无新内容`);
        continue;
      }
      await markItemsSeen(url, newItems);
      totalNew += newItems.length;
      const body = formatNewItems(title || url, newItems, options.config.maxItems);
      parts.push(body);
      pushed += await pushToSubscribers(url, body);
    } catch (e) {
      parts.push(`${url}: 检查失败 — ${(e as Error).message}`);
    }
  }

  if (parts.length === 0) return { text: '没有可检查的订阅', totalNew: 0, pushed: 0 };
  const pushNote = _outboundPush
    ? (pushed > 0 ? `，已推送 ${pushed} 个会话` : '，无出站推送')
    : '（未装配 OutboundHost，仅本地标记）';
  const header = totalNew > 0
    ? `检查完成，共 ${totalNew} 条新内容${pushNote}`
    : '检查完成，暂无新内容';
  return { text: `${header}\n\n${parts.join('\n\n')}`, totalNew, pushed };
}

/**
 * Periodically clean seen records older than 7 days.
 */
export async function cleanOldSeen(): Promise<void> {
  const Seen = getRssSeen();
  if (!Seen) return;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString();
    const all = await Seen.select();
    const expired = all.filter((r) => typeof r.seen_at === 'string' && r.seen_at < cutoffStr);
    for (const row of expired) {
      await Seen.delete().where({ id: row.id });
    }
  } catch {
    // Cleanup failure must not break the main flow.
  }
}

/**
 * Poll all unique feed URLs across subscriptions.
 */
export async function pollAllFeeds(config: RssConfig): Promise<CheckResult> {
  const Subs = getRssSubs();
  if (!Subs) return { text: 'RSS 数据库尚未就绪', totalNew: 0, pushed: 0 };
  const all = await Subs.select();
  const urls = [...new Set(all.map((s) => String(s.url ?? '')).filter(Boolean))];
  if (urls.length === 0) return { text: '暂无任何 RSS 订阅', totalNew: 0, pushed: 0 };
  return checkSubscriptions({ urls, config });
}
