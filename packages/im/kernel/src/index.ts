/**
 * @zhin.js/kernel — 框架无关的运行时内核
 *
 * 提供调度、错误体系、IM identity 和通用工具函数。
 */

// ── Errors ──
export {
  ZhinError,
  ConfigError,
  PluginError,
  ConnectionError,
  ContextError,
  ValidationError,
  PermissionError,
  TimeoutError,
  ErrorManager,
  RetryManager,
  CircuitBreaker,
} from './errors.js';

// ── Schedule engine ──
export {
  ScheduleEngine,
  getScheduleEngine,
  setScheduleEngine,
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

// ── Scheduler ──
export { Scheduler, getScheduler, setScheduler } from './scheduler/index.js';
export type {
  Schedule,
  JobPayload,
  JobState,
  ScheduledJob,
  JobStore,
  JobCallback,
  AddJobOptions,
  IScheduler,
  SchedulerOptions,
} from './scheduler/index.js';

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
export {
  evaluate,
  execute,
  clearEvalCache,
  getEvalCacheStats,
  getValueWithRuntime,
  compiler,
  remove,
  isEmpty,
  Time,
  supportedPluginExtensions,
  resolveEntry,
  sleep,
} from './utils.js';
export type { Dict } from './utils.js';
