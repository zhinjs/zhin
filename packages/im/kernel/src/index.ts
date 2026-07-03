/**
 * @zhin.js/kernel — 框架无关的运行时内核
 *
 * 提供通用的插件 DI 系统、Feature 抽象、
 * Cron 调度、错误体系和工具函数。
 */

// ── Plugin types ──
export type { PluginLike } from './plugin-types.js';

// ── PluginBase ──
export { PluginBase, pluginStorage, runtimeCwd, resolvePluginResolveDir, pluginCreateRequire, getFileHash, watchFile } from './plugin.js';
export type { BaseContext, PluginBaseLifecycle, MaybePromise } from './plugin.js';

// ── Feature ──
export { Feature } from './feature.js';
export type { FeatureJSON, FeatureListener } from './feature.js';

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

// ── Extension Registry ──
export { registerExtension, unregisterExtensions, getExtension, hasExtension, installExtensionProxy } from './extension-registry.js';

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
