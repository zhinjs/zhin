export {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
  type RssMemoryDb,
  type RssModel,
} from './memory-store.js';

import {
  createInMemoryRssDb,
  RSS_SEEN_TABLE,
  RSS_SUBS_TABLE,
  type RssMemoryDb,
  type RssModel,
} from './memory-store.js';

let _db: RssMemoryDb | null = null;

export function ensureRssMemoryDb(): RssMemoryDb {
  if (!_db) _db = createInMemoryRssDb();
  return _db;
}

export function getRssDb(): RssMemoryDb | null {
  return ensureRssMemoryDb();
}

export function setRssDb(db: RssMemoryDb | null): void {
  _db = db;
}

export function resetRssDb(): void {
  _db = null;
}

export function getRssSubs(): RssModel | null {
  return ensureRssMemoryDb().models.get(RSS_SUBS_TABLE) ?? null;
}

export function getRssSeen(): RssModel | null {
  return ensureRssMemoryDb().models.get(RSS_SEEN_TABLE) ?? null;
}
