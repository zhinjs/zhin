import { parseCron } from '@zhin.js/schedule';
import type { ConsoleRpcExtendedCtx, ConsoleScheduleEngine, ExtendedRpcResult, ScheduleJobRow } from './contracts.js';
import { errorMessage, strField } from './rpc-values.js';

const CRON_NOT_WIRED =
  '持久化调度未接线：当前 Plugin Runtime ScheduleHost 仅支持插件注册的内存任务（list），' +
  '不支持 add/remove/pause/resume（需要 @zhin.js/agent 持久化调度引擎）';

/** `titleI18n[locale]` → `titleI18n[language]` → `title`. */
function localizedTitle(job: ScheduleJobRow, locale: string | undefined): string | undefined {
  const map = job.titleI18n && typeof job.titleI18n === 'object' ? job.titleI18n : undefined;
  if (locale && map) {
    const exact = map[locale];
    if (typeof exact === 'string' && exact.trim()) return exact.trim();
    const language = locale.split('-')[0]!;
    const byLanguage = map[language];
    if (typeof byLanguage === 'string' && byLanguage.trim()) return byLanguage.trim();
  }
  return typeof job.title === 'string' && job.title.trim() ? job.title.trim() : undefined;
}

function lastRunFields(job: ScheduleJobRow): Record<string, unknown> {
  const run = job.lastRun;
  if (!run || typeof run !== 'object' || typeof run.startedAt !== 'number') return {};
  return {
    lastExecutedAt: run.startedAt,
    ...(typeof run.finishedAt === 'number' ? { lastFinishedAt: run.finishedAt, lastDurationMs: Math.max(0, run.finishedAt - run.startedAt) } : {}),
    lastStatus: run.status === 'failed' ? 'failed' : 'succeeded',
    ...(run.status === 'failed' && typeof run.error === 'string' ? { lastError: run.error } : {}),
  };
}

export function listSchedule(ctx: ConsoleScheduleListCtx, d: Record<string, unknown> = {}): Promise<ExtendedRpcResult> | ExtendedRpcResult {
  const locale = typeof d.locale === 'string' && d.locale.trim() ? d.locale.trim() : undefined;
  const host = ctx.scheduleHost as { list?: () => unknown } | undefined;
  if (!host || typeof host.list !== 'function') {
    return { error: '调度服务未配置（scheduleHost 未挂载）' };
  }
  try {
    const raw = host.list();
    const memory: ScheduleJobRow[] = (Array.isArray(raw) ? raw : [])
      .filter((job): job is ScheduleJobRow =>
        !!job && typeof job === 'object'
        && typeof (job as ScheduleJobRow).id === 'string'
        && typeof (job as ScheduleJobRow).cron === 'string')
      .map((job) => {
        const title = localizedTitle(job, locale);
        return {
        id: job.id,
        cron: job.cron,
        ...(typeof job.description === 'string' ? { description: job.description } : {}),
        // #1250: plugin polling is not a user reminder; title is localized, displayName never falls back to a bare id when a title exists.
        kind: job.kind === 'user-task' ? 'user-task' : 'plugin-internal',
        ...(title ? { title } : {}),
        ...(job.titleI18n && typeof job.titleI18n === 'object' ? { titleI18n: job.titleI18n } : {}),
        displayName: title ?? (typeof job.description === 'string' && job.description ? job.description : job.id),
        ...lastRunFields(job),
        // console cron 页渲染字段（由 schedule host 提供时透传）
        expression: (job as { expression?: string }).expression ?? job.cron,
        running: (job as { running?: boolean }).running ?? true,
        ...((job as { plugin?: string }).plugin ? { plugin: (job as { plugin?: string }).plugin } : {}),
        ...((job as { nextExecution?: number }).nextExecution
          ? { nextExecution: (job as { nextExecution?: number }).nextExecution } : {}),
        };
      });
    // `agents` (#1250 b52): the Agents a persistent job may run on, for the task form's choice.
    const agents = ctx.resolveScheduleEngine?.()?.listAgents?.();
    return listPersistentJobs(ctx, agents).then((persistent) => ({ data: { memory, persistent,
      ...(agents ? { agents: [...agents] } : {}),
      capabilities: { persistent: !!ctx.resolveScheduleEngine?.() && ctx.fullScope } } })).catch((error) => ({ error: errorMessage(error) }));
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

type ConsoleScheduleListCtx = ConsoleRpcExtendedCtx;

/** 持久化任务（Agent Host ScheduleJobEngine）→ 前端 PersistentCron 形状。 */
async function listPersistentJobs(
  ctx: ConsoleRpcExtendedCtx,
  agents?: readonly string[],
): Promise<Record<string, unknown>[]> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return [];
  try {
    const jobs = await engine.listJobs();
    return jobs.map((job) => ({
      id: job.id,
      label: job.label ?? job.id,
      cronExpression: (job.schedule as { cron?: string } | undefined)?.cron ?? '',
      prompt: (job.action as { prompt?: string } | undefined)?.prompt ?? '',
      // #1250 b52: the Agent the job runs on; absent = the default Agent.
      ...((job.action as { agent?: unknown } | undefined)?.agent
        ? { agent: (job.action as { agent?: string }).agent } : {}),
      // The job names an Agent that is no longer configured: its runs fail until it is changed.
      ...(agentMissing(job, agents) ? { agentMissing: true } : {}),
      enabled: job.enabled !== false,
      source: job.source ?? 'manual',
      // Persistent jobs are created by a person or on their behalf by the Agent.
      kind: 'user-task',
      createdAt: (job as { createdAt?: number }).createdAt,
      nextExecution: (job.state as { nextRunAtMs?: number } | undefined)?.nextRunAtMs,
      ...((job.notify as { target?: unknown } | undefined)?.target
        ? { context: { target: (job.notify as { target?: unknown }).target } } : {}),
      // #1250: the resolved delivery target; `resolved: false` = results cannot be delivered.
      ...(ctx.describeScheduleTarget ? { target: ctx.describeScheduleTarget(job.notify) } : {}),
      lastExecutedAt: (job.state as { lastExecutedAt?: number } | undefined)?.lastExecutedAt,
      lastStatus: (job.state as { lastStatus?: string } | undefined)?.lastStatus,
    }));
  } catch (error) {
    throw new Error(`读取持久化任务失败: ${errorMessage(error)}`);
  }
}

/**
 * Whether a job's `action.agent` is absent from the configured Agents (#1250 b52): deleted from
 * `ai.agents` after the job was created. Unknown when the engine does not list its Agents.
 */
function agentMissing(job: Record<string, unknown>, agents: readonly string[] | undefined): boolean {
  const agent = (job.action as { agent?: unknown } | undefined)?.agent;
  return typeof agent === 'string' && !!agent && !!agents && !agents.includes(agent);
}

/** The account (`adapter` / `endpoint`) a schedule delivery target sends from, if it names one. */
function deliveryAccount(target: unknown): { adapter: string; endpoint: string } | undefined {
  if (typeof target === 'string') {
    // `<adapter>:<endpoint>:<kind>:<id>`
    const [adapter, endpoint] = target.split(':');
    return adapter && endpoint ? { adapter, endpoint } : undefined;
  }
  if (!target || typeof target !== 'object') return undefined;
  const scene = (target as { scene?: unknown }).scene;
  if (!scene || typeof scene !== 'object') return undefined;
  const { platform, endpointKey } = scene as { platform?: unknown; endpointKey?: unknown };
  return typeof platform === 'string' && platform && typeof endpointKey === 'string' && endpointKey
    ? { adapter: platform, endpoint: endpointKey }
    : undefined;
}

/**
 * A delivery target sends to that account on every run: `endpoint.operate` there, like
 * `/message/send`, on top of `ops.schedule.write` (absent check = trusted in-process caller).
 * Refusal: `data.code = 'schedule_target_forbidden'`, `data.status = 403`.
 */
function deliveryForbidden(target: unknown, ctx: ConsoleRpcExtendedCtx): ExtendedRpcResult | undefined {
  if (!target || !ctx.canOperateEndpoint) return undefined;
  const account = deliveryAccount(target);
  if (account && ctx.canOperateEndpoint(account.adapter, account.endpoint)) return undefined;
  return {
    error: account
      ? `没有向该账号投递的权限：需要 ${account.adapter} / ${account.endpoint} 上的 endpoint.operate`
      : '投递目标需要指明账号（scene.platform 与 scene.endpointKey）',
    data: { code: 'schedule_target_forbidden', status: 403 },
  };
}

export async function addCron(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  const cronExpression = String(d.cronExpression ?? '').trim();
  const prompt = String(d.prompt ?? '').trim();
  if (!cronExpression) return { error: 'cronExpression is required' };
  if (!prompt) return { error: 'prompt is required' };
  try {
    parseCron(cronExpression);
  } catch (error) {
    return { error: `Cron 表达式无效: ${errorMessage(error)}` };
  }
  const label = typeof d.label === 'string' && d.label.trim() ? d.label.trim() : undefined;
  const agent = scheduleAgentField(d.agent, engine);
  if ('error' in agent) return { error: agent.error };
  const context = (d.context ?? {}) as Record<string, unknown>;
  const target = context.target ?? context.channel;
  const forbidden = deliveryForbidden(target, ctx);
  if (forbidden) return forbidden;
  const job = {
    id: `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...(label ? { label } : {}),
    enabled: true,
    schedule: { kind: 'solar', cron: cronExpression },
    action: { kind: 'agent', prompt, ...(agent.agent ? { agent: agent.agent } : {}) },
    notify: target
      ? { channel: 'im', target }
      : { channel: 'silent' },
    source: 'manual',
  };
  try {
    const created = await engine.addJob(job);
    return { data: { job: created, success: true } };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

const DEFAULT_AGENT = 'zhin';

/**
 * `agent` of a job (#1250 b52): absent / `null` / empty = the default Agent; otherwise one of the
 * engine's configured Agents, else an error naming them. An engine without `listAgents` (older
 * Agent package) only accepts the default.
 */
function scheduleAgentField(value: unknown, engine: ConsoleScheduleEngine): { agent?: string } | { error: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { error: 'agent 必须是 Agent 名称' };
  const name = value.trim();
  if (!name) return {};
  const available = engine.listAgents?.() ?? [DEFAULT_AGENT];
  if (available.includes(name)) return { agent: name };
  return { error: `Agent 不存在：${name}。可用的 Agent：${(available.length ? available : [DEFAULT_AGENT]).join('、')}` };
}

/** `cron:set-agent` (#1250 b52): `{ id, agent }`, `agent: null` = back to the default Agent. */
export async function setCronAgent(
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  if (!engine.setJobAgent) return { error: '运行中的 Agent 包不支持修改任务的 Agent', data: { code: 'unsupported' } };
  const id = String(d.id ?? '').trim();
  if (!id) return { error: 'id is required' };
  if (!('agent' in d)) return { error: 'agent is required (null clears it)' };
  const agent = scheduleAgentField(d.agent, engine);
  if ('error' in agent) return { error: agent.error };
  try {
    const existing = (await engine.listJobs()).find(job => job.id === id);
    if (!existing) return { error: `任务不存在: ${id}` };
    if ((existing.action as { kind?: unknown } | undefined)?.kind !== 'agent') {
      return { error: `心跳任务不能指定 Agent: ${id}`, data: { code: 'schedule_agent_heartbeat' } };
    }
    // The job keeps delivering to its target on every run, now on another Agent: the same
    // `endpoint.operate` `cron:add` requires for that target.
    const notify = existing.notify as { channel?: unknown; target?: unknown } | undefined;
    const forbidden = deliveryForbidden(notify?.channel === 'im' ? notify.target : undefined, ctx);
    if (forbidden) return forbidden;
    const job = await engine.setJobAgent(id, agent.agent);
    return job ? { data: { job, success: true } } : { error: `任务不存在: ${id}` };
  } catch (error) {
    // A profile routine (`schedule_agent_profile`) is changed in the Assistant Profile instead.
    const code = (error as { code?: unknown } | null)?.code;
    return { error: errorMessage(error), ...(typeof code === 'string' && code.startsWith('schedule_agent_') ? { data: { code } } : {}) };
  }
}

export async function mutateCron(
  type: 'cron:remove' | 'cron:pause' | 'cron:resume',
  d: Record<string, unknown>,
  ctx: ConsoleRpcExtendedCtx,
): Promise<ExtendedRpcResult> {
  const engine = ctx.resolveScheduleEngine?.();
  if (!engine) return { error: CRON_NOT_WIRED };
  const id = String(d.id ?? '').trim();
  if (!id) return { error: 'id is required' };
  try {
    const ok = type === 'cron:remove'
      ? await engine.removeJob(id)
      : type === 'cron:pause'
        ? await engine.pauseJob(id)
        : await engine.resumeJob(id);
    return ok ? { data: { success: true } } : { error: `任务不存在: ${id}` };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------- inbox

/** Uses the same parser as the persistent schedule engine; never creates a job. */
export function validateCron(d: Record<string, unknown>): ExtendedRpcResult {
  try {
    parseCron(String(d.cronExpression ?? '').trim());
    return { data: { valid: true } };
  } catch (error) {
    return { data: { valid: false, error: errorMessage(error) } };
  }
}
