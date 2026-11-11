/**
 * @zhin.js/kernel — 框架无关的运行时内核
 *
 * 提供调度、错误体系、IM identity 和通用工具函数。
 */

// ── Errors ──
export { ZhinError } from './errors.js';

// ── Schedule engine ──
export {
  ScheduleEngine,
  resolveSolarJob,
  resolveLunarJob,
  resolveHolidayJob,
  resolveFreeDayJob,
  resolveWorkdayJob,
  resolveScatterJob,
  getNextRun,
} from './schedule-engine.js';
export type {
  ScheduleFireCallback,
  MemoryScheduleRegistration,
  ScheduleEngineOptions,
  JobContext,
  ResolvedJob,
  ScheduleKind,
} from './schedule-engine.js';
export type { HolidayInput, ScatterInput, FestivalName } from '@zhin.js/schedule';

// ── Heartbeat ──
export { isHeartbeatEmpty } from './heartbeat.js';

// ── IM identity (scene/session keys) ──
export type {
  IMSceneKind,
  IMSceneIdentity,
  ResolveIMSessionIdInput,
} from './im-identity.js';
export {
  resolveIMSceneIdForSession,
  resolveIMSceneSessionId,
  resolveIMSessionId,
} from './im-identity.js';

// ── Utils ──
export { renderTemplatePaths } from './template-paths.js';
export { Time, sleep } from './utils.js';
export type { Dict } from './utils.js';
