/**
 * Assistant Runtime 配置（应用级，zhin.config.yml 顶层 assistant 块）
 */
import type { AssistantHomeConfig } from './home-config.js';
import type { JobNotify } from './types.js';

export interface AssistantDefaultsConfig {
  /** 未显式指定 notify 时的默认投递目标（M3） */
  notify?: JobNotify;
  /** Job 失败时是否通知（默认 false） */
  notifyOnFailure?: boolean;
}

export interface AssistantEventsConfig {
  /** 启用 POST /api/assistant/events（需 assistant.enabled） */
  enabled?: boolean;
  /**
   * 可选专用 Bearer；未设时复用 http.token（路由仍在 /api 下受全局鉴权保护）。
   */
  token?: string;
  /** 允许的来源白名单；空数组表示不限制 */
  allowedSources?: string[];
  /** 每来源每分钟最大请求数（默认 60） */
  rateLimitPerMinute?: number;
}

export interface AssistantQueueConfig {
  /** Schedule execution 并发上限 */
  maxConcurrency?: number;
  maxRetries?: number;
  defaultTimeoutMs?: number;
}

export interface AssistantConfig {
  /** 启用统一 JobStore（默认 false，Stable 行为不变） */
  enabled?: boolean;
  /** Schedule execution queue（重试 / 并发 / 死信） */
  queue?: AssistantQueueConfig;
  defaults?: AssistantDefaultsConfig;
  profile?: import('./profile-types.js').AssistantProfileConfig;
  home?: AssistantHomeConfig;
  events?: AssistantEventsConfig;
}

export const DEFAULT_EVENTS_CONFIG: Required<Pick<AssistantEventsConfig, 'rateLimitPerMinute'>> = {
  rateLimitPerMinute: 60,
};

export function resolveAssistantQueueConfig(
  raw?: AssistantQueueConfig,
): Required<AssistantQueueConfig> {
  return {
    maxConcurrency: raw?.maxConcurrency ?? 3,
    maxRetries: raw?.maxRetries ?? 2,
    defaultTimeoutMs: raw?.defaultTimeoutMs ?? 120_000,
  };
}

export function resolveAssistantConfig(raw?: AssistantConfig): AssistantConfig & { enabled: boolean } {
  return {
    enabled: raw?.enabled === true,
    queue: raw?.queue,
    defaults: raw?.defaults,
    profile: raw?.profile,
    home: raw?.home,
    events: raw?.events,
  };
}

export function resolveAssistantDefaultsConfig(
  raw?: AssistantDefaultsConfig,
): AssistantDefaultsConfig & { notifyOnFailure: boolean } {
  return {
    notify: raw?.notify,
    notifyOnFailure: raw?.notifyOnFailure === true,
  };
}

export function resolveAssistantEventsConfig(
  raw?: AssistantEventsConfig,
): AssistantEventsConfig & { enabled: boolean; rateLimitPerMinute: number } {
  return {
    enabled: raw?.enabled === true,
    token: raw?.token,
    allowedSources: raw?.allowedSources,
    rateLimitPerMinute: raw?.rateLimitPerMinute ?? DEFAULT_EVENTS_CONFIG.rateLimitPerMinute,
  };
}

export function isAssistantEventsActive(
  assistant?: AssistantConfig,
): boolean {
  const base = resolveAssistantConfig(assistant);
  const events = resolveAssistantEventsConfig(base.events);
  return base.enabled && events.enabled;
}
