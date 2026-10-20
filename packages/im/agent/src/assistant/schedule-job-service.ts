import type { ToolInvocationContext } from '@zhin.js/tool';
import type { FestivalName } from '@zhin.js/kernel';
import type { ScheduleJobEngine } from './job-engine.js';
import { parseScheduleJobCreator, scheduleJobCreatorFromPrincipal } from './job-creator.js';
import { parseExecutionPlanFromArgs } from './schedule-execution.js';
import { parseJobNotify } from './notification-router.js';
import { buildJobScheduleFromCronInput } from '../schedule-cron.js';
import type {
  JobNotify,
  JobSchedule,
  ScheduleJob,
  ScheduleJobCreator,
  ScheduleJobExecutionPlan,
} from './types.js';
export function generateScheduleJobId(): string {
  return `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface ScheduleAddInput {
  id?: string;
  label?: string;
  prompt: string;
  schedule: JobSchedule;
  notify: JobNotify;
  source?: ScheduleJob['source'];
  createdBy?: ScheduleJobCreator;
  executionPlan?: ScheduleJobExecutionPlan;
  activityFeedback?: boolean;
  budget?: ScheduleJob['budget'];
  enabled?: boolean;
}

export type ScheduleInvocationContext = Pick<
  ToolInvocationContext,
  'origin' | 'principal' | 'sessionKey'
>;

export async function addScheduleJob(
  engine: ScheduleJobEngine,
  input: ScheduleAddInput,
): Promise<ScheduleJob> {
  const actionPrompt = input.executionPlan?.prompt?.trim() || input.prompt;
  return engine.addJob({
    id: input.id ?? generateScheduleJobId(),
    label: input.label,
    enabled: input.enabled ?? true,
    schedule: input.schedule,
    action: { kind: 'agent', prompt: actionPrompt },
    notify: input.notify,
    source: input.source ?? 'manual',
    createdBy: input.createdBy,
    executionPlan: input.executionPlan,
    activityFeedback: input.activityFeedback || undefined,
    budget: input.budget,
  });
}

function buildScheduleFromRecord(record: Record<string, unknown>): JobSchedule | { error: string } {
  const kind = record.schedule_kind ?? record.scheduleKind;
  const cron = record.cron as string | undefined;
  const delayMin = record.delay_minutes ?? record.delayMinutes;
  const atMsRaw = record.at_ms ?? record.atMs;

  if (String(kind || '').toLowerCase() === 'at' || (typeof delayMin === 'number' && delayMin > 0)) {
    const atMs = typeof delayMin === 'number' && delayMin > 0
      ? Date.now() + delayMin * 60 * 1000
      : atMsRaw != null ? Number(atMsRaw) : undefined;
    if (!atMs) return { error: '请提供 delay_minutes 或 at_ms' };
    return { kind: 'at', atMs, deleteAfterRun: true };
  }

  if (!cron) {
    return { error: '请提供 6 段 cron 表达式（秒 分 时 日 月 周）' };
  }

  const built = buildJobScheduleFromCronInput(
    kind != null ? String(kind) : undefined,
    cron,
    record.tz != null ? String(record.tz) : undefined,
  );
  if ('error' in built) return built;

  if (built.kind === 'holiday') {
    const festivals = record.festivals;
    return {
      ...built,
      festivals: Array.isArray(festivals) ? festivals as FestivalName[] : undefined,
      everyDayOfHoliday: record.every_day_of_holiday === true || record.everyDayOfHoliday === true,
    };
  }

  return built;
}

function resolveNotifyFromToolArgs(
  args: Record<string, unknown>,
  context: ScheduleInvocationContext,
): JobNotify | { error: string } {
  const notifyChannel = String(args.notify_channel || 'im').toLowerCase();
  if (notifyChannel === 'silent') return { channel: 'silent' };
  if (notifyChannel === 'log') return { channel: 'log' };
  if (notifyChannel !== 'im') return { error: `notify_channel 无效: ${notifyChannel}` };
  if (context.origin.kind !== 'im') {
    return { error: 'IM notify requires an IM invocation origin' };
  }
  return {
    channel: 'im',
    target: {
      channel: 'im',
      scene: {
        platform: context.origin.platform,
        endpointKey: context.origin.endpoint,
        sceneId: context.origin.sceneId,
        kind: context.origin.scope,
        senderId: context.principal.subjectId,
      },
      ...(context.origin.threadId ? { threadId: context.origin.threadId } : {}),
    },
  };
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseScheduleBudget(record: Record<string, unknown>): ScheduleJob['budget'] {
  const raw = record.budget && typeof record.budget === 'object'
    ? record.budget as Record<string, unknown>
    : record;
  const maxTokens = positiveNumber(raw.maxTokens ?? raw.max_tokens ?? raw.budget_max_tokens);
  const maxToolCalls = positiveNumber(raw.maxToolCalls ?? raw.max_tool_calls ?? raw.budget_max_tool_calls);
  const timeoutMs = positiveNumber(raw.timeoutMs ?? raw.timeout_ms ?? raw.budget_timeout_ms);
  return maxTokens || maxToolCalls || timeoutMs ? { maxTokens, maxToolCalls, timeoutMs } : undefined;
}

export function parseScheduleNotifyFromRpc(message: Record<string, unknown>): JobNotify {
  const raw = message.notify;
  if (raw && typeof raw === 'object' && raw !== null && 'channel' in raw) {
    return parseJobNotify(raw);
  }
  const ch = String(message.notifyChannel ?? message.notify_channel ?? 'silent').toLowerCase();
  if (ch === 'im') {
    throw new Error('IM notify requires notify.target (IMDeliveryTarget)');
  }
  if (ch === 'log') return { channel: 'log' };
  return { channel: 'silent' };
}

export function parseScheduleAddFromToolArgs(
  args: Record<string, unknown>,
  context: ScheduleInvocationContext,
): ScheduleAddInput | { error: string } {
  const built = buildScheduleFromRecord(args);
  if ('error' in built) return built;

  const prompt = String(args.prompt ?? '');
  if (!prompt.trim()) return { error: '请提供 prompt' };

  const notify = resolveNotifyFromToolArgs(args, context);
  if ('error' in notify) return notify;

  const executionPlan = parseExecutionPlanFromArgs(args, prompt);
  if (executionPlan) executionPlan.confirmed = true;

  return {
    prompt,
    schedule: built,
    notify,
    label: args.label != null ? String(args.label) : undefined,
    source: 'schedule',
    createdBy: scheduleJobCreatorFromPrincipal(context.principal),
    executionPlan,
    activityFeedback: args.activity_feedback === true ? true : undefined,
    budget: parseScheduleBudget(args),
  };
}

export function parseScheduleAddFromRpcMessage(
  message: Record<string, unknown>,
): ScheduleAddInput | { error: string } {
  const built = buildScheduleFromRecord(message);
  if ('error' in built) return built;

  const prompt = String(message.prompt ?? '');
  if (!prompt.trim()) return { error: '缺少 prompt' };

  let notify: JobNotify;
  try {
    notify = parseScheduleNotifyFromRpc(message);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const executionPlan = parseExecutionPlanFromArgs(message, prompt);
  if (executionPlan) executionPlan.confirmed = true;

  return {
    prompt,
    schedule: built,
    notify,
    label: message.label != null ? String(message.label) : undefined,
    source: 'manual',
    createdBy: parseScheduleJobCreator(message.createdBy),
    executionPlan,
    activityFeedback: message.activityFeedback === true ? true : undefined,
    budget: parseScheduleBudget(message),
  };
}
