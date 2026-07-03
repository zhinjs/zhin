/**
 * CLI 侧 schedule-jobs.json 读写（与 @zhin.js/agent ScheduleJobStore 格式对齐）
 */
import fs from 'fs-extra';
import path from 'node:path';

export const SCHEDULE_JOBS_FILENAME = 'schedule-jobs.json';

export type JobNotifyCli =
  | { channel: 'im'; platform?: string; endpointId?: string; senderId?: string; sceneId?: string; scope?: string }
  | { channel: 'silent' }
  | { channel: 'log' };

export type JobScheduleCli =
  | { kind: 'solar'; cron: string; tz?: string }
  | { kind: 'lunar'; cron: string; tz?: string }
  | { kind: 'workday'; cron: string; tz?: string }
  | { kind: 'freeDay'; cron: string; tz?: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'at'; atMs: number; deleteAfterRun?: boolean };

export interface ScheduleJobRecordCli {
  id: string;
  label?: string;
  enabled: boolean;
  schedule: JobScheduleCli;
  action: { kind: 'agent' | 'heartbeat'; prompt: string };
  notify: JobNotifyCli;
  createdAt: number;
  updatedAt: number;
  state: {
    lastExecutedAt?: number;
    lastStatus?: string;
    lastError?: string;
  };
  source?: string;
}

interface ScheduleJobFileCli {
  version: number;
  jobs: ScheduleJobRecordCli[];
}

export function parseNotifyChannel(channel: string): JobNotifyCli {
  const ch = channel.trim().toLowerCase();
  if (ch === 'im') return { channel: 'im' };
  if (ch === 'log') return { channel: 'log' };
  if (ch === 'silent') return { channel: 'silent' };
  throw new Error(`notify channel 无效: ${channel}，可选 im | silent | log`);
}

function getDataDir(cwd = process.cwd()): string {
  return path.join(cwd, 'data');
}

function getScheduleJobsPath(cwd = process.cwd()): string {
  return path.join(getDataDir(cwd), SCHEDULE_JOBS_FILENAME);
}

function requireNotify(raw: unknown, jobId: string): JobNotifyCli {
  const notify = raw as JobNotifyCli | undefined;
  if (!notify || typeof notify !== 'object' || !('channel' in notify)) {
    throw new Error(`job "${jobId}" 缺少 notify`);
  }
  return notify;
}

function parseJob(raw: Record<string, unknown>): ScheduleJobRecordCli {
  const id = String(raw.id);
  const schedule = raw.schedule as JobScheduleCli | undefined;
  const action = raw.action as ScheduleJobRecordCli['action'] | undefined;
  if (!schedule || !action) {
    throw new Error(`schedule-jobs.json: job "${id}" 缺少 schedule 或 action`);
  }
  return {
    id,
    label: raw.label != null ? String(raw.label) : undefined,
    enabled: raw.enabled !== false,
    schedule,
    action,
    notify: requireNotify(raw.notify, id),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    state: (raw.state as ScheduleJobRecordCli['state']) ?? {},
    source: raw.source != null ? String(raw.source) : undefined,
  };
}

export async function readScheduleJobs(cwd = process.cwd()): Promise<ScheduleJobRecordCli[]> {
  const filePath = getScheduleJobsPath(cwd);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as ScheduleJobFileCli;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map((j) => parseJob(j as unknown as Record<string, unknown>));
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return [];
    throw e;
  }
}

export async function writeScheduleJobs(cwd: string, jobs: ScheduleJobRecordCli[]): Promise<void> {
  const filePath = getScheduleJobsPath(cwd);
  await fs.ensureDir(path.dirname(filePath));
  const store: ScheduleJobFileCli = { version: 1, jobs };
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/** 将 5 段 cron 规范为 6 段（前置秒字段 0） */
export function normalizeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) return `0 ${expr.trim()}`;
  if (parts.length === 6) return expr.trim();
  throw new Error(`cron 须为 5 或 6 段，当前 ${parts.length} 段`);
}
