// Reads of a feature that is off answer with its state, not a read failure (#1250).
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http/node';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from '@zhin.js/adapter';
import { withTestUsers } from '../utils/console-users.js';

const state = vi.hoisted(() => ({ assistant: undefined as unknown, generation: true, reason: 'agent-not-installed' as string | undefined }));
vi.mock('../../../src/instance/console/agent-console.js', () => ({
  withGenerationAgentConsole: async (_snapshots: unknown, run: (value: unknown) => Promise<unknown>) => {
    if (!state.generation) return undefined;
    return run({ assistant: state.assistant });
  },
  agentConsoleDisabledReason: async () => state.reason,
}));

const { registerAgentConsoleRoutes } = await import('../../../src/instance/console/agent-routes.js');
const { registerConversationResultRoutes } = await import('../../../src/instance/console/conversation-result-routes.js');

const cleanups: (() => Promise<unknown>)[] = [];
beforeEach(() => { state.assistant = undefined; state.generation = true; state.reason = 'agent-not-installed'; });
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-feature-disabled-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = rootPluginId(), connection = { target: 'bot', owner: 'owner', placeholder: false, socket: { readyState: 1 } };
  const index = { $projection: 'zhin.adapter-index/1', describe: () => [{ id: 'canonical', name: 'bot', admitted: true }],
    clientAdapter: () => 'sandbox', capabilityProfile: () => ({ default: { runtime: { sandbox: true } } }), clientById: () => ({ connectionById: (id: string) => id === 'live' ? connection : undefined }) };
  const snapshotState: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: directory, children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, index]]) };
  const snapshots = new SnapshotStore(snapshotState);
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { full: 'owner' });
  cleanups.push(() => snapshots.close(), () => http.close());
  registerAgentConsoleRoutes({ http, base: '/api', snapshots });
  registerConversationResultRoutes({ http, base: '/api', projectRoot: directory, snapshots, importAgent: async () => {
    throw Object.assign(new Error("Cannot find package '@zhin.js/agent' imported from instance"), { code: 'ERR_MODULE_NOT_FOUND' });
  } });
  const { port } = await http.listen();
  return (path: string) => fetch(`http://127.0.0.1:${port}/api${path}`, { headers: { authorization: 'Bearer full' } });
}

it('GET /assistant/jobs reports a missing Agent package, a stopped Agent and a disabled assistant as states', async () => {
  const get = await start();
  state.generation = false;
  let response = await get('/assistant/jobs');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: {
    status: 'disabled', reason: 'agent-not-installed', message: expect.stringContaining('@zhin.js/agent'), jobs: [], eventsActive: false } });
  state.reason = undefined;
  expect((await (await get('/assistant/jobs')).json()).data).toMatchObject({ status: 'disabled', reason: 'agent-disabled' });
  state.generation = true;
  state.assistant = null;
  response = await get('/assistant/jobs');
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ status: 'disabled', reason: 'assistant-disabled', jobs: [] });
});

it('GET /conversations/results without the Agent package is an empty, disabled result — not 503', async () => {
  const get = await start();
  const response = await get(`/conversations/results?${new URLSearchParams({ connectionId: 'live', sessionKey: 'sandbox:bot:group:room' })}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: {
    status: 'disabled', reason: 'agent-not-installed', message: expect.any(String),
    sessionKey: 'sandbox:bot:group:room', nextCursor: null, hasMore: false, results: [] } });
});
