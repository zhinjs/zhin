import { randomUUID } from 'node:crypto';
import { readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { parseCron } from '@zhin.js/schedule';
import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';

const CRON_KINDS = new Set(['solar', 'lunar', 'workday', 'freeDay']);
const NOTIFY_CHANNELS = new Set(['im', 'silent', 'log']);
const DISABLED = 'assistant.enabled is false';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Validates the operator job body and rebuilds it from known fields only. */
export function parseAssistantJobInput(
  body: unknown,
  now = Date.now(),
): { job: Record<string, unknown> } | { error: string } {
  const data = record(body);
  const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
  if (!prompt) return { error: 'prompt is required' };
  const channel = record(data.notify).channel ?? 'silent';
  if (typeof channel !== 'string' || !NOTIFY_CHANNELS.has(channel)) {
    return { error: 'notify.channel must be im | silent | log' };
  }
  const input = record(data.schedule);
  let schedule: Record<string, unknown>;
  if (input.kind === 'at') {
    const atMs = input.atMs;
    if (typeof atMs !== 'number' || !Number.isSafeInteger(atMs) || atMs <= now) {
      return { error: 'schedule.atMs must be a future timestamp' };
    }
    schedule = { kind: 'at', atMs, deleteAfterRun: true };
  } else if (input.kind === 'every') {
    const everyMs = input.everyMs;
    if (typeof everyMs !== 'number' || !Number.isSafeInteger(everyMs) || everyMs < 1000) {
      return { error: 'schedule.everyMs must be an integer >= 1000' };
    }
    schedule = { kind: 'every', everyMs };
  } else if (typeof input.kind === 'string' && CRON_KINDS.has(input.kind)) {
    const cron = typeof input.cron === 'string' ? input.cron.trim() : '';
    try {
      parseCron(cron);
    } catch (error) {
      return { error: `Cron 表达式无效: ${error instanceof Error ? error.message : String(error)}` };
    }
    schedule = { kind: input.kind, cron };
  } else {
    return { error: 'schedule.kind must be solar | lunar | workday | freeDay | every | at' };
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
  ): Parameters<HttpHost['route']>[2] => async (request, response, _url, authScope) => {
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '需要 full scope 才能修改调度任务' });
      return;
    }
    const body = await readJsonBody(request);
    const handled = await withGenerationAgentConsole(snapshots, async ({ assistant }) => {
      if (!assistant) {
        writeJson(response, 404, { success: false, error: DISABLED });
        return;
      }
      try {
        const result = await operation(assistant.jobs, body);
        writeJson(response, result.status, result.body);
      } catch (error) {
        writeJson(response, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 404, { success: false, error: DISABLED });
  };

  http.route('POST', `${base}/assistant/jobs`, guarded(async (jobs, body) => {
    const parsed = parseAssistantJobInput(body);
    if ('error' in parsed) return { status: 400, body: { success: false, error: parsed.error } };
    return { status: 201, body: { success: true, data: { job: await jobs.add(parsed.job) } } };
  }), { summary: 'Add an assistant job', tags: ['assistant'] });

  for (const action of ['remove', 'pause', 'resume'] as const) {
    http.route('POST', `${base}/assistant/jobs/${action}`, guarded(async (jobs, body) => {
      const id = record(body).id;
      if (typeof id !== 'string' || !id.trim()) {
        return { status: 400, body: { success: false, error: 'id is required' } };
      }
      const found = await jobs[action](id.trim());
      return found
        ? { status: 200, body: { success: true, data: { id: id.trim() } } }
        : { status: 404, body: { success: false, error: `任务不存在: ${id.trim()}` } };
    }), { summary: `${action} an assistant job`, tags: ['assistant'] });
  }
}
