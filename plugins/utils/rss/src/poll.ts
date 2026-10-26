import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { rssMessages as t } from './i18n.js';
/**
 * Feed poll helpers: detect new items; optional OutboundHost push to subscribers.
 */
import { fetchFeed, type FeedItem } from './feed.js';
import { getRssSeen, getRssSubs } from './db-store.js';
import type { RssRuntime } from './runtime.js';

function ts(): string {
  return new Date().toISOString();
}

export function formatNewItems(feedTitle: string, items: FeedItem[], maxItems: number, locale: Locale = 'zh-CN'): string {
  const lines = [t(locale, 'newItems', { title: feedTitle, count: items.length })];
  for (const item of items.slice(0, maxItems)) {
    lines.push('');
    lines.push(`${item.title}`);
    if (item.summary) lines.push(item.summary);
    if (item.link) lines.push(item.link);
  }
  if (items.length > maxItems) {
    lines.push(t(locale, 'moreSource', { count: items.length - maxItems }));
  }
  return lines.join('\n');
}

export async function markItemsSeen(runtime: RssRuntime, feedUrl: string, items: FeedItem[]): Promise<void> {
  const Seen = getRssSeen(runtime.db);
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

async function pushToSubscribers(runtime: RssRuntime, feedUrl: string, feedTitle: string, items: FeedItem[]): Promise<number> {
  const push = runtime.outbound;
  const Subs = getRssSubs(runtime.db);
  if (!push || !Subs) return 0;
  const subscribers = await Subs.select().where({ url: feedUrl });
  let pushed = 0;
  for (const sub of subscribers) {
    const adapterName = sub.adapter_name;
    const endpointKey = sub.endpoint_id;
    const channelType = sub.channel_type;
    const channelId = sub.channel_id;
    if (typeof adapterName !== 'string' || !adapterName.trim()
      || typeof channelId !== 'string' || !channelId.trim()
      || typeof endpointKey !== 'string' || !endpointKey.trim()
      || (channelType !== 'private' && channelType !== 'group' && channelType !== 'channel')) continue;
    try {
      await push({
        adapterName,
        endpointKey,
        channelType,
        channelId,
        locale: resolveLocale(sub.locale),
        content: formatNewItems(feedTitle, items, runtime.config.maxItems, resolveLocale(sub.locale)),
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
export async function checkSubscriptions(runtime: RssRuntime, options: {
  urls: readonly string[];
  locale?: Locale;
}): Promise<CheckResult> {
  const locale = resolveLocale(options.locale);
  const Seen = getRssSeen(runtime.db);
  const Subs = getRssSubs(runtime.db);
  if (!Seen || !Subs) {
    return { text: t(locale, 'databaseUnavailable'), totalNew: 0, pushed: 0 };
  }

  const parts: string[] = [];
  let totalNew = 0;
  let pushed = 0;

  for (const url of options.urls) {
    try {
      const { title, items } = await fetchFeed(url, runtime.config.timeout);
      const seenRows = await Seen.select().where({ feed_url: url });
      const seenGuids = new Set(seenRows.map((r) => String(r.item_guid ?? '')));
      const newItems = items.filter((item) => item.guid && !seenGuids.has(item.guid));
      if (newItems.length === 0) {
        parts.push(t(locale, 'noNew', { title: title || url }));
        continue;
      }
      await markItemsSeen(runtime, url, newItems);
      totalNew += newItems.length;
      const body = formatNewItems(title || url, newItems, runtime.config.maxItems, locale);
      parts.push(body);
      pushed += await pushToSubscribers(runtime, url, title || url, newItems);
    } catch (e) {
      parts.push(t(locale, 'checkFailed', { url, error: (e as Error).message }));
    }
  }

  if (parts.length === 0) return { text: t(locale, 'nothingToCheck'), totalNew: 0, pushed: 0 };
  const pushNote = runtime.outbound
    ? (pushed > 0 ? t(locale, 'pushed', { count: pushed }) : t(locale, 'notPushed'))
    : t(locale, 'localOnly');
  const header = totalNew > 0
    ? t(locale, 'checked', { count: totalNew, pushNote })
    : t(locale, 'checkedEmpty');
  return { text: `${header}\n\n${parts.join('\n\n')}`, totalNew, pushed };
}

/**
 * Periodically clean seen records older than 7 days.
 */
export async function cleanOldSeen(runtime: RssRuntime): Promise<void> {
  const Seen = getRssSeen(runtime.db);
  if (!Seen) return;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString();
    const all = await Seen.select();
    const expired = all.filter((r) => typeof r.seen_at === 'string' && r.seen_at < cutoffStr);
    for (const row of expired) {
      // 表结构没有 id 列，按业务键 (feed_url, item_guid) 删除。
      await Seen.delete().where({ feed_url: row.feed_url, item_guid: row.item_guid });
    }
  } catch (e) {
    // Cleanup failure must not break the main flow, but it must be visible.
    console.warn(`[rss] cleanOldSeen failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Poll all unique feed URLs across subscriptions.
 */
export async function pollAllFeeds(runtime: RssRuntime): Promise<CheckResult> {
  const locale = resolveLocale(runtime.locale);
  const Subs = getRssSubs(runtime.db);
  if (!Subs) return { text: t(locale, 'databaseUnavailable'), totalNew: 0, pushed: 0 };
  const all = await Subs.select();
  const urls = [...new Set(all.map((s) => String(s.url ?? '')).filter(Boolean))];
  if (urls.length === 0) return { text: t(locale, 'noFeeds'), totalNew: 0, pushed: 0 };
  return checkSubscriptions(runtime, { urls, locale });
}
