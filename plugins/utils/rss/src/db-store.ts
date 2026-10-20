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
