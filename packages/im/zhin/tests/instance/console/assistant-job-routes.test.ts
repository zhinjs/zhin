import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withTestUsers } from '../utils/console-users.js';
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
