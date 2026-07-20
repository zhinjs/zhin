import type { LotteryDb } from './db.js';
import { createInMemoryLotteryDb } from './memory-db.js';

let _db: LotteryDb | null = null;

/** Ensure an in-memory store when Runtime database Resource is not wired yet. */
export function ensureLotteryMemoryDb(): LotteryDb {
  if (!_db) _db = createInMemoryLotteryDb();
  return _db;
}

export function getLotteryDb(): LotteryDb | null {
  return ensureLotteryMemoryDb();
}

export function setLotteryDb(db: LotteryDb | null): void {
  _db = db;
}

/** Test helper: clear module store. */
export function resetLotteryDb(): void {
  _db = null;
}
