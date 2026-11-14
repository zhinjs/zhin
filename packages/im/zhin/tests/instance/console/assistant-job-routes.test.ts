import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsolePermission } from '@zhin.js/console-protocol';
import type { ConsoleUserPrincipal } from '@zhin.js/host-http';
import { testUser, withTestUsers } from '../utils/console-users.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import {
  parseAssistantJobInput,
  registerAssistantJobRoutes,
} from '../../../src/instance/console/assistant-job-routes.js';

const state = vi.hoisted(() => ({ assistant: undefined as unknown, generation: true }));
vi.mock('../../../src/instance/console/agent-console.js', () => ({
  withGenerationAgentConsole: async (_snapshots: unknown, run: (value: unknown) => Promise<unknown>) => {
    if (!state.generation) return undefined;
    return run({ assistant: state.assistant });
  },
}));

const jobs = {
  add: vi.fn(async (job: Record<string, unknown>) => ({ ...job, createdAt: 1 })),
  remove: vi.fn(async (id: string) => id === 'known'),
  pause: vi.fn(async (id: string) => id === 'known'),
  resume: vi.fn(async (id: string) => id === 'known'),
};
const cleanups: (() => Promise<unknown>)[] = [];
beforeEach(() => { state.assistant = { jobs }; state.generation = true; vi.clearAllMocks(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start() {
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { operator: 'owner', demo: 'none' });
  cleanups.push(() => http.close());
  registerAssistantJobRoutes({ http, base: '/api' });
  const { port } = await http.listen();
  return (path: string, body: unknown, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/assistant/jobs${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

it('adds a validated job through the live scheduler', async () => {
  const post = await start();
  const response = await post('', { label: ' 早报 ', prompt: '汇报', schedule: { kind: 'workday', cron: '0 0 9 * * *' }, notify: { channel: 'log' }, createdBy: { userId: 'forged' } });
  expect(response.status).toBe(201);
  const added = jobs.add.mock.calls[0]![0];
  expect(added).toMatchObject({
    label: '早报', enabled: true, source: 'manual',
    schedule: { kind: 'workday', cron: '0 0 9 * * *' },
    action: { kind: 'agent', prompt: '汇报' }, notify: { channel: 'log' },
  });
  expect(added).not.toHaveProperty('createdBy');
  expect((await response.json()).data.job.id).toBe(added.id);
});

it('rejects invalid job bodies without calling the scheduler', async () => {
  const post = await start();
  for (const body of [
    { schedule: { kind: 'every', everyMs: 60_000 } },
    { prompt: 'x', schedule: { kind: 'solar', cron: 'not a cron' } },
    { prompt: 'x', schedule: { kind: 'every', everyMs: 10 } },
    { prompt: 'x', schedule: { kind: 'at', atMs: 1 } },
    { prompt: 'x', schedule: { kind: 'event' } },
    { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, notify: { channel: 'ha' } },
  ]) {
    expect((await post('', body)).status, JSON.stringify(body)).toBe(400);
  }
  expect(jobs.add).not.toHaveBeenCalled();
});

it('rejects an IM notify without a target as an expected, classified failure (#1250)', async () => {
  const post = await start();
  const response = await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, notify: { channel: 'im' } });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ success: false, code: 'notify_target_missing', error: expect.stringContaining('需要指定投递目标') });
  expect(jobs.add).not.toHaveBeenCalled();
  expect(await (await post('', { schedule: { kind: 'every', everyMs: 60_000 } })).json()).toMatchObject({ code: 'invalid_argument' });
  expect(await (await post('/pause', { id: 'ghost' })).json()).toMatchObject({ code: 'not_found' });
});

it('answers an unexpected scheduler failure with the generic message and a log correlation id', async () => {
  jobs.add.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'scene')"));
  const post = await start();
  const response = await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 } });
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toEqual({ success: false, code: 'internal_error', error: 'Internal error', errorId: expect.stringMatching(/^err_[0-9a-f]{12}$/) });
});

it('removes, pauses and resumes by id; unknown ids are 404', async () => {
  const post = await start();
  for (const action of ['remove', 'pause', 'resume'] as const) {
    expect((await post(`/${action}`, { id: 'known' })).status).toBe(200);
    expect(jobs[action]).toHaveBeenCalledWith('known');
    expect((await post(`/${action}`, { id: 'ghost' })).status).toBe(404);
    expect((await post(`/${action}`, {})).status).toBe(400);
  }
});

it('rejects demo credentials and reports a disabled assistant as 404', async () => {
  const post = await start();
  expect((await post('/remove', { id: 'known' }, 'demo')).status).toBe(403);
  state.assistant = null;
  expect((await post('/remove', { id: 'known' })).status).toBe(404);
  state.generation = false;
  expect((await post('/remove', { id: 'known' })).status).toBe(404);
  expect(jobs.remove).not.toHaveBeenCalled();
});

it('parseAssistantJobInput builds at/every schedules', () => {
  expect(parseAssistantJobInput({ prompt: 'p', schedule: { kind: 'at', atMs: 2000 } }, 1000))
    .toMatchObject({ job: { schedule: { kind: 'at', atMs: 2000, deleteAfterRun: true }, notify: { channel: 'silent' } } });
  expect(parseAssistantJobInput({ prompt: 'p', schedule: { kind: 'every', everyMs: 1000 } }))
    .toMatchObject({ job: { schedule: { kind: 'every', everyMs: 1000 } } });
});

describe('IM delivery target (#1250)', () => {
  async function startWith(endpoints?: (adapter: string, key: string) => { name: string; adapter: string } | null) {
    const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { operator: 'owner', demo: 'none' });
    cleanups.push(() => http.close());
    registerAssistantJobRoutes({ http, base: '/api', ...(endpoints ? { endpoints } : {}) });
    const { port } = await http.listen();
    return async (body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/jobs`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer operator' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as { code?: string; error?: string } };
    };
  }
  const base = { prompt: '天气', schedule: { kind: 'workday', cron: '0 0 9 * * *' } };
  const known = (adapter: string, key: string) => adapter === 'sandbox' && key === 'sandbox-bot' ? { name: 'sandbox-bot', adapter: 'sandbox' } : null;

  it('rejects im without any target with a clear code instead of an internal error', async () => {
    const post = await startWith(known);
    const result = await post({ ...base, notify: { channel: 'im' } });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('notify_target_missing');
    expect(result.body.error).toContain('--target');
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it('parses --target and rejects an unknown account or a malformed spec', async () => {
    const post = await startWith(known);
    const bad = await post({ ...base, notify: { channel: 'im', target: 'sandbox:gone:private:u1' } });
    expect(bad).toMatchObject({ status: 400, body: { code: 'schedule_target_not_found' } });
    expect(bad.body.error).toContain('sandbox / gone');
    expect((await post({ ...base, notify: { channel: 'im', target: 'sandbox:bot' } })).body.code).toBe('schedule_target_invalid');
    expect((await post({ ...base, notify: { channel: 'im', target: 'sandbox:sandbox-bot:room:u1' } })).body.code).toBe('schedule_target_invalid');
    expect(jobs.add).not.toHaveBeenCalled();

    const ok = await post({ ...base, notify: { channel: 'im', target: 'sandbox:sandbox-bot:group:g:1' } });
    expect(ok.status).toBe(201);
    expect(jobs.add.mock.calls[0]![0].notify).toEqual({ channel: 'im', target: { channel: 'im',
      scene: { platform: 'sandbox', endpointKey: 'sandbox-bot', kind: 'group', sceneId: 'g:1' } } });
  });

  it('falls back to the instance default IM target and validates its account', async () => {
    const post = await startWith(known);
    const fallback = { channel: 'im', target: { channel: 'im', scene: { platform: 'sandbox', endpointKey: 'sandbox-bot', kind: 'private', sceneId: 'u1' } } };
    state.assistant = { jobs: { ...jobs, defaultImNotify: () => fallback } };
    expect((await post({ ...base, notify: { channel: 'im' } })).status).toBe(201);
    expect(jobs.add.mock.calls[0]![0].notify).toEqual(fallback);
    state.assistant = { jobs: { ...jobs, defaultImNotify: () => ({ ...fallback, target: { ...fallback.target, scene: { ...fallback.target.scene, endpointKey: 'gone' } } }) } };
    expect((await post({ ...base, notify: { channel: 'im' } })).body.code).toBe('schedule_target_not_found');
  });
});

describe('schedule delivery target permission (#1250)', () => {
  const scheduler = (endpointGrant?: string): ConsoleUserPrincipal => Object.freeze({
    ...testUser('viewer', { kind: 'global' }, endpointGrant ? 'bot-operator' : 'scheduler'),
    grants: Object.freeze([
      { role: 'scheduler', scope: { kind: 'global' as const }, permissions: ['ops.schedule.write'] as ConsolePermission[] },
      ...(endpointGrant ? [{ role: 'operator', scope: { kind: 'endpoint' as const, key: endpointGrant }, permissions: ['endpoint.operate'] as ConsolePermission[] }] : []),
    ]),
    roles: Object.freeze(['scheduler']),
  });
  const known = (adapter: string, key: string) => adapter === 'sandbox' && (key === 'sandbox-bot' || key === 'other-bot') ? { name: key, adapter } : null;
  async function startAs() {
    const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), {
      owner: 'owner', scheduler: scheduler(), scoped: scheduler('sandbox/sandbox-bot'),
    });
    cleanups.push(() => http.close());
    registerAssistantJobRoutes({ http, base: '/api', endpoints: known });
    const { port } = await http.listen();
    return async (token: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/jobs`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as { code?: string } };
    };
  }
  const job = (target: string) => ({ prompt: '天气', schedule: { kind: 'workday', cron: '0 0 9 * * *' }, notify: { channel: 'im', target } });

  it('denies an explicit target without endpoint.operate on that account', async () => {
    const post = await startAs();
    expect(await post('scheduler', job('sandbox:sandbox-bot:group:g1'))).toMatchObject({ status: 403, body: { code: 'schedule_target_forbidden' } });
    // Scoped to another account: still denied.
    expect(await post('scoped', job('sandbox:other-bot:group:g1'))).toMatchObject({ status: 403, body: { code: 'schedule_target_forbidden' } });
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it('allows the target with endpoint.operate scoped to its account, or globally', async () => {
    const post = await startAs();
    expect((await post('scoped', job('sandbox:sandbox-bot:group:g1'))).status).toBe(201);
    expect((await post('owner', job('sandbox:other-bot:private:u1'))).status).toBe(201);
    // Without a delivery target ops.schedule.write alone is enough.
    expect((await post('scheduler', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 } })).status).toBe(201);
    expect(jobs.add).toHaveBeenCalledTimes(3);
  });
});

