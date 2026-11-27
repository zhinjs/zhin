import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleJobStore, TimerScheduler, createNotificationRouter } from '@zhin.js/agent';
import type { ConsolePermission } from '@zhin.js/console-protocol';
import type { ConsoleUserPrincipal } from '@zhin.js/host-http';
import { testUser, withTestUsers } from '../utils/console-users.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import {
  MAX_SCHEDULE_AT_DELAY_MS,
  parseAssistantJobInput,
  registerAssistantJobRoutes,
} from '../../../src/instance/console/assistant-job-routes.js';

const state = vi.hoisted(() => ({ assistant: undefined as unknown, generation: true, reason: 'agent-not-installed' as string | undefined }));
vi.mock('../../../src/instance/console/agent-console.js', () => ({
  withGenerationAgentConsole: async (_snapshots: unknown, run: (value: unknown) => Promise<unknown>) => {
    if (!state.generation) return undefined;
    return run({ assistant: state.assistant });
  },
  agentConsoleDisabledReason: async () => state.reason,
}));

const jobs = {
  add: vi.fn(async (job: Record<string, unknown>) => ({ ...job, createdAt: 1 })),
  remove: vi.fn(async (id: string) => id === 'known'),
  pause: vi.fn(async (id: string) => id === 'known'),
  resume: vi.fn(async (id: string) => id === 'known'),
  list: vi.fn(async () => [{ id: 'known', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } }]),
};
const cleanups: (() => Promise<unknown>)[] = [];
beforeEach(() => { state.assistant = { jobs }; state.generation = true; state.reason = 'agent-not-installed'; vi.clearAllMocks(); });
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

it('names why job writes are unavailable while keeping the legacy error string (#1250)', async () => {
  const post = await start();
  state.assistant = null;
  expect(await (await post('/remove', { id: 'known' })).json()).toEqual({
    success: false, code: 'unavailable', error: 'assistant.enabled is false',
    data: { status: 'disabled', reason: 'assistant-disabled', message: expect.stringContaining('assistant.enabled: true') },
  });
  state.generation = false;
  expect((await (await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 } })).json()).data)
    .toMatchObject({ status: 'disabled', reason: 'agent-not-installed', message: expect.stringContaining('@zhin.js/agent') });
  state.reason = undefined;
  expect((await (await post('/pause', { id: 'known' })).json()).data).toMatchObject({ reason: 'agent-disabled' });
});

it('bounds schedule.atMs to a future time at most 365 days ahead, the same 365-day bound as the Agent schedule tools (#1250 b112)', async () => {
  const now = 1_000_000;
  expect(MAX_SCHEDULE_AT_DELAY_MS).toBe(365 * 24 * 60 * 60_000);
  expect(parseAssistantJobInput({ prompt: 'p', schedule: { kind: 'at', atMs: now + MAX_SCHEDULE_AT_DELAY_MS } }, now))
    .toMatchObject({ job: { schedule: { kind: 'at', atMs: now + MAX_SCHEDULE_AT_DELAY_MS } } });
  for (const atMs of [now, now + MAX_SCHEDULE_AT_DELAY_MS + 1, 8.64e15, 8.64e15 + 1, Number.MAX_SAFE_INTEGER, now + 0.5]) {
    expect(parseAssistantJobInput({ prompt: 'p', schedule: { kind: 'at', atMs } }, now), String(atMs))
      .toMatchObject({ code: 'invalid_argument', error: expect.stringContaining('schedule.atMs') });
  }

  const post = await start();
  for (const atMs of [Date.now() + MAX_SCHEDULE_AT_DELAY_MS + 60_000, Number.MAX_SAFE_INTEGER]) {
    const response = await post('', { prompt: 'x', schedule: { kind: 'at', atMs } });
    expect(response.status, String(atMs)).toBe(400);
    expect((await response.json()).error).toContain('365 天');
  }
  expect(jobs.add).not.toHaveBeenCalled();
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
    return async (token: string, body: unknown, path = '') => {
      const response = await fetch(`http://127.0.0.1:${port}/api/assistant/jobs${path}`, {
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

  it('set-agent needs endpoint.operate on the stored job\'s delivery account, like add (#1250 b52)', async () => {
    const target = { channel: 'im', scene: { platform: 'sandbox', endpointKey: 'sandbox-bot', sceneId: 'g1', kind: 'group' } };
    const setAgent = vi.fn(async (id: string, agent: string | undefined) => ({ id, action: { kind: 'agent', prompt: 'p', ...(agent ? { agent } : {}) } }));
    state.assistant = { jobs: { ...jobs, agents: () => ['zhin', 'news'], setAgent, list: async () => [
      { id: 'im', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'im', target } },
      { id: 'quiet', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } },
      // A non-IM `target` (Home Assistant entity) is not a delivery account.
      { id: 'ha', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'ha', service: 'notify.x', target: 'sandbox:other' } },
    ] } };
    const post = await startAs();
    expect(await post('scheduler', { id: 'im', agent: 'news' }, '/set-agent')).toMatchObject({
      status: 403, body: { code: 'schedule_target_forbidden', error: expect.stringContaining('sandbox / sandbox-bot') } });
    expect(setAgent).not.toHaveBeenCalled();
    expect((await post('scoped', { id: 'im', agent: 'news' }, '/set-agent')).status).toBe(200);
    expect((await post('owner', { id: 'im', agent: null }, '/set-agent')).status).toBe(200);
    // No IM target: ops.schedule.write alone is enough.
    expect((await post('scheduler', { id: 'quiet', agent: 'news' }, '/set-agent')).status).toBe(200);
    expect((await post('scheduler', { id: 'ha', agent: 'news' }, '/set-agent')).status).toBe(200);
    expect(setAgent).toHaveBeenCalledTimes(4);
  });

  it('resume needs endpoint.operate on the stored job\'s delivery account; pause and remove do not (#1250 b55)', async () => {
    const target = { channel: 'im', scene: { platform: 'sandbox', endpointKey: 'sandbox-bot', sceneId: 'g1', kind: 'group' } };
    const resume = vi.fn(async () => true);
    const pause = vi.fn(async () => true);
    const remove = vi.fn(async () => true);
    state.assistant = { jobs: { ...jobs, resume, pause, remove, list: async () => [
      { id: 'im', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'im', target } },
      { id: 'quiet', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } },
    ] } };
    const post = await startAs();
    expect(await post('scheduler', { id: 'im' }, '/resume')).toEqual({ status: 403, body: { success: false,
      code: 'schedule_target_forbidden', error: '没有向该账号投递的权限：需要 sandbox / sandbox-bot 上的 endpoint.operate' } });
    expect(resume).not.toHaveBeenCalled();
    expect(await post('scheduler', { id: 'ghost' }, '/resume')).toMatchObject({ status: 404, body: { code: 'not_found' } });
    expect((await post('scoped', { id: 'im' }, '/resume')).status).toBe(200);
    expect((await post('owner', { id: 'im' }, '/resume')).status).toBe(200);
    expect((await post('scheduler', { id: 'quiet' }, '/resume')).status).toBe(200);
    expect(resume).toHaveBeenCalledTimes(3);
    expect((await post('scheduler', { id: 'im' }, '/pause')).status).toBe(200);
    expect((await post('scheduler', { id: 'im' }, '/remove')).status).toBe(200);
  });

  it('update needs endpoint.operate on the delivery account while the job keeps running; disabling does not (#1250 b90)', async () => {
    const target = { channel: 'im', scene: { platform: 'sandbox', endpointKey: 'sandbox-bot', sceneId: 'g1', kind: 'group' } };
    const update = vi.fn(async (id: string) => ({ id }));
    state.assistant = { jobs: { ...jobs, update, list: async () => [
      { id: 'im', enabled: true, schedule: { kind: 'solar', cron: '0 0 9 * * *' }, action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'im', target } },
      { id: 'paused', enabled: false, schedule: { kind: 'solar', cron: '0 0 9 * * *' }, action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'im', target } },
    ] } };
    const post = await startAs();
    expect(await post('scheduler', { id: 'im', schedule: { cron: '0 0 8 * * *' } }, '/update')).toMatchObject({
      status: 403, body: { code: 'schedule_target_forbidden' } });
    expect(await post('scheduler', { id: 'paused', enabled: true }, '/update')).toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
    expect((await post('scheduler', { id: 'im', enabled: false }, '/update')).status).toBe(200);
    expect((await post('scheduler', { id: 'paused', label: 'x' }, '/update')).status).toBe(200);
    expect((await post('scoped', { id: 'im', schedule: { cron: '0 0 8 * * *' } }, '/update')).status).toBe(200);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('a delivery target without an account is refused without naming an "undefined" account (#1250 b61)', async () => {
    const accountless = { channel: 'im', scene: { kind: 'group', sceneId: 'g1' } };
    const resume = vi.fn(async () => true);
    const setAgent = vi.fn(async (id: string) => ({ id }));
    state.assistant = { jobs: { ...jobs, resume, setAgent, agents: () => ['zhin'], list: async () => [
      { id: 'bare', action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'im', target: accountless } },
    ] } };
    const post = await startAs();
    const refusal = { status: 403, body: { success: false, code: 'schedule_target_forbidden',
      error: '投递目标需要指明账号（scene.platform 与 scene.endpointKey）' } };
    expect(await post('scheduler', { id: 'bare' }, '/resume')).toEqual(refusal);
    expect(await post('scheduler', { id: 'bare', agent: 'zhin' }, '/set-agent')).toEqual(refusal);
    expect(resume).not.toHaveBeenCalled();
    expect(setAgent).not.toHaveBeenCalled();
    // add validates the target's shape before the permission check: 400, not an account to grant.
    expect(await post('scheduler', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, notify: { channel: 'im', target: accountless } }))
      .toMatchObject({ status: 400, body: { code: 'schedule_target_invalid' } });
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it('resume is refused to a signed-in caller when the job list is unavailable (#1250 b55)', async () => {
    const { list: _list, ...withoutList } = jobs;
    state.assistant = { jobs: withoutList };
    const post = await startAs();
    expect(await post('owner', { id: 'known' }, '/resume')).toMatchObject({ status: 404, body: { code: 'unavailable' } });
    expect(jobs.resume).not.toHaveBeenCalled();
  });
});


describe('job Agent (#1250 b52)', () => {
  const agentJobs = {
    ...jobs,
    list: vi.fn(async () => [
      { id: 'known', action: { kind: 'agent', prompt: 'p' } },
      { id: 'beat', action: { kind: 'heartbeat', prompt: 'p' } },
    ]),
    agents: vi.fn(() => ['zhin', 'news']),
    setAgent: vi.fn(async (id: string, agent: string | undefined) => (id === 'known'
      ? { id, action: { kind: 'agent', prompt: 'p', ...(agent ? { agent } : {}) } } : null)),
  };
  beforeEach(() => { state.assistant = { jobs: agentJobs }; });

  it('POST /assistant/jobs stores a configured Agent and leaves it out when absent', async () => {
    const post = await start();
    expect((await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, agent: ' news ' })).status).toBe(201);
    expect(agentJobs.add.mock.calls[0]![0]).toMatchObject({ action: { kind: 'agent', prompt: 'x', agent: 'news' } });
    expect((await post('', { prompt: 'y', schedule: { kind: 'every', everyMs: 60_000 } })).status).toBe(201);
    expect(agentJobs.add.mock.calls[1]![0].action).toEqual({ kind: 'agent', prompt: 'y' });
  });

  it('POST /assistant/jobs rejects an unknown Agent and lists the available ones', async () => {
    const post = await start();
    const response = await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, agent: 'ghost' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'schedule_agent_not_found', error: 'Agent 不存在：ghost。可用的 Agent：zhin、news',
      data: { code: 'schedule_agent_not_found', agent: 'ghost', available: ['zhin', 'news'] } });
    expect((await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, agent: 3 })).status).toBe(400);
    expect(agentJobs.add).not.toHaveBeenCalled();
  });

  it('an Agent package without `agents()` accepts only the default Agent', async () => {
    state.assistant = { jobs };
    const post = await start();
    expect((await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, agent: 'news' })).status).toBe(400);
    expect((await post('', { prompt: 'x', schedule: { kind: 'every', everyMs: 60_000 }, agent: 'zhin' })).status).toBe(201);
    expect((await post('/set-agent', { id: 'known', agent: 'zhin' })).status).toBe(404);
  });

  it('POST /assistant/jobs/set-agent sets, clears and validates the Agent', async () => {
    const post = await start();
    let response = await post('/set-agent', { id: 'known', agent: 'news' });
    expect(response.status).toBe(200);
    expect((await response.json()).data.job.action.agent).toBe('news');
    expect(agentJobs.setAgent).toHaveBeenLastCalledWith('known', 'news');
    expect((await post('/set-agent', { id: 'known', agent: null })).status).toBe(200);
    expect(agentJobs.setAgent).toHaveBeenLastCalledWith('known', undefined);
    response = await post('/set-agent', { id: 'known', agent: 'ghost' });
    expect(await response.json()).toMatchObject({ code: 'schedule_agent_not_found', error: expect.stringContaining('可用的 Agent：zhin、news'),
      data: { code: 'schedule_agent_not_found', agent: 'ghost', available: ['zhin', 'news'] } });
    expect((await post('/set-agent', { id: 'known' })).status).toBe(400);
    expect((await post('/set-agent', { agent: 'news' })).status).toBe(400);
    expect(await (await post('/set-agent', { id: 'beat', agent: 'news' })).json()).toMatchObject({ code: 'schedule_agent_heartbeat', error: expect.stringContaining('心跳任务') });
    expect(await (await post('/set-agent', { id: 'ghost', agent: 'news' })).json()).toMatchObject({ code: 'not_found' });
    // A job missing from the list is answered without asking the scheduler.
    expect(agentJobs.setAgent).toHaveBeenCalledTimes(2);
  });

  it('maps the scheduler\'s refusal of a profile routine to 400, not 500', async () => {
    const refusal = (code: string, message: string) => Object.assign(new Error(message), { code });
    const setAgent = vi.fn(async (id: string) => {
      if (id === 'assistant-profile-morning-brief') throw refusal('schedule_agent_profile', '任务来自 Assistant Profile，请在 Profile 文件中该 routine 的 agent 字段修改');
      throw new Error('disk full');
    });
    const post = async (body: unknown) => (await start())('/set-agent', body);
    // The scheduler is the one that knows a job is a profile routine (`source: profile`).
    state.assistant = { jobs: { ...jobs, agents: () => ['zhin', 'news'], setAgent, list: async () => [
      { id: 'assistant-profile-morning-brief', source: 'profile', action: { kind: 'agent', prompt: 'p' } },
      { id: 'other', action: { kind: 'agent', prompt: 'p' } },
    ] } };
    const response = await post({ id: 'assistant-profile-morning-brief', agent: 'news' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'schedule_agent_profile', error: expect.stringContaining('Profile 文件') });
    // Anything else is still an internal error.
    expect((await post({ id: 'other', agent: 'news' })).status).toBe(500);
  });

  it('a signed-in caller is refused when the job list is unavailable (its target cannot be checked)', async () => {
    const { list: _list, ...withoutList } = jobs;
    state.assistant = { jobs: { ...withoutList, agents: () => ['zhin', 'news'], setAgent: agentJobs.setAgent } };
    const post = await start();
    const response = await post('/set-agent', { id: 'known', agent: 'news' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'unavailable' });
    expect(agentJobs.setAgent).not.toHaveBeenCalled();
  });

  it('set-agent needs ops.schedule.write like the other job writes', async () => {
    const post = await start();
    expect((await post('/set-agent', { id: 'known', agent: 'news' }, 'demo')).status).toBe(403);
    expect(agentJobs.setAgent).not.toHaveBeenCalled();
  });
});

describe('POST /assistant/jobs/update (#1250 b90)', () => {
  const target = { channel: 'im', scene: { platform: 'sandbox', endpointKey: 'sandbox-bot', sceneId: 'g1', kind: 'group' } };
  const stored = () => [
    { id: 'brief', enabled: true, label: '早报', schedule: { kind: 'solar', cron: '0 0 9 * * *', tz: 'Asia/Tokyo' },
      action: { kind: 'agent', prompt: 'p', agent: 'briefing' }, notify: { channel: 'im', target } },
    { id: 'tick', enabled: false, schedule: { kind: 'every', everyMs: 60_000 }, action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } },
    { id: 'assistant-profile-morning-brief', enabled: true, source: 'profile', schedule: { kind: 'solar', cron: '0 0 7 * * *' },
      action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } },
  ];
  const update = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const job = stored().find(entry => entry.id === id);
    return job ? { ...job, ...(patch.schedule ? { schedule: patch.schedule } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}) } : null;
  });
  beforeEach(() => { state.assistant = { jobs: { ...jobs, list: async () => stored(), update } }; });

  it('changes the schedule, keeping the kind and time zone when only the cron is given, and the label and enabled state', async () => {
    const post = await start();
    const response = await post('/update', { id: 'brief', schedule: { cron: '0 0 8 * * *' } });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenLastCalledWith('brief', { schedule: { kind: 'solar', cron: '0 0 8 * * *', tz: 'Asia/Tokyo' } });
    expect((await response.json()).data.job.action).toEqual({ kind: 'agent', prompt: 'p', agent: 'briefing' });
    expect((await post('/update', { id: 'brief', schedule: { kind: 'workday' } })).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith('brief', { schedule: { kind: 'workday', cron: '0 0 9 * * *', tz: 'Asia/Tokyo' } });
    expect((await post('/update', { id: 'tick', label: ' 心跳 ', enabled: true })).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith('tick', { label: '心跳', enabled: true });
    expect((await post('/update', { id: 'tick', label: null, schedule: { kind: 'every', everyMs: 120_000 } })).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith('tick', { schedule: { kind: 'every', everyMs: 120_000 }, label: null });
  });

  it('rejects bad bodies, unknown jobs and profile routines without calling the scheduler', async () => {
    const post = await start();
    const answer = async (body: unknown) => { const response = await post('/update', body); return { status: response.status, body: await response.json() }; };
    expect(await answer({ schedule: { cron: '0 0 8 * * *' } })).toMatchObject({ status: 400, body: { code: 'invalid_argument' } });
    expect(await answer({ id: 'brief' })).toMatchObject({ status: 400, body: { code: 'invalid_argument', error: expect.stringContaining('没有要修改的内容') } });
    expect(await answer({ id: 'brief', enabled: 'yes' })).toMatchObject({ status: 400 });
    expect(await answer({ id: 'brief', schedule: { cron: 'not a cron' } })).toMatchObject({ status: 400, body: { error: expect.stringMatching(/cron 表达式无效/iu) } });
    expect(await answer({ id: 'tick', schedule: { kind: 'at', atMs: Number.MAX_SAFE_INTEGER } }))
      .toMatchObject({ status: 400, body: { code: 'invalid_argument', error: expect.stringContaining('365 天') } });
    expect(await answer({ id: 'tick', schedule: { kind: 'solar' } })).toMatchObject({ status: 400, body: { error: expect.stringContaining('不是 cron 计划') } });
    expect(await answer({ id: 'ghost', enabled: false })).toMatchObject({ status: 404, body: { code: 'not_found' } });
    expect(await answer({ id: 'assistant-profile-morning-brief', schedule: { cron: '0 0 8 * * *' } }))
      .toMatchObject({ status: 400, body: { code: 'schedule_update_profile', error: expect.stringContaining('assistant.profile.yml') } });
    expect(update).not.toHaveBeenCalled();
  });

  it('is unavailable on an Agent package without update, and needs ops.schedule.write', async () => {
    const post = await start();
    expect((await post('/update', { id: 'brief', enabled: false }, 'demo')).status).toBe(403);
    state.assistant = { jobs };
    expect(await (await post('/update', { id: 'known', enabled: false })).json()).toMatchObject({ code: 'unavailable' });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('POST /assistant/jobs[/update] build schedules like schedule_update (#1250 b90 review)', () => {
  let dataDir: string;
  let engine: TimerScheduler;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-job-routes-'));
    engine = new TimerScheduler({ store: new ScheduleJobStore({ dataDir }), due: { run: vi.fn() } as never,
      router: createNotificationRouter({ resolveAdapter: () => undefined }) });
    await engine.addJob({ id: 'water', enabled: true, source: 'manual', schedule: { kind: 'workday', cron: '0 0 9 * * *' },
      action: { kind: 'agent', prompt: '喝水' }, notify: { channel: 'silent' } });
    await engine.addJob({ id: 'brief', enabled: true, source: 'manual', schedule: { kind: 'solar', cron: '0 0 9 * * *' },
      action: { kind: 'agent', prompt: '早报' }, notify: { channel: 'silent' } });
    state.assistant = { jobs: {
      ...jobs,
      add: vi.fn(async (job: Record<string, unknown>) => engine.addJob(job as never)),
      list: async () => engine.listJobs(),
      update: vi.fn((id: string, patch: Record<string, unknown>) => engine.updateJob(id, patch as never)),
    } };
  });
  afterEach(async () => {
    engine.unload();
    await engine.stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  const answer = async (post: Awaited<ReturnType<typeof start>>, path: string, body: unknown) => {
    const response = await post(path, body);
    return { status: response.status, body: await response.json() as Record<string, any> };
  };

  it('keeps only the time of a workday cron instead of failing in the scheduler with a 500', async () => {
    const post = await start();
    for (const cron of ['0 0 9 * * 1-5', '0 0 9 30 2 *']) {
      const result = await answer(post, '/update', { id: 'water', schedule: { cron } });
      expect(result, cron).toMatchObject({ status: 200, body: { success: true, data: { job: { schedule: { kind: 'workday', cron: '0 0 9 * * *' } } } } });
      expect(result.body.data.job.state.nextRunAtMs).toEqual(expect.any(Number));
      expect(result.body.data).not.toHaveProperty('warning');
    }
    expect((await engine.listJobs()).find(job => job.id === 'water')?.schedule).toEqual({ kind: 'workday', cron: '0 0 9 * * *' });
    expect(engine.listUnschedulable()).toEqual([]);
  });

  it('matches kind case-insensitively, accepts holiday, and keeps an explicit solar as is', async () => {
    const post = await start();
    expect(await answer(post, '/update', { id: 'brief', schedule: { kind: 'HOLIDAY' } }))
      .toMatchObject({ status: 200, body: { data: { job: { schedule: { kind: 'holiday', cron: '0 0 9 * * *' } } } } });
    expect(await answer(post, '/update', { id: 'brief', schedule: { kind: 'FreeDay' } }))
      .toMatchObject({ status: 200, body: { data: { job: { schedule: { kind: 'freeDay', cron: '0 0 9 * * *' } } } } });
    // Back to solar: the full cron has to be given, and its weekday range is kept.
    expect(await answer(post, '/update', { id: 'water', schedule: { kind: 'Solar', cron: '0 0 9 * * 1-5' } }))
      .toMatchObject({ status: 200, body: { data: { job: { schedule: { kind: 'solar', cron: '0 0 9 * * 1-5' } } } } });
    expect(await answer(post, '/update', { id: 'brief', schedule: { kind: 'weekly' } }))
      .toMatchObject({ status: 400, body: { code: 'invalid_argument', error: expect.stringContaining('holiday') } });
  });

  it('warns when the saved job stays enabled but has no next run, like the tool', async () => {
    const post = await start();
    // A cron the scheduler finds no next run for (e.g. a date that never comes).
    vi.spyOn(engine, 'nextRunAt').mockReturnValue(undefined);
    const result = await answer(post, '/update', { id: 'brief', schedule: { cron: '0 0 9 29 2 *' } });
    expect(result).toMatchObject({ status: 200, body: { success: true, data: { warning: expect.stringContaining('算不出下次运行时间') } } });
    expect(result.body.data.job.state.nextRunAtMs).toBeUndefined();
    // Disabled: nothing to warn about.
    expect((await answer(post, '/update', { id: 'brief', enabled: false })).body.data).not.toHaveProperty('warning');
  });

  it('answers a schedule the scheduler refuses as 400 schedule_invalid, not 500', async () => {
    const post = await start();
    const update = (state.assistant as { jobs: { update: ReturnType<typeof vi.fn> } }).jobs.update;
    update.mockRejectedValueOnce(Object.assign(new Error('cron 表达式无效: Calendar cron requires * for day, month, and weekday fields'), { code: 'schedule_invalid' }));
    expect(await answer(post, '/update', { id: 'water', schedule: { cron: '0 0 8 * * *' } }))
      .toMatchObject({ status: 400, body: { success: false, code: 'schedule_invalid', error: expect.stringContaining('任务未修改') } });
    // Any other failure stays an internal error.
    update.mockRejectedValueOnce(new Error('disk full'));
    expect((await answer(post, '/update', { id: 'water', schedule: { cron: '0 0 8 * * *' } })).status).toBe(500);
  });

  it('builds the schedule of a new job the same way (workday keeps the time, kind case-insensitive, holiday)', async () => {
    const post = await start();
    const added = await answer(post, '', { prompt: '喝水', schedule: { kind: 'WorkDay', cron: '0 0 9 * * 1-5' }, notify: { channel: 'silent' } });
    expect(added).toMatchObject({ status: 201, body: { data: { job: { schedule: { kind: 'workday', cron: '0 0 9 * * *' } } } } });
    expect(added.body.data.job.state.nextRunAtMs).toEqual(expect.any(Number));
    expect(engine.listUnschedulable().map(job => job.jobId)).not.toContain(added.body.data.job.id);
    expect(await answer(post, '', { prompt: '节日', schedule: { kind: 'holiday', cron: '0 0 9 * * *' }, notify: { channel: 'silent' } }))
      .toMatchObject({ status: 201, body: { data: { job: { schedule: { kind: 'holiday', cron: '0 0 9 * * *' } } } } });
  });
});
