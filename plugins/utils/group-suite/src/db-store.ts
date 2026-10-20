import {
  CHECKIN_TABLE,
  STATS_TABLE,
  TEACH_TABLE,
  type GroupSuiteMemoryDb,
  type GroupSuiteModel,
} from './memory-store.js';

export function getCheckinModel(db: GroupSuiteMemoryDb): GroupSuiteModel | undefined {
  return db.models.get(CHECKIN_TABLE);
}

export function getTeachModel(db: GroupSuiteMemoryDb): GroupSuiteModel | undefined {
  return db.models.get(TEACH_TABLE);
}

export function getStatsModel(db: GroupSuiteMemoryDb): GroupSuiteModel | undefined {
  return db.models.get(STATS_TABLE);
}
