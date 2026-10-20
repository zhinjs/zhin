/**
 * Assistant Event Ingress — 请求/响应类型（M2）
 */
import type { JobAction, JobNotify } from './types.js';

export interface AssistantEventRequest {
  /** 幂等键；同 eventId 已存在则跳过重复执行 */
  eventId?: string;
  /** 事件来源，如 homeassistant / script */
  source: string;
  /** 事件类型，如 state_changed */
  type?: string;
  payload?: unknown;
  /** 触发已注册的 Job（cron / event 等） */
  jobId?: string;
  /** 一次性内联 Agent 任务（与 jobId 二选一） */
  action?: JobAction;
  notify?: JobNotify;
  label?: string;
}

export type AssistantEventStatus = 'queued' | 'running' | 'deduped' | 'error';

export interface AssistantEventResult {
  ok: boolean;
  jobId?: string;
  status: AssistantEventStatus;
  deduped?: boolean;
  error?: string;
}
