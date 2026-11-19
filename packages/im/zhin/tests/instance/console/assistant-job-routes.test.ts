import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsolePermission } from '@zhin.js/console-protocol';
import type { ConsoleUserPrincipal } from '@zhin.js/host-http';
import { testUser, withTestUsers } from '../utils/console-users.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import {
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
