import { randomUUID } from 'node:crypto';
import { readJsonBody, principalAllows, type ConsolePrincipal, type HttpHost, jsonResponse } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseCron } from '@zhin.js/schedule';
import { agentConsoleDisabledReason, withGenerationAgentConsole } from './agent-console.js';
import { consoleFeatureDisabled, type ConsoleApiErrorCode, type ConsoleFeatureDisabledReason } from '@zhin.js/console-protocol';
import { expectedErrorResponse, internalErrorResponse } from './internal-error.js';
import { describeScheduleTarget, parseScheduleTargetSpec, type ScheduleEndpointLookup } from './schedule-target.js';

/** Lower-cased spelling → canonical calendar kind: matched case-insensitively, like `schedule_update` (#1250 b90). */
const CRON_KINDS = new Map([
  ['solar', 'solar'], ['lunar', 'lunar'], ['workday', 'workday'], ['freeday', 'freeDay'], ['holiday', 'holiday'],
]);
const SCHEDULE_KIND_LIST = 'solar | lunar | workday | freeDay | holiday | every | at';

/**
 * `buildCronJobSchedule` of `@zhin.js/agent` (#1250 b90 review): the calendar schedule built and
 * evaluated exactly like `schedule_update` does it. Loaded on first use (the Agent package is an
 * optional peer; these routes only run while its assistant is live); `undefined` from an older
 * Agent package without it, which keeps the cron syntax check below.
 */
type CronScheduleBuilder = (
  input: Readonly<{ kind?: string; cron?: string }>,
  current?: Record<string, unknown>,
) => Record<string, unknown> | { error: string; code: string };
let cronScheduleBuilder: Promise<CronScheduleBuilder | undefined> | undefined;
function loadCronScheduleBuilder(): Promise<CronScheduleBuilder | undefined> {
  cronScheduleBuilder ??= import('@zhin.js/agent').then(
    (agent) => {
      const build = (agent as { buildCronJobSchedule?: unknown }).buildCronJobSchedule;
      return typeof build === 'function' ? build as CronScheduleBuilder : undefined;
    },
    () => {
      // Not cached: a failed load is retried on the next request.
      cronScheduleBuilder = undefined;
      return undefined;
    },
  );
  return cronScheduleBuilder;
}

/** A refused calendar schedule: `schedule_invalid` when the cron cannot be evaluated for its kind. */
function cronScheduleError(built: { error: string; code: string }): AssistantJobInputError {
  return { error: built.error, code: built.code === 'schedule_invalid' ? 'schedule_invalid' : 'invalid_argument' };
}

const WARNING_NO_NEXT_RUN = '任务已启用，但按新计划算不出下次运行时间，它不会自动执行；请检查 cron 或改用其他计划';
const NOTIFY_CHANNELS = new Set(['im', 'silent', 'log']);
/** Legacy error string of a disabled assistant; `zhin schedule` (older CLIs too) matches it. */
export const ASSISTANT_DISABLED_ERROR = 'assistant.enabled is false';

/**
 * 404 `unavailable` for a job write while the feature is off: the legacy `error` string plus
 * `data: ConsoleFeatureDisabled` naming why (#1250).
 */
export function assistantDisabledWriteResponse(reason: ConsoleFeatureDisabledReason): Response {
  return expectedErrorResponse(404, 'unavailable', ASSISTANT_DISABLED_ERROR, consoleFeatureDisabled(reason));
}
/** Rejected job body: a stable code and a user-facing (Chinese) explanation (#1250). */
export interface AssistantJobInputError {
  readonly error: string;
  readonly code: AssistantJobInputErrorCode;
  /** `schedule_agent_not_found` (#1250 b55): `{ code, agent, available }`. */
  readonly data?: Readonly<Record<string, unknown>>;
}
const invalidInput = (error: string): AssistantJobInputError => ({ error, code: 'invalid_argument' });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Error codes of a rejected job body (`code` of the 400 / 403 response): the shared
 * {@link ConsoleApiErrorCode}s (`notify_target_missing`: IM delivery with neither an explicit nor a
 * default target), plus the schedule-target codes of this route.
 */
export type AssistantJobInputErrorCode =
  | Extract<ConsoleApiErrorCode, 'invalid_argument' | 'notify_target_missing'>
  | 'schedule_target_invalid'
  | 'schedule_target_not_found'
  | 'schedule_target_forbidden'
  | 'schedule_agent_not_found'
  | 'schedule_agent_heartbeat'
  | 'schedule_agent_profile'
  /** #1250 b90 review: a cron its calendar kind cannot evaluate (e.g. workday with `1-5` or `30 2`). */
  | 'schedule_invalid';

const DEFAULT_AGENT = 'zhin';

/**
 * `agent` of a job body (#1250 b52): absent / `null` / empty = the default Agent; otherwise one of
 * `available` (the configured bindings), else `schedule_agent_not_found` naming the usable ones (also as `data.agent` / `data.available`).
 */
export function parseScheduleAgentField(
  value: unknown,
  available: readonly string[],
): { agent?: string } | AssistantJobInputError {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return invalidInput('Agent（agent）必须是 Agent 名称');
  const name = value.trim();
  if (!name) return {};
  if (available.includes(name)) return { agent: name };
  const listed = available.length ? [...available] : [DEFAULT_AGENT];
  return {
    code: 'schedule_agent_not_found',
    error: `Agent 不存在：${name}。可用的 Agent：${listed.join('、')}`,
    data: Object.freeze({ code: 'schedule_agent_not_found', agent: name, available: listed }),
  };
}

/**
 * Longest delay of a one-shot (`at`) job: 365 days, the same 365-day bound as the Agent's schedule
 * tools. It also keeps `atMs` far below the largest `Date` (8.64e15). `zhin schedule` checks the same
 * bound locally (`MAX_SCHEDULE_AT_DELAY_MS` in `basic/cli/src/commands/schedule.ts`; the CLI may not
 * import this module), so change both together (#1250).
 */
export const MAX_SCHEDULE_AT_DELAY_MS = 365 * 24 * 60 * 60_000;

const TARGET_REQUIRED = '投递渠道为 im 时需要指定投递目标：zhin schedule add --target <adapter>:<endpoint>:<kind>:<id>，'
  + '或在 assistant.defaults.notify / assistant.profile.yml 的 defaults.notify 中配置默认目标';

/** `notify.target`: `<adapter>:<endpoint>:<kind>:<id>` or an IM delivery target object. */
function parseTarget(value: unknown): { target?: Record<string, unknown> } | { error: string } {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'string') {
    const parsed = parseScheduleTargetSpec(value);
    return 'error' in parsed ? parsed : { target: parsed.target };
  }
  const scene = record(record(value).scene);
  const text = (field: unknown) => typeof field === 'string' && field.trim() ? field.trim() : undefined;
  const platform = text(scene.platform), endpointKey = text(scene.endpointKey), sceneId = text(scene.sceneId), kind = text(scene.kind);
  if (!platform || !endpointKey || !sceneId || !kind) {
    return { error: 'notify.target.scene 需要 platform、endpointKey、sceneId 与 kind' };
  }
  return { target: { channel: 'im', scene: { platform, endpointKey, sceneId, kind } } };
}

/**
 * `schedule` of a job body: `at` / `every`, or a calendar kind (case-insensitive) with a cron that
 * kind can evaluate (`buildCron`; without it, a cron syntax check only).
 */
function parseScheduleBody(
  input: Record<string, unknown>,
  now: number,
  buildCron?: CronScheduleBuilder,
): { schedule: Record<string, unknown> } | AssistantJobInputError {
  const kind = typeof input.kind === 'string' ? input.kind.trim().toLowerCase() : undefined;
  if (kind === 'at') {
    const atMs = input.atMs;
    if (typeof atMs !== 'number' || !Number.isSafeInteger(atMs) || atMs <= now) {
      return invalidInput('执行时间（schedule.atMs）必须是未来的时间');
    }
    if (atMs - now > MAX_SCHEDULE_AT_DELAY_MS) {
      return invalidInput('执行时间（schedule.atMs）最多是 365 天以后');
    }
    return { schedule: { kind: 'at', atMs, deleteAfterRun: true } };
  }
  if (kind === 'every') {
    const everyMs = input.everyMs;
    if (typeof everyMs !== 'number' || !Number.isSafeInteger(everyMs) || everyMs < 1000) {
      return invalidInput('执行间隔（schedule.everyMs）必须是不小于 1000 的整数毫秒');
    }
    return { schedule: { kind: 'every', everyMs } };
  }
  const cronKind = kind === undefined ? undefined : CRON_KINDS.get(kind);
  if (cronKind) {
    const cron = typeof input.cron === 'string' ? input.cron.trim() : '';
    if (buildCron) {
      const built = buildCron({ kind: cronKind, cron });
      return 'error' in built && typeof built.error === 'string'
        ? cronScheduleError(built as { error: string; code: string })
        : { schedule: built };
    }
    try {
      parseCron(cron);
    } catch (error) {
      return invalidInput(`Cron 表达式无效: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { schedule: { kind: cronKind, cron } };
  }
  return invalidInput(`计划类型（schedule.kind）只能是 ${SCHEDULE_KIND_LIST}`);
}

/**
 * `schedule` of `POST /assistant/jobs/update` (#1250 b90), merged with the job's current one: a
 * `cron` without `kind` keeps the job's calendar kind (solar for an `at` / `every` job), a `kind`
 * without `cron` keeps its cron, and a cron job keeps its time zone (and holiday settings).
 */
function parseScheduleUpdateBody(
  input: Record<string, unknown>,
  current: Record<string, unknown>,
  now = Date.now(),
  buildCron?: CronScheduleBuilder,
): { schedule: Record<string, unknown> } | AssistantJobInputError {
  // `at` / `every`, or an unknown kind (refused there).
  if (input.kind !== undefined && (typeof input.kind !== 'string' || !CRON_KINDS.has(input.kind.trim().toLowerCase()))) {
    return parseScheduleBody(input, now, buildCron);
  }
  if (buildCron) {
    // The same construction and evaluation as `schedule_update`: a kept or explicit kind is taken as
    // is, calendar kinds keep only the time of the cron, and a cron that could never fire is a 400.
    const built = buildCron({
      ...(typeof input.kind === 'string' ? { kind: input.kind } : {}),
      ...(typeof input.cron === 'string' && input.cron.trim() ? { cron: input.cron } : {}),
    }, current);
    return 'error' in built && typeof built.error === 'string'
      ? cronScheduleError(built as { error: string; code: string })
      : { schedule: built };
  }
  // Older Agent package: cron syntax only.
  const canonicalKind = typeof input.kind === 'string' ? CRON_KINDS.get(input.kind.trim().toLowerCase()) : undefined;
  const currentCron = typeof current.cron === 'string' ? current.cron : undefined;
  const cron = typeof input.cron === 'string' && input.cron.trim() ? input.cron : currentCron;
  if (!cron) return invalidInput('该任务当前不是 cron 计划：请同时提供 Cron 表达式（schedule.cron）');
  if (input.kind === undefined && current.kind === 'holiday') {
    try {
      parseCron(cron.trim());
    } catch (error) {
      return invalidInput(`Cron 表达式无效: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { schedule: { ...current, cron: cron.trim() } };
  }
  const kind = canonicalKind ?? (typeof current.kind === 'string' && CRON_KINDS.has(current.kind.toLowerCase()) ? current.kind : 'solar');
  const parsed = parseScheduleBody({ kind, cron }, now);
  if ('error' in parsed) return parsed;
  const tz = currentCron !== undefined && typeof current.tz === 'string' ? current.tz : undefined;
  return tz ? { schedule: { ...parsed.schedule, tz } } : parsed;
}

/** Validates the operator job body and rebuilds it from known fields only. */
export function parseAssistantJobInput(
  body: unknown,
  now = Date.now(),
  buildCron?: CronScheduleBuilder,
): { job: Record<string, unknown> } | AssistantJobInputError {
  const data = record(body);
  const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
  if (!prompt) return invalidInput('缺少提示词（prompt）');
  const channel = record(data.notify).channel ?? 'silent';
  if (typeof channel !== 'string' || !NOTIFY_CHANNELS.has(channel)) {
    return invalidInput('投递渠道（notify.channel）只能是 im | silent | log');
  }
  const target = channel === 'im' ? parseTarget(record(data.notify).target) : {};
  if ('error' in target) return { error: target.error, code: 'schedule_target_invalid' };
  const schedule = parseScheduleBody(record(data.schedule), now, buildCron);
  if ('error' in schedule) return schedule;
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : undefined;
  if (data.agent !== undefined && data.agent !== null && typeof data.agent !== 'string') {
    return invalidInput('Agent（agent）必须是 Agent 名称');
  }
  // Checked against the configured Agents by the route (`parseScheduleAgentField`).
  const agent = typeof data.agent === 'string' && data.agent.trim() ? data.agent.trim() : undefined;
  return {
    job: {
      id: `sched_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
      ...(label ? { label } : {}),
      enabled: true,
      schedule: schedule.schedule,
      action: { kind: 'agent', prompt, ...(agent ? { agent } : {}) },
      notify: target.target ? { channel, target: target.target } : { channel },
      source: 'manual',
    },
  };
}

/**
 * Whether the caller may schedule delivery to `target` (`notify.target`): `endpoint.operate` on its
 * account. No principal: an in-process / unauthenticated test Host, trusted like the other routes.
 */
function mayDeliverTo(principal: ConsolePrincipal | undefined, target: unknown): boolean {
  if (!principal) return true;
  const scene = record(record(target).scene);
  const adapter = typeof scene.platform === 'string' ? scene.platform : '';
  const endpoint = typeof scene.endpointKey === 'string' ? scene.endpointKey : '';
  if (!adapter || !endpoint) return false;
  return principalAllows(principal, 'endpoint.operate', Object.freeze({ kind: 'endpoint', adapter, endpoint }));
}

function agentErrorBody(error: AssistantJobInputError): Record<string, unknown> {
  return { success: false, error: error.error, code: error.code, ...(error.data ? { data: error.data } : {}) };
}

function targetForbiddenBody(target: unknown): Record<string, unknown> {
  const scene = record(record(target).scene);
  const adapter = typeof scene.platform === 'string' ? scene.platform : '';
  const endpoint = typeof scene.endpointKey === 'string' ? scene.endpointKey : '';
  // Same wording as the Console RPC side (`deliveryForbidden`): a target without an account names none.
  return { success: false, code: 'schedule_target_forbidden',
    error: adapter && endpoint
      ? `没有向该账号投递的权限：需要 ${adapter} / ${endpoint} 上的 endpoint.operate`
      : '投递目标需要指明账号（scene.platform 与 scene.endpointKey）' };
}

/** Write side of `/assistant/jobs`, used by `zhin schedule`; the live scheduler owns persistence. */
export function registerAssistantJobRoutes(options: Readonly<{
  http: Pick<HttpHost, 'route'>;
  base: string;
  snapshots?: SnapshotReader;
  /** Checks that a target's account exists (`im.endpoints.get`); absent: not checked. */
  endpoints?: ScheduleEndpointLookup;
}>): void {
  const { http, base, snapshots, endpoints } = options;
  const guarded = (
    operation: (
      jobs: {
        add(job: Record<string, unknown>): Promise<Record<string, unknown>>;
        defaultImNotify?(): unknown;
        remove(id: string): Promise<boolean>;
        pause(id: string): Promise<boolean>;
        resume(id: string): Promise<boolean>;
        list?(): Promise<readonly Record<string, unknown>[]>;
        agents?(): readonly string[];
        setAgent?(id: string, agent: string | undefined): Promise<Record<string, unknown> | null>;
        update?(id: string, update: { schedule?: Record<string, unknown>; label?: string | null; enabled?: boolean }): Promise<Record<string, unknown> | null>;
      },
      body: unknown,
      principal: ConsolePrincipal | undefined,
    ) => Promise<{ status: number; body: unknown }>,
  ): Parameters<HttpHost['route']>[2] => async (request, context) => {
    const body = await readJsonBody(request);
    const handled = await withGenerationAgentConsole(snapshots, async ({ assistant }) => {
      if (!assistant) {
        return assistantDisabledWriteResponse('assistant-disabled');
      }
      try {
        const result = await operation(assistant.jobs, body, context.principal);
        return jsonResponse(result.status, result.body);
      } catch (error) {
        return internalErrorResponse(500, 'assistant_job_failed', error);
      }
    });
    return handled ?? assistantDisabledWriteResponse(await agentConsoleDisabledReason(snapshots) ?? 'agent-disabled');
  };

  http.route('POST', `${base}/assistant/jobs`, guarded(async (jobs, body, principal) => {
    const parsed = parseAssistantJobInput(body, Date.now(), await loadCronScheduleBuilder());
    if ('error' in parsed) {
      return { status: 400, body: { success: false, error: parsed.error, code: parsed.code } };
    }
    const job = parsed.job;
    const action = record(job.action);
    if (action.agent !== undefined) {
      const agent = parseScheduleAgentField(action.agent, jobs.agents?.() ?? [DEFAULT_AGENT]);
      if ('error' in agent) return { status: 400, body: agentErrorBody(agent) };
    }
    const notify = record(job.notify);
    if (notify.channel === 'im') {
      // An explicit target delivers to that account on every run: the same `endpoint.operate` the
      // operator would need to `/message/send` there, on top of `ops.schedule.write`. The instance
      // default target is the owner's configuration and needs no extra grant.
      if (notify.target && !mayDeliverTo(principal, notify.target)) {
        return { status: 403, body: targetForbiddenBody(notify.target) };
      }
      // No explicit target: the instance's default IM target (assistant / profile defaults.notify).
      const effective = notify.target ? notify : record(jobs.defaultImNotify?.());
      if (!effective.target) {
        return { status: 400, body: { success: false, error: TARGET_REQUIRED, code: 'notify_target_missing' } };
      }
      const view = describeScheduleTarget(effective, endpoints ?? null);
      if (!view.resolved) {
        const scene = record(record(effective.target).scene);
        return { status: 400, body: { success: false, code: 'schedule_target_not_found',
          error: view.reason === 'endpoint_not_found'
            ? `投递目标的账号不存在：${String(scene.platform)} / ${String(scene.endpointKey)}；用 zhin schedule add --target 指定现有账号的会话`
            : TARGET_REQUIRED } };
      }
      job.notify = { channel: 'im', target: effective.target };
    }
    return { status: 201, body: { success: true, data: { job: await jobs.add(job) } } };
  }), { summary: 'Add an assistant job', tags: ['assistant'] });

  for (const action of ['remove', 'pause', 'resume'] as const) {
    http.route('POST', `${base}/assistant/jobs/${action}`, guarded(async (jobs, body, principal) => {
      const id = record(body).id;
      if (typeof id !== 'string' || !id.trim()) {
        return { status: 400, body: { success: false, code: 'invalid_argument', error: '缺少任务 ID（id）' } };
      }
      if (action === 'resume') {
        // #1250 b55: a resumed job delivers to its explicit target again on every run: the same
        // `endpoint.operate` `POST /assistant/jobs` and `set-agent` require. Pause and remove stop
        // deliveries and need `ops.schedule.write` only. Without `list` a signed-in caller's
        // permission cannot be checked, so only a trusted in-process caller may go on.
        if (!jobs.list && principal) {
          return { status: 404, body: { success: false, code: 'unavailable', error: '运行中的 Agent 包不支持按投递目标检查恢复权限，请升级 @zhin.js/agent' } };
        }
        const existing = (await jobs.list?.())?.find(job => job.id === id.trim());
        if (jobs.list && !existing) {
          return { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id.trim()}` } };
        }
        const notify = record(existing?.notify);
        const target = notify.channel === 'im' ? notify.target : undefined;
        if (target && !mayDeliverTo(principal, target)) return { status: 403, body: targetForbiddenBody(target) };
      }
      const found = await jobs[action](id.trim());
      return found
        ? { status: 200, body: { success: true, data: { id: id.trim() } } }
        : { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id.trim()}` } };
    }), { summary: `${action} an assistant job`, tags: ['assistant'] });
  }

  // #1250 b52: `zhin schedule set-agent` — which Agent a job runs on; `agent: null` clears it.
  http.route('POST', `${base}/assistant/jobs/set-agent`, guarded(async (jobs, body, principal) => {
    const data = record(body);
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    if (!id) return { status: 400, body: { success: false, code: 'invalid_argument', error: '缺少任务 ID（id）' } };
    if (!('agent' in data)) {
      return { status: 400, body: { success: false, code: 'invalid_argument', error: '缺少 Agent（agent）；清除时传 null' } };
    }
    // A signed-in caller's delivery permission is checked against the stored job: without `list`
    // there is nothing to check it against, so only a trusted in-process caller may go on.
    if (!jobs.setAgent || (!jobs.list && principal)) {
      return { status: 404, body: { success: false, code: 'unavailable', error: '运行中的 Agent 包不支持修改任务的 Agent，请升级 @zhin.js/agent' } };
    }
    const agent = parseScheduleAgentField(data.agent, jobs.agents?.() ?? [DEFAULT_AGENT]);
    if ('error' in agent) return { status: 400, body: agentErrorBody(agent) };
    const existing = (await jobs.list?.())?.find(job => job.id === id);
    if (jobs.list && !existing) {
      return { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id}` } };
    }
    if (existing && record(existing.action).kind !== 'agent') {
      // A heartbeat job always runs on the default Agent.
      return { status: 400, body: { success: false, code: 'schedule_agent_heartbeat', error: `心跳任务不能指定 Agent: ${id}` } };
    }
    // The job keeps delivering to its explicit target on every run, now on another Agent: the same
    // `endpoint.operate` `POST /assistant/jobs` requires for that target.
    const notify = record(existing?.notify);
    const target = notify.channel === 'im' ? notify.target : undefined;
    if (target && !mayDeliverTo(principal, target)) return { status: 403, body: targetForbiddenBody(target) };
    let job: Record<string, unknown> | null;
    try {
      job = await jobs.setAgent(id, agent.agent);
    } catch (error) {
      // Refusals of the scheduler (`schedule_agent_heartbeat`, `schedule_agent_profile`: a profile
      // routine is re-declared on every start, so it is changed in the Assistant Profile) are 400s.
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && code.startsWith('schedule_agent_')) {
        return { status: 400, body: { success: false, code, error: error instanceof Error ? error.message : String(error) } };
      }
      throw error;
    }
    return job
      ? { status: 200, body: { success: true, data: { job } } }
      : { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id}` } };
  }), { summary: 'Set the Agent of an assistant job', tags: ['assistant'] });

  // #1250 b90: `zhin schedule update` — the schedule, label and enabled state of a job, in place;
  // its Agent, prompt, delivery target and creator are kept.
  http.route('POST', `${base}/assistant/jobs/update`, guarded(async (jobs, body, principal) => {
    const data = record(body);
    const id = typeof data.id === 'string' ? data.id.trim() : '';
    if (!id) return { status: 400, body: { success: false, code: 'invalid_argument', error: '缺少任务 ID（id）' } };
    if (!jobs.update || !jobs.list) {
      return { status: 404, body: { success: false, code: 'unavailable', error: '运行中的 Agent 包不支持修改任务，请升级 @zhin.js/agent' } };
    }
    const hasSchedule = data.schedule !== undefined && data.schedule !== null;
    if (hasSchedule && (typeof data.schedule !== 'object' || Array.isArray(data.schedule))) {
      return { status: 400, body: { success: false, code: 'invalid_argument', error: '计划（schedule）必须是对象' } };
    }
    if (data.label !== undefined && data.label !== null && typeof data.label !== 'string') {
      return { status: 400, body: { success: false, code: 'invalid_argument', error: '标签（label）必须是字符串；清除时传 null' } };
    }
    if (data.enabled !== undefined && typeof data.enabled !== 'boolean') {
      return { status: 400, body: { success: false, code: 'invalid_argument', error: '启用状态（enabled）必须是 true 或 false' } };
    }
    if (!hasSchedule && data.label === undefined && data.enabled === undefined) {
      return { status: 400, body: { success: false, code: 'invalid_argument', error: '没有要修改的内容：需要 schedule、label 或 enabled' } };
    }
    const existing = (await jobs.list()).find(job => job.id === id);
    if (!existing) return { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id}` } };
    if (existing.source === 'profile') {
      // Re-declared from the Assistant Profile on every start: a change here would be reverted.
      return { status: 400, body: { success: false, code: 'schedule_update_profile',
        error: `任务 ${id} 来自 Assistant Profile（routines），每次启动都会按 Profile 重新声明，在这里修改会被还原。`
          + '请在 Profile 文件（assistant.profile.file，默认 assistant.profile.yml）中修改该 routine' } };
    }
    const update: { schedule?: Record<string, unknown>; label?: string | null; enabled?: boolean } = {};
    if (hasSchedule) {
      const schedule = parseScheduleUpdateBody(record(data.schedule), record(existing.schedule), Date.now(), await loadCronScheduleBuilder());
      if ('error' in schedule) return { status: 400, body: { success: false, error: schedule.error, code: schedule.code } };
      update.schedule = schedule.schedule;
    }
    if (data.label !== undefined) update.label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : null;
    if (data.enabled !== undefined) update.enabled = data.enabled as boolean;
    // A job that stays enabled keeps delivering to its explicit target on every run (at a new time,
    // or again after being disabled): the same `endpoint.operate` `resume` and `set-agent` require.
    const runs = update.enabled ?? existing.enabled === true;
    const notify = record(existing.notify);
    const target = notify.channel === 'im' ? notify.target : undefined;
    if (runs && target && !mayDeliverTo(principal, target)) return { status: 403, body: targetForbiddenBody(target) };
    let job: Record<string, unknown> | null;
    try {
      job = await jobs.update(id, update);
    } catch (error) {
      // The scheduler refuses a schedule it cannot evaluate before changing anything: a 400.
      if ((error as { code?: unknown } | null)?.code === 'schedule_invalid') {
        return { status: 400, body: { success: false, code: 'schedule_invalid', error: `计划无效，任务未修改: ${error instanceof Error ? error.message : String(error)}` } };
      }
      throw error;
    }
    if (!job) return { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id}` } };
    // Enabled but never firing (e.g. a cron date that does not exist): saved, but say so, like the tool.
    const stuck = job.enabled === true && typeof record(job.state).nextRunAtMs !== 'number' && record(job.schedule).kind !== 'event';
    return { status: 200, body: { success: true, data: { job, ...(stuck ? { warning: WARNING_NO_NEXT_RUN } : {}) } } };
  }), { summary: 'Update the schedule, label or enabled state of an assistant job', tags: ['assistant'] });
}
