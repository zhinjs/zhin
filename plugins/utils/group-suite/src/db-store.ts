import {
  CHECKIN_TABLE,
  createInMemoryGroupSuiteDb,
  STATS_TABLE,
  TEACH_TABLE,
  type GroupSuiteMemoryDb,
  type GroupSuiteModel,
} from './memory-store.js';

let _db: GroupSuiteMemoryDb | null = null;
const registrations: Array<{ readonly value: GroupSuiteMemoryDb }> = [];

/** Ensure an in-memory store when Runtime DatabaseFeature Resource is not wired yet. */
export function ensureGroupSuiteMemoryDb(): GroupSuiteMemoryDb {
  if (!_db) _db = createInMemoryGroupSuiteDb();
  return _db;
}

export function getGroupSuiteDb(): GroupSuiteMemoryDb | null {
  return registrations[registrations.length - 1]?.value ?? ensureGroupSuiteMemoryDb();
}

export function setGroupSuiteDb(db: GroupSuiteMemoryDb | null): void {
  _db = db;
}

export function registerGroupSuiteDb(db: GroupSuiteMemoryDb): () => void {
  const registration = Object.freeze({ value: db });
  registrations.push(registration);
  return () => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

/** Test helper: clear module store. */
export function resetGroupSuiteDb(): void {
  _db = null;
}

export function getCheckinModel(db = getGroupSuiteDb()): GroupSuiteModel | null {
  return db?.models.get(CHECKIN_TABLE) ?? null;
}

export function getTeachModel(db = getGroupSuiteDb()): GroupSuiteModel | null {
  return db?.models.get(TEACH_TABLE) ?? null;
}

export function getStatsModel(db = getGroupSuiteDb()): GroupSuiteModel | null {
  return db?.models.get(STATS_TABLE) ?? null;
}
