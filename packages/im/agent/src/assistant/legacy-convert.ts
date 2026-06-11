/**
 * Legacy cron-jobs / scheduler-jobs ↔ AssistantJob 转换
 */
import type { Message } from '@zhin.js/core';
import type { CronJobRecord } from '../cron-engine.js';
import type { AssistantJob, JobAction, JobNotify, JobSchedule } from './types.js';

const HEARTBEAT_PAYLOAD_KIND = 'heartbeat';

export function cronRecordToAssistant(record: CronJobRecord): AssistantJob {
  const now = Date.now();
  return {
    id: record.id,
    label: record.label,
    enabled: record.enabled,
    schedule: { kind: 'cron', expr: record.cronExpression },
    action: { kind: 'agent', prompt: record.prompt },
    notify: record.notify,
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
    state: {
      lastExecutedAt: record.lastExecutedAt,
      lastStatus: record.lastStatus,
      lastError: record.lastError,
    },
    source: 'cron',
  };
}

export function assistantToCronRecord(job: AssistantJob): CronJobRecord | null {
  if (job.schedule.kind !== 'cron' || job.action.kind !== 'agent') return null;
  return {
    id: job.id,
    cronExpression: job.schedule.expr,
    prompt: job.action.prompt,
    label: job.label,
    enabled: job.enabled,
    notify: job.notify,
    createdAt: job.createdAt,
    lastExecutedAt: job.state.lastExecutedAt,
    lastStatus: job.state.lastStatus === 'skipped' ? undefined : job.state.lastStatus,
    lastError: job.state.lastError,
  };
}

export interface LegacySchedulerJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'at' | 'every' | 'cron';
    atMs?: number;
    everyMs?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: string;
    message: string;
    deliver?: boolean;
    channel?: string;
    to?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
  };
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun?: boolean;
}

function schedulerScheduleToJobSchedule(s: LegacySchedulerJob['schedule']): JobSchedule | null {
  if (s.kind === 'cron' && s.expr) return { kind: 'cron', expr: s.expr, tz: s.tz };
  if (s.kind === 'every' && s.everyMs != null && s.everyMs > 0) return { kind: 'every', everyMs: s.everyMs };
  if (s.kind === 'at' && s.atMs != null) return { kind: 'at', atMs: s.atMs, deleteAfterRun: true };
  return null;
}

function schedulerPayloadToAction(payload: LegacySchedulerJob['payload']): JobAction {
  if (payload.kind === HEARTBEAT_PAYLOAD_KIND) {
    return { kind: 'heartbeat', prompt: payload.message };
  }
  return { kind: 'agent', prompt: payload.message };
}

export function schedulerRecordToAssistant(record: LegacySchedulerJob): AssistantJob | null {
  const schedule = schedulerScheduleToJobSchedule(record.schedule);
  if (!schedule) return null;
  const notify: JobNotify = record.payload.deliver && record.payload.channel
    ? {
        channel: 'im',
        platform: record.payload.channel,
        sceneId: record.payload.to,
      }
    : { channel: 'silent' };

  return {
    id: record.id.startsWith('assistant-') ? record.id : `assistant-${record.id}`,
    label: record.name,
    enabled: record.enabled,
    schedule,
    action: schedulerPayloadToAction(record.payload),
    notify,
    createdAt: record.createdAtMs,
    updatedAt: record.updatedAtMs,
    state: {
      nextRunAtMs: record.state?.nextRunAtMs,
      lastExecutedAt: record.state?.lastRunAtMs,
      lastStatus: record.state?.lastStatus as AssistantJob['state']['lastStatus'],
      lastError: record.state?.lastError,
    },
    source: 'scheduler',
  };
}

export function assistantCronJobs(jobs: AssistantJob[]): CronJobRecord[] {
  return jobs
    .map(assistantToCronRecord)
    .filter((j): j is CronJobRecord => j != null);
}

export function isCronSchedulable(job: AssistantJob): boolean {
  return job.schedule.kind === 'cron' && job.enabled;
}

export function jobPrompt(job: AssistantJob): string {
  if (job.action.kind === 'heartbeat') return job.action.prompt;
  return job.action.prompt;
}

/** 从 Message 通讯上下文构建 im notify（cron_add 等） */
export function commMessageToImNotify(message: Message<any>): JobNotify {
  if (!message.$adapter && !message.$endpoint && !message.$channel?.id) {
    return { channel: 'silent' };
  }
  return {
    channel: 'im',
    platform: String(message.$adapter),
    endpointId: message.$endpoint,
    senderId: message.$sender?.id,
    sceneId: message.$channel?.id,
    scope: message.$channel?.type,
  };
}
