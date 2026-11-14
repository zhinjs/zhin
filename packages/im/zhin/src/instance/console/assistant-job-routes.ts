import { randomUUID } from 'node:crypto';
import { readJsonBody, type HttpHost, jsonResponse } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseCron } from '@zhin.js/schedule';
import { agentConsoleDisabledReason, withGenerationAgentConsole } from './agent-console.js';
import { consoleFeatureDisabled, type ConsoleApiErrorCode, type ConsoleFeatureDisabledReason } from '@zhin.js/console-protocol';
import { expectedErrorResponse, internalErrorResponse } from './internal-error.js';

const CRON_KINDS = new Set(['solar', 'lunar', 'workday', 'freeDay']);
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
export interface AssistantJobInputError { readonly error: string; readonly code: Extract<ConsoleApiErrorCode, 'invalid_argument' | 'notify_target_missing'> }
const invalidInput = (error: string): AssistantJobInputError => ({ error, code: 'invalid_argument' });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
  if (channel === 'im') {
    // This route only carries the channel; an IM delivery needs a target conversation, which only
    // a job created from a chat has. Accepting it would fail later inside the scheduler.
    return {
      code: 'notify_target_missing',
      error: '投递渠道 im 需要目标会话，这里无法指定：请在聊天里让机器人创建该任务，或改用 log / silent',
    };
  }
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
      notify: { channel },
      source: 'manual',
    },
  };
}

/** Write side of `/assistant/jobs`, used by `zhin schedule`; the live scheduler owns persistence. */
export function registerAssistantJobRoutes(options: Readonly<{
  http: Pick<HttpHost, 'route'>;
  base: string;
  snapshots?: SnapshotReader;
}>): void {
  const { http, base, snapshots } = options;
  const guarded = (
    operation: (
      jobs: {
        add(job: Record<string, unknown>): Promise<Record<string, unknown>>;
        remove(id: string): Promise<boolean>;
        pause(id: string): Promise<boolean>;
        resume(id: string): Promise<boolean>;
      },
      body: unknown,
    ) => Promise<{ status: number; body: unknown }>,
  ): Parameters<HttpHost['route']>[2] => async (request) => {
    const body = await readJsonBody(request);
    const handled = await withGenerationAgentConsole(snapshots, async ({ assistant }) => {
      if (!assistant) {
        return assistantDisabledWriteResponse('assistant-disabled');
      }
      try {
        const result = await operation(assistant.jobs, body);
        return jsonResponse(result.status, result.body);
      } catch (error) {
        return internalErrorResponse(500, 'assistant_job_failed', error);
      }
    });
    return handled ?? assistantDisabledWriteResponse(await agentConsoleDisabledReason(snapshots) ?? 'agent-disabled');
  };

  http.route('POST', `${base}/assistant/jobs`, guarded(async (jobs, body) => {
    const parsed = parseAssistantJobInput(body);
    if ('error' in parsed) return { status: 400, body: { success: false, code: parsed.code, error: parsed.error } };
    return { status: 201, body: { success: true, data: { job: await jobs.add(parsed.job) } } };
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
