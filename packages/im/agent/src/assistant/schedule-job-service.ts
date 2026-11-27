import type { ToolInvocationContext } from '@zhin.js/tool';
import { getNextRun, type FestivalName } from '@zhin.js/kernel';
import { jobScheduleToResolved, type TimerScheduler } from './timer-scheduler.js';
import { parseScheduleJobCreator, scheduleJobCreatorFromPrincipal } from './job-creator.js';
import { parseExecutionPlanFromArgs } from './schedule-execution.js';
import { parseJobNotify } from './notification-router.js';
import { buildJobScheduleFromCronInput, isValidScheduleTimeZone, type CronScheduleKind } from '../schedule-cron.js';
import type {
  JobNotify,
  JobSchedule,
  ScheduleJob,
  ScheduleJobCreator,
  ScheduleJobExecutionPlan,
  ScheduleJobProvenance,
  ScheduleJobUpdate,
} from './types.js';
export function generateScheduleJobId(): string {
  return `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface ScheduleAddInput {
  locale?: import('@zhin.js/plugin-runtime').Locale;
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
  /** Agent the job runs on (`ai.agents` binding name); absent: the default `zhin` (#1250 b52). */
  agent?: string;
  /** ADR 0067 D2.1: set by `schedule_add` from the creating turn; never parsed from tool or RPC input. */
  provenance?: ScheduleJobProvenance;
}

export type ScheduleInvocationContext = Pick<
  ToolInvocationContext,
  'origin' | 'principal' | 'sessionKey' | 'locale'
>;

export async function addScheduleJob(
  engine: TimerScheduler,
  input: ScheduleAddInput,
): Promise<ScheduleJob> {
  const actionPrompt = input.executionPlan?.prompt?.trim() || input.prompt;
  return engine.addJob({
    id: input.id ?? generateScheduleJobId(),
    label: input.label,
    locale: input.locale,
    enabled: input.enabled ?? true,
    schedule: input.schedule,
    action: { kind: 'agent', prompt: actionPrompt, ...(input.agent ? { agent: input.agent } : {}) },
    notify: input.notify,
    // #1250: absent stays absent (see `TimerScheduler.addJob`); deployer paths pass `manual` themselves.
    ...(input.source ? { source: input.source } : {}),
    createdBy: input.createdBy,
    executionPlan: input.executionPlan,
    activityFeedback: input.activityFeedback || undefined,
    budget: input.budget,
    ...(input.provenance ? { provenance: input.provenance } : {}),
  });
}

/**
 * Longest delay of a one-shot job (#1250 b111): 365 days. The scheduler waits past Node's ~24.8-day
 * timer limit in segments, so the bound is a sane date range, checked before anything is saved
 * (a value past it used to be stored first and fail afterwards with a RangeError).
 */
export const MAX_SCHEDULE_DELAY_MINUTES = 365 * 24 * 60;
const MAX_SCHEDULE_DELAY_MS = MAX_SCHEDULE_DELAY_MINUTES * 60_000;
/** Node's timer limit: a longer run budget would fire at once (#1250 b111). */
export const MAX_SCHEDULE_BUDGET_TIMEOUT_MS = 2_147_483_647;

/** `delay_minutes` as a whole number of minutes in 1…{@link MAX_SCHEDULE_DELAY_MINUTES}. */
export function parseScheduleDelayMinutes(value: unknown): number | { error: string } {
  const delay = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(delay) || delay <= 0) {
    return { error: `delay_minutes 必须是大于 0 的整数分钟数，收到: ${String(value)}；任务未保存` };
  }
  if (delay > MAX_SCHEDULE_DELAY_MINUTES) {
    return { error: `delay_minutes 最多 ${MAX_SCHEDULE_DELAY_MINUTES}（365 天），收到: ${delay}；任务未保存` };
  }
  return delay;
}

/** `at_ms` as a future time at most 365 days ahead (#1250 b111). */
function parseScheduleAtMs(value: unknown, now: number): number | { error: string } {
  const atMs = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(atMs) || atMs <= now) {
    return { error: `at_ms 必须是未来时间的毫秒时间戳，收到: ${String(value)}；任务未保存` };
  }
  if (atMs - now > MAX_SCHEDULE_DELAY_MS) {
    return { error: `at_ms 最多是 365 天以后，收到: ${String(value)}；任务未保存` };
  }
  return atMs;
}

function buildScheduleFromRecord(record: Record<string, unknown>): JobSchedule | { error: string } {
  const kind = record.schedule_kind ?? record.scheduleKind;
  const cron = record.cron as string | undefined;
  const delayMin = record.delay_minutes ?? record.delayMinutes;
  const atMsRaw = record.at_ms ?? record.atMs;

  // #1250 b111: any given delay is checked (a negative, fractional or too large one used to be
  // ignored or stored and fail later), before anything is saved.
  // A `0` next to a cron stays "no delay", as before.
  const delayGiven = given(delayMin) && !(given(cron) && Number(delayMin) === 0);
  if (String(kind || '').toLowerCase() === 'at' || delayGiven) {
    const now = Date.now();
    if (delayGiven) {
      const delay = parseScheduleDelayMinutes(delayMin);
      if (typeof delay !== 'number') return delay;
      return { kind: 'at', atMs: now + delay * 60_000, deleteAfterRun: true };
    }
    if (!given(atMsRaw)) return { error: '请提供 delay_minutes 或 at_ms' };
    const atMs = parseScheduleAtMs(atMsRaw, now);
    if (typeof atMs !== 'number') return atMs;
    return { kind: 'at', atMs, deleteAfterRun: true };
  }

  if (!cron) {
    return { error: '请提供 6 段 cron 表达式（秒 分 时 日 月 周）' };
  }

  const built = buildJobScheduleFromCronInput(
    kind != null ? String(kind) : undefined,
    cron,
    record.tz != null ? String(record.tz).trim() : undefined,
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

/** A run budget timeout past Node's timer limit would end every run at once (#1250 b111). */
function scheduleBudgetError(budget: ScheduleJob['budget']): { error: string } | undefined {
  const timeoutMs = budget?.timeoutMs;
  if (timeoutMs === undefined || timeoutMs <= MAX_SCHEDULE_BUDGET_TIMEOUT_MS) return undefined;
  return { error: `budget_timeout_ms 最多 ${MAX_SCHEDULE_BUDGET_TIMEOUT_MS}（约 24.8 天），收到: ${timeoutMs}；任务未保存` };
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

  const budget = parseScheduleBudget(args);
  const budgetError = scheduleBudgetError(budget);
  if (budgetError) return budgetError;

  const executionPlan = parseExecutionPlanFromArgs(args, prompt);
  if (executionPlan) executionPlan.confirmed = true;

  return {
    prompt,
    schedule: built,
    notify,
    label: args.label != null ? String(args.label) : undefined,
    source: 'schedule',
    locale: context.locale,
    createdBy: scheduleJobCreatorFromPrincipal(context.principal, context.origin),
    executionPlan,
    activityFeedback: args.activity_feedback === true ? true : undefined,
    budget,
  };
}

const UPDATE_TIMING_FIELDS = ['schedule_kind', 'cron', 'delay_minutes'] as const;
/** Lower-cased spelling → canonical kind; matched case-insensitively like `schedule_add`. */
const UPDATE_SCHEDULE_KINDS = new Map<string, CronScheduleKind | 'at'>([
  ['solar', 'solar'], ['lunar', 'lunar'], ['workday', 'workday'], ['freeday', 'freeDay'], ['holiday', 'holiday'], ['at', 'at'],
]);
/**
 * Timing inputs `schedule_add` reads but `schedule_update` does not offer: refused instead of
 * silently ignored (an `at_ms` in the past, or a time zone the job does not get).
 */
const UPDATE_UNSUPPORTED_FIELDS = [
  'at_ms', 'atMs', 'tz', 'festivals', 'every_day_of_holiday', 'everyDayOfHoliday', 'scheduleKind', 'delayMinutes',
] as const;

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Whether a cron schedule can be evaluated (#1250 b90): an invalid cron used to be stored, leaving
 * the job `invalid_schedule` while `schedule_update` answered success.
 */
function cronScheduleError(schedule: JobSchedule): string | undefined {
  try {
    const resolved = jobScheduleToResolved(schedule);
    if (!resolved) return `无法解析计划: ${schedule.kind}`;
    getNextRun(resolved, new Date());
    return undefined;
  } catch (error) {
    return `cron 表达式无效: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * The new timing of a `schedule_update` (#1250 b90), merged with the job's current one: a new
 * `cron` keeps the job's calendar kind (and time zone, holiday settings) unless `schedule_kind` is
 * given, and a new `schedule_kind` keeps its cron. `delay_minutes` turns it into a one-shot job.
 */
function buildScheduleUpdate(args: Record<string, unknown>, current: JobSchedule): JobSchedule | { error: string } {
  const kindRaw = given(args.schedule_kind) ? String(args.schedule_kind).trim() : undefined;
  const kindArg = kindRaw === undefined ? undefined : UPDATE_SCHEDULE_KINDS.get(kindRaw.toLowerCase());
  if (kindRaw !== undefined && kindArg === undefined) {
    return { error: `schedule_kind 无效: ${kindRaw}，可选 solar | lunar | workday | freeDay | holiday | at（at 需同时给 delay_minutes）` };
  }
  if (given(args.delay_minutes)) {
    if (given(args.cron) || (kindArg !== undefined && kindArg !== 'at')) {
      return { error: 'delay_minutes（改为一次性任务）不能与 cron 或 schedule_kind 同时提供，请只给其中一种' };
    }
    const delay = parseScheduleDelayMinutes(args.delay_minutes);
    if (typeof delay !== 'number') return delay;
    return { kind: 'at', atMs: Date.now() + delay * 60_000, deleteAfterRun: true };
  }
  if (kindArg === 'at') return { error: '改为一次性任务请提供 delay_minutes（从现在起延迟的分钟数）' };
  const built = buildCronJobSchedule({ kind: kindArg, cron: given(args.cron) ? String(args.cron) : undefined }, current);
  return 'error' in built ? { error: built.error } : built;
}

/** Lower-cased spelling → canonical calendar kind (#1250 b90). */
const CRON_SCHEDULE_KINDS = new Map<string, CronScheduleKind>([
  ['solar', 'solar'], ['lunar', 'lunar'], ['workday', 'workday'], ['freeday', 'freeDay'], ['holiday', 'holiday'],
]);

/** Why `buildCronJobSchedule` refused: a bad input, or a cron the kind cannot evaluate. */
export type CronJobScheduleErrorCode = 'invalid_argument' | 'schedule_invalid';

/**
 * A calendar (cron) schedule built and checked the way `schedule_update` does it (#1250 b90), for
 * the tool and the `POST /assistant/jobs[/update]` routes alike. `kind` is matched case-insensitively
 * (`solar | lunar | workday | freeDay | holiday`); with `current` (an update), a missing `cron` keeps
 * the job's cron, a missing `kind` keeps its calendar kind (and time zone, holiday settings). An
 * explicit or kept kind is taken as is (a solar job given `1-5` stays solar); only without one is a
 * Monday–Friday cron read as workday. Calendar kinds keep only the time of the cron (`0 0 9 * * 1-5`
 * as workday is `0 0 9 * * *`). The result is evaluated like the scheduler evaluates it, so a cron
 * that could never fire is an error, not a stored job.
 */
export function buildCronJobSchedule(
  input: Readonly<{ kind?: string; cron?: string }>,
  current?: JobSchedule,
): JobSchedule | { error: string; code: CronJobScheduleErrorCode } {
  const kindRaw = input.kind?.trim() || undefined;
  const kindArg = kindRaw === undefined ? undefined : CRON_SCHEDULE_KINDS.get(kindRaw.toLowerCase());
  if (kindRaw !== undefined && kindArg === undefined) {
    return { error: `计划类型无效: ${kindRaw}，可选 solar | lunar | workday | freeDay | holiday`, code: 'invalid_argument' };
  }
  const currentCron = current && 'cron' in current ? current : undefined;
  const cron = input.cron?.trim() || currentCron?.cron;
  if (!cron) {
    return {
      error: current
        ? '该任务当前不是 cron 计划：请同时提供 6 段 cron 表达式（秒 分 时 日 月 周）'
        : '请提供 6 段 cron 表达式（秒 分 时 日 月 周）',
      code: 'invalid_argument',
    };
  }
  const kind = kindArg ?? currentCron?.kind;
  // #1250 b99: a zone saved before zones were checked cannot be changed here (`tz` is not an argument).
  if (currentCron?.tz && !isValidScheduleTimeZone(currentCron.tz)) {
    return {
      error: '该任务保存的时区无效，无法修改计划；请删除后重建，或用 delay_minutes 改为一次性任务',
      code: 'schedule_invalid',
    };
  }
  const built = buildJobScheduleFromCronInput(kind, cron, currentCron?.tz, { inferWorkday: kind === undefined });
  if ('error' in built) return { error: built.error, code: 'invalid_argument' };
  const schedule: JobSchedule = built.kind === 'holiday' && current?.kind === 'holiday'
    ? {
        ...built,
        ...(current.festivals ? { festivals: current.festivals } : {}),
        ...(current.everyDayOfHoliday !== undefined ? { everyDayOfHoliday: current.everyDayOfHoliday } : {}),
      }
    : built;
  const invalid = cronScheduleError(schedule);
  return invalid ? { error: invalid, code: 'schedule_invalid' } : schedule;
}

/**
 * `schedule_update` arguments (#1250 b90): the new timing (`cron` / `schedule_kind` /
 * `delay_minutes`), `label` (empty: removed) and `enabled`. Nothing else of the job can be changed
 * here, so its Agent, prompt, delivery target and creator stay as they are. The new timing is
 * validated before anything is written: an invalid cron is an error, not a stored job that never fires.
 */
export function parseScheduleUpdateFromToolArgs(
  args: Record<string, unknown>,
  current: Pick<ScheduleJob, 'schedule'>,
): ScheduleJobUpdate | { error: string } {
  const unsupported = UPDATE_UNSUPPORTED_FIELDS.filter(field => given(args[field]));
  if (unsupported.length > 0) {
    return { error: `schedule_update 不支持参数: ${unsupported.join(', ')}；可用 cron、schedule_kind、delay_minutes、label、enabled` };
  }
  const update: { schedule?: JobSchedule; label?: string | null; enabled?: boolean } = {};
  if (UPDATE_TIMING_FIELDS.some(field => given(args[field]))) {
    const schedule = buildScheduleUpdate(args, current.schedule);
    if ('error' in schedule) return schedule;
    update.schedule = schedule;
  }
  if (args.label !== undefined && args.label !== null) {
    const label = String(args.label).trim();
    update.label = label ? label : null;
  }
  if (args.enabled !== undefined && args.enabled !== null) {
    if (typeof args.enabled !== 'boolean') return { error: 'enabled 必须是 true 或 false' };
    update.enabled = args.enabled;
  }
  if (Object.keys(update).length === 0) {
    return { error: '请至少提供一项修改：cron、schedule_kind、delay_minutes、label 或 enabled' };
  }
  return update;
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

  const budget = parseScheduleBudget(message);
  const budgetError = scheduleBudgetError(budget);
  if (budgetError) return budgetError;

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
    budget,
  };
}
