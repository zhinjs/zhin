export {
  DEFAULT_GROUP_SUITE_CONFIG,
  resolveGroupSuiteConfig,
} from './config.js';
export type { GroupSuiteConfig } from './config.js';
export { doCheckin, myPoints, pointsRank } from './checkin-lib.js';
export {
  addKeyword,
  listKeywords,
  matchKeyword,
  removeKeyword,
  resetKeywords,
} from './keyword-store.js';
export {
  ensureGroupSuiteMemoryDb,
  getCheckinModel,
  getGroupSuiteDb,
  getStatsModel,
  getTeachModel,
  resetGroupSuiteDb,
  setGroupSuiteDb,
} from './db-store.js';
export {
  parseTeachPair,
  resetTeachCooldown,
  teachAdd,
  teachForget,
  teachList,
  tryTeachReply,
} from './teach-lib.js';
export {
  flushStatsBuffer,
  monthStartStr,
  myStatsText,
  queryStats,
  recordMessage,
  resetStatsBuffer,
  statsRankText,
  weekStartStr,
} from './stats-lib.js';

/**
 * Still TODO (not mounted in Plugin Runtime):
 * - admin.ts — notice welcome / recall (needs Adapter side-event wiring)
 * - daily-analysis.ts — AI daily report (inbox + LLM + cron)
 * - host DatabaseFeature Resource persistence (swap memory store)
 * - HTML stats/analysis cards (text replies for slice-2)
 */
