/**
 * CLI 侧调度任务形状（与 @zhin.js/agent ScheduleJob 对齐）
 */
export type JobNotifyCli =
  | { channel: 'im'; platform?: string; endpointKey?: string; senderId?: string; sceneId?: string; scope?: string; target?: string | Record<string, unknown> }
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
    nextRunAtMs?: number;
    lastExecutedAt?: number;
    lastStatus?: string;
    lastError?: string;
  };
  source?: string;
  /** Resolved delivery target (Host #1250); `resolved: false` = results cannot be delivered. */
  target?: { resolved: boolean; display?: string; reason?: string };
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

const TARGET_PATTERN = /^[^:\s]+:[^:\s]+:(private|group|channel):\S+$/;

/** `--target <adapter>:<endpoint>:<kind>:<id>`: only with the `im` channel; the Host checks the account. */
export function withNotifyTarget(notify: JobNotifyCli, target: string | undefined): JobNotifyCli {
  if (target === undefined) return notify;
  const spec = target.trim();
  if (notify.channel !== 'im') throw new Error('--target 只能与 --notify-channel im 一起使用');
  if (!TARGET_PATTERN.test(spec)) {
    throw new Error(`--target 格式无效: ${target}，应为 <adapter>:<endpoint>:<kind>:<id>，kind 为 private | group | channel`);
  }
  return { channel: 'im', target: spec };
}

const TARGET_REASONS: Record<string, string> = {
  missing_target: '未设置投递目标',
  incomplete_target: '投递目标不完整',
  endpoint_not_found: '目标账号不存在',
};

/** The resolved target; an unresolved one is flagged so it stands out in the list. */
export function targetSummary(job: Pick<ScheduleJobRecordCli, 'target'>): string | undefined {
  const target = job.target;
  if (!target) return undefined;
  if (target.resolved) return target.display;
  const reason = TARGET_REASONS[target.reason ?? ''] ?? '投递目标无效';
  return `⚠ 无效：${reason}${target.display ? `（${target.display}）` : ''}，结果不会送达`;
}

/** Next run of an enabled job, or a flag when an enabled job has none. */
export function nextRunSummary(job: Pick<ScheduleJobRecordCli, 'enabled' | 'state' | 'schedule'>): string | undefined {
  if (!job.enabled) return undefined;
  const next = job.state?.nextRunAtMs;
  if (typeof next === 'number') return new Date(next).toLocaleString();
  return (job.schedule as { kind?: string }).kind === 'event' ? undefined : '⚠ 无（不会触发）';
}
