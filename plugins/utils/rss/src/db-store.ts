export {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
  type RssMemoryDb,
  type RssModel,
} from './memory-store.js';

import {
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
  type RssMemoryDb,
  type RssModel,
} from './memory-store.js';

export function getRssSubs(db: RssMemoryDb): RssModel | null {
  return db.models.get(RSS_SUBS_TABLE) ?? null;
}

export function getRssSeen(db: RssMemoryDb): RssModel | null {
  return db.models.get(RSS_SEEN_TABLE) ?? null;
}

export interface RssSubscriptionSummary {
  readonly id: string;
  readonly feedTitle: string;
  readonly url: string;
  readonly adapterName: string;
  readonly endpointId: string;
  readonly channelType: string;
  readonly channelId: string;
  readonly creatorName: string;
  readonly createdAt: string;
}

export async function listAllSubscriptions(db: RssMemoryDb): Promise<RssSubscriptionSummary[]> {
  const Subs = getRssSubs(db);
  if (!Subs) return [];
  const rows = await Subs.select();
  return rows.map((row, index) => ({
    id: String(row.id ?? index + 1),
    feedTitle: String(row.feed_title ?? row.feedTitle ?? ''),
    url: String(row.url ?? ''),
    adapterName: String(row.adapter_name ?? row.adapterName ?? ''),
    endpointId: String(row.endpoint_id ?? row.endpointId ?? ''),
    channelType: String(row.channel_type ?? row.channelType ?? 'private'),
    channelId: String(row.channel_id ?? row.channelId ?? ''),
    creatorName: String(row.creator_name ?? row.creatorName ?? ''),
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
  }));
}
