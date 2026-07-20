import {
  CHECKIN_TABLE,
  createInMemoryGroupSuiteDb,
  STATS_TABLE,
  TEACH_TABLE,
  type GroupSuiteMemoryDb,
  type GroupSuiteModel,
} from './memory-store.js';

let _db: GroupSuiteMemoryDb | null = null;

/** Ensure an in-memory store when Runtime DatabaseFeature Resource is not wired yet. */
export function ensureGroupSuiteMemoryDb(): GroupSuiteMemoryDb {
  if (!_db) _db = createInMemoryGroupSuiteDb();
  return _db;
}

export function getGroupSuiteDb(): GroupSuiteMemoryDb | null {
  return ensureGroupSuiteMemoryDb();
}

export function setGroupSuiteDb(db: GroupSuiteMemoryDb | null): void {
  _db = db;
}

/** Test helper: clear module store. */
export function resetGroupSuiteDb(): void {
  _db = null;
}

export function getCheckinModel(): GroupSuiteModel | null {
  return ensureGroupSuiteMemoryDb().models.get(CHECKIN_TABLE) ?? null;
}

export function getTeachModel(): GroupSuiteModel | null {
  return ensureGroupSuiteMemoryDb().models.get(TEACH_TABLE) ?? null;
}

export function getStatsModel(): GroupSuiteModel | null {
  return ensureGroupSuiteMemoryDb().models.get(STATS_TABLE) ?? null;
}
