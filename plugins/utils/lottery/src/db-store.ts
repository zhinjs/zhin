import type { LotteryDb } from './db.js';
import { createInMemoryLotteryDb } from './memory-db.js';

let _db: LotteryDb | null = null;
const registrations: Array<{ readonly value: LotteryDb }> = [];

/** Ensure an in-memory store when Runtime database Resource is not wired yet. */
export function ensureLotteryMemoryDb(): LotteryDb {
  if (!_db) _db = createInMemoryLotteryDb();
  return _db;
}

export function getLotteryDb(): LotteryDb | null {
  return registrations[registrations.length - 1]?.value ?? ensureLotteryMemoryDb();
}

export function setLotteryDb(db: LotteryDb | null): void {
  _db = db;
}

/** Generation-owned database binding used by Plugin Runtime setup(). */
export function registerLotteryDb(db: LotteryDb): () => void {
  const registration = Object.freeze({ value: db });
  registrations.push(registration);
  return () => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

/** Test helper: clear module store. */
export function resetLotteryDb(): void {
  _db = null;
}
