/**
 * @zhin.js/kernel — 框架无关的运行时内核
 *
 * 提供通用的插件 DI 系统、Feature 抽象、
 * Cron 调度、错误体系和工具函数。
 */

// ── Plugin types ──
export type { PluginLike } from './plugin-types.js';

// ── PluginBase ──
export { PluginBase, pluginStorage } from './plugin.js';
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

// ── Cron ──
export { Cron } from './cron.js';

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
