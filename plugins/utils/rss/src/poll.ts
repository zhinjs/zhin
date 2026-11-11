import { decodeTaskTarget } from 'zhin.js/plugin-runtime';
import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { rssMessages as t } from './i18n.js';
/**
 * Feed poll helpers: detect new items; optional OutboundHost push to subscribers.
 */
import { fetchFeed, type FeedItem } from './feed.js';
import { getRssSeen, getRssSubs } from './db-store.js';
import type { RssRuntime } from './runtime.js';

/** Seen rows are kept this long after the item was last present in its feed. */
export const SEEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Seen rows of items still in the feed are re-stamped at most this often. */
const SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

function ts(): string {
  return new Date().toISOString();
}

/** True for an item whose own publish date is past the retention window. Undated items are never stale. */
function isStale(item: FeedItem, cutoffMs: number): boolean {
  if (!item.date) return false;
  const published = Date.parse(item.date);
  return Number.isFinite(published) && published < cutoffMs;
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

export async function markItemsSeen(
  runtime: RssRuntime,
  feedUrl: string,
  items: FeedItem[],
  /** Guids already stored for this feed; loaded once when the caller does not have them. */
  knownGuids?: ReadonlySet<string>,
): Promise<void> {
  const Seen = getRssSeen(runtime.db);
  if (!Seen || items.length === 0) return;
  const known = new Set(knownGuids
    ?? (await Seen.select().where({ feed_url: feedUrl })).map((row) => String(row.item_guid ?? '')));
  // One timestamp per batch so cleanup can drop the whole batch with a single delete.
  const seenAt = ts();
  for (const item of items) {
    if (known.has(item.guid)) continue;
    known.add(item.guid);
    await Seen.insert({
      feed_url: feedUrl,
      item_guid: item.guid,
      item_title: item.title,
      seen_at: seenAt,
    });
  }
}

export interface CheckResult {
  readonly text: string;
  readonly totalNew: number;
  readonly pushed: number;
}

interface RssFeedPushRequest {
  readonly runtime: RssRuntime;
  /** A single fetched feed, shared by this poll's subscribers without re-fetching. */
  readonly feed: Readonly<{ url: string; title: string; items: FeedItem[] }>;
}
async function pushToSubscribers(input: RssFeedPushRequest): Promise<number> {
  const { runtime, feed: { url: feedUrl, title: feedTitle, items } } = input;
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
      const target = sub.target_json == null ? undefined
        : decodeTaskTarget(JSON.parse(String(sub.target_json)) as Record<string, unknown>);
      await push({
        ...(target ? { target } : {}),
        adapterName,
        endpointKey,
        channelType,
        channelId,
        locale: resolveLocale(sub.locale),
        content: formatNewItems(feedTitle, items, runtime.config.maxItems, resolveLocale(sub.locale)),
      });
      pushed += 1;
    } catch (error) {
      console.warn('[rss] subscription delivery failed:', error instanceof Error ? error.message : String(error));
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
      const { title, items } = await fetchFeed(url, runtime.config);
      const seenRows = await Seen.select().where({ feed_url: url });
      const seenAt = new Map(seenRows.map((r) => [String(r.item_guid ?? ''), String(r.seen_at ?? '')]));
      const seenGuids = new Set(seenAt.keys());
      const now = Date.now();
      // Keep the seen row of an item that is still listed, so it is not re-announced after cleanup.
      const refreshBefore = new Date(now - SEEN_REFRESH_MS).toISOString();
      const refreshed = ts();
      for (const item of items) {
        const stamp = seenAt.get(item.guid);
        if (item.guid && stamp !== undefined && stamp < refreshBefore) {
          await Seen.update({ seen_at: refreshed }).where({ feed_url: url, item_guid: item.guid });
        }
      }
      // An item older than the retention window can no longer have a seen row; never treat it as new.
      const newItems = items.filter((item) => item.guid && !seenGuids.has(item.guid)
        && !isStale(item, now - SEEN_RETENTION_MS));
      if (newItems.length === 0) {
        parts.push(t(locale, 'noNew', { title: title || url }));
        continue;
      }
      await markItemsSeen(runtime, url, newItems, seenGuids);
      totalNew += newItems.length;
      const body = formatNewItems(title || url, newItems, runtime.config.maxItems, locale);
      parts.push(body);
      pushed += await pushToSubscribers({ runtime, feed: { url, title: title || url, items: newItems } });
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
 * Periodically clean seen records older than 7 days. Rows of items still listed in their
 * feed are re-stamped by checkSubscriptions and therefore survive.
 */
export async function cleanOldSeen(runtime: RssRuntime): Promise<void> {
  const Seen = getRssSeen(runtime.db);
  if (!Seen) return;
  try {
    const cutoffStr = new Date(Date.now() - SEEN_RETENTION_MS).toISOString();
    const all = await Seen.select();
    // The table has no id column. Rows of one batch share (feed_url, seen_at), so one delete per batch.
    const batches = new Map<string, { feed_url: unknown; seen_at: string }>();
    for (const row of all) {
      if (typeof row.seen_at !== 'string' || row.seen_at >= cutoffStr) continue;
      batches.set(`${String(row.feed_url)}\0${row.seen_at}`, { feed_url: row.feed_url, seen_at: row.seen_at });
    }
    for (const batch of batches.values()) await Seen.delete().where(batch);
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
