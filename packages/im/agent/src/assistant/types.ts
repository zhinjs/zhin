/**
 * Assistant Runtime — 统一 Job 模型（M1）
 */
import type { IMDeliveryTarget } from '@zhin.js/core';

export const ASSISTANT_JOBS_VERSION = 2;
export const ASSISTANT_JOBS_FILENAME = 'assistant-jobs.json';

export type JobSchedule =
  | { kind: 'cron'; expr: string; tz?: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'at'; atMs: number; deleteAfterRun?: boolean }
  | { kind: 'event'; eventId?: string; source?: string; eventType?: string };

export type JobAction =
  | { kind: 'agent'; prompt: string; agent?: string }
  | { kind: 'heartbeat'; prompt: string };

export type JobNotify =
  | { channel: 'im'; target: IMDeliveryTarget }
  | { channel: 'silent' }
  | { channel: 'log' }
  | { channel: 'ha'; service: string; target?: string; data?: Record<string, unknown> };

export interface AssistantJobState {
  lastExecutedAt?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  nextRunAtMs?: number;
  retryCount?: number;
}

export interface AssistantJob {
  id: string;
  label?: string;
  enabled: boolean;
  schedule: JobSchedule;
  action: JobAction;
  notify: JobNotify;
  /** 失败时是否向 notify 通道发送错误摘要（默认跟随 assistant.defaults.notifyOnFailure） */
  notifyOnFailure?: boolean;
  createdAt: number;
  updatedAt: number;
  state: AssistantJobState;
  source?: 'cron' | 'scheduler' | 'manual' | 'event';
  /** 事件载荷（M2 ingress 可选持久化） */
  eventPayload?: unknown;
}

export interface AssistantJobFile {
  version: number;
  jobs: AssistantJob[];
}
