export {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
  type RssMemoryDb,
  type RssModel,
} from './memory-store.js';

import { createGenerationStore, type Dispose, type GenerationStoreContext } from 'zhin.js';
import {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
  type RssMemoryDb,
  type RssModel,
} from './memory-store.js';

const rssDbStore = createGenerationStore<RssMemoryDb>('rss/db');

let _db: RssMemoryDb | null = null;
let _memoryDb: RssMemoryDb | null = null;

/**
 * Generation-owned database binding used by Plugin Runtime setup().
 * Auto-unregisters when the generation lifecycle disposes, so no stale
 * reference to the previous generation's host survives a reload.
 */
export function provideRssDb(context: GenerationStoreContext, db: RssMemoryDb): Dispose {
  return rssDbStore.provide(context, db);
}

export function ensureRssMemoryDb(): RssMemoryDb {
  const provided = rssDbStore.tryUse() ?? _db;
  if (provided) return provided;
  if (!_memoryDb) _memoryDb = createInMemoryRssDb();
  return _memoryDb;
}

export function getRssDb(): RssMemoryDb | null {
  return ensureRssMemoryDb();
}

export function setRssDb(db: RssMemoryDb | null): void {
  _db = db;
}

export function resetRssDb(): void {
  rssDbStore.clear();
  _db = null;
  _memoryDb = null;
}

export function getRssSubs(): RssModel | null {
  return ensureRssMemoryDb().models.get(RSS_SUBS_TABLE) ?? null;
}

export function getRssSeen(): RssModel | null {
  return ensureRssMemoryDb().models.get(RSS_SEEN_TABLE) ?? null;
}
