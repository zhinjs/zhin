/**
 * CLI 侧调度任务形状（与 @zhin.js/agent ScheduleJob 对齐）
 */
export type JobNotifyCli =
  | { channel: 'im'; platform?: string; endpointKey?: string; senderId?: string; sceneId?: string; scope?: string }
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

export function parseNotifyChannel(channel: string): JobNotifyCli {
  const ch = channel.trim().toLowerCase();
  if (ch === 'im') return { channel: 'im' };
  if (ch === 'log') return { channel: 'log' };
  if (ch === 'silent') return { channel: 'silent' };
  throw new Error(`notify channel 无效: ${channel}，可选 im | silent | log`);
}

/** 将 5 段 cron 规范为 6 段（前置秒字段 0） */
export function normalizeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) return `0 ${expr.trim()}`;
  if (parts.length === 6) return expr.trim();
  throw new Error(`cron 须为 5 或 6 段，当前 ${parts.length} 段`);
}
