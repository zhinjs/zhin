import { randomUUID } from 'node:crypto';
import { readJsonBody, principalAllows, type ConsolePrincipal, type HttpHost, jsonResponse } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseCron } from '@zhin.js/schedule';
import { withGenerationAgentConsole } from './agent-console.js';
import type { ConsoleApiErrorCode } from '@zhin.js/console-protocol';
import { expectedErrorResponse, internalErrorResponse } from './internal-error.js';
import { describeScheduleTarget, parseScheduleTargetSpec, type ScheduleEndpointLookup } from './schedule-target.js';

const CRON_KINDS = new Set(['solar', 'lunar', 'workday', 'freeDay']);
const NOTIFY_CHANNELS = new Set(['im', 'silent', 'log']);
const DISABLED = 'assistant.enabled is false';
/** Rejected job body: a stable code and a user-facing (Chinese) explanation (#1250). */
export interface AssistantJobInputError { readonly error: string; readonly code: AssistantJobInputErrorCode }
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
  | 'schedule_target_forbidden';

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

/** Validates the operator job body and rebuilds it from known fields only. */
export function parseAssistantJobInput(
  body: unknown,
  now = Date.now(),
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
  const input = record(data.schedule);
  let schedule: Record<string, unknown>;
  if (input.kind === 'at') {
    const atMs = input.atMs;
    if (typeof atMs !== 'number' || !Number.isSafeInteger(atMs) || atMs <= now) {
      return invalidInput('执行时间（schedule.atMs）必须是未来的时间');
    }
    schedule = { kind: 'at', atMs, deleteAfterRun: true };
  } else if (input.kind === 'every') {
    const everyMs = input.everyMs;
    if (typeof everyMs !== 'number' || !Number.isSafeInteger(everyMs) || everyMs < 1000) {
      return invalidInput('执行间隔（schedule.everyMs）必须是不小于 1000 的整数毫秒');
    }
    schedule = { kind: 'every', everyMs };
  } else if (typeof input.kind === 'string' && CRON_KINDS.has(input.kind)) {
    const cron = typeof input.cron === 'string' ? input.cron.trim() : '';
    try {
      parseCron(cron);
    } catch (error) {
      return invalidInput(`Cron 表达式无效: ${error instanceof Error ? error.message : String(error)}`);
    }
    schedule = { kind: input.kind, cron };
  } else {
    return invalidInput('计划类型（schedule.kind）只能是 solar | lunar | workday | freeDay | every | at');
  }
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : undefined;
  return {
    job: {
      id: `sched_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
      ...(label ? { label } : {}),
      enabled: true,
      schedule,
      action: { kind: 'agent', prompt },
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
      },
      body: unknown,
      principal: ConsolePrincipal | undefined,
    ) => Promise<{ status: number; body: unknown }>,
  ): Parameters<HttpHost['route']>[2] => async (request, context) => {
    const body = await readJsonBody(request);
    const handled = await withGenerationAgentConsole(snapshots, async ({ assistant }) => {
      if (!assistant) {
        return expectedErrorResponse(404, 'unavailable', DISABLED);
      }
      try {
        const result = await operation(assistant.jobs, body, context.principal);
        return jsonResponse(result.status, result.body);
      } catch (error) {
        return internalErrorResponse(500, 'assistant_job_failed', error);
      }
    });
    return handled ?? expectedErrorResponse(404, 'unavailable', DISABLED);
  };

  http.route('POST', `${base}/assistant/jobs`, guarded(async (jobs, body, principal) => {
    const parsed = parseAssistantJobInput(body);
    if ('error' in parsed) {
      return { status: 400, body: { success: false, error: parsed.error, code: parsed.code } };
    }
    const job = parsed.job;
    const notify = record(job.notify);
    if (notify.channel === 'im') {
      // An explicit target delivers to that account on every run: the same `endpoint.operate` the
      // operator would need to `/message/send` there, on top of `ops.schedule.write`. The instance
      // default target is the owner's configuration and needs no extra grant.
      if (notify.target && !mayDeliverTo(principal, notify.target)) {
        const scene = record(record(notify.target).scene);
        return { status: 403, body: { success: false, code: 'schedule_target_forbidden',
          error: `没有向该账号投递的权限：需要 ${String(scene.platform)} / ${String(scene.endpointKey)} 上的 endpoint.operate` } };
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
    http.route('POST', `${base}/assistant/jobs/${action}`, guarded(async (jobs, body) => {
      const id = record(body).id;
      if (typeof id !== 'string' || !id.trim()) {
        return { status: 400, body: { success: false, code: 'invalid_argument', error: '缺少任务 ID（id）' } };
      }
      const found = await jobs[action](id.trim());
      return found
        ? { status: 200, body: { success: true, data: { id: id.trim() } } }
        : { status: 404, body: { success: false, code: 'not_found', error: `任务不存在: ${id.trim()}` } };
    }), { summary: `${action} an assistant job`, tags: ['assistant'] });
  }
}
