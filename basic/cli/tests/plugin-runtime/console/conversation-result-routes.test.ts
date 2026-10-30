import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHttpHost } from '@zhin.js/host-http';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { adapterFeatureId } from '@zhin.js/adapter';
import { FileJournalStore, PersistentTurnJournal } from '@zhin.js/agent';
import { registerConversationResultRoutes } from '../../../src/plugin-runtime/console/conversation-result-routes.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(target = 'bot', sceneId = 'room') {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-console-results-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = rootPluginId(), connection = { target, owner: 'configured-owner', placeholder: false, socket: { readyState: 1 } };
  const index = { $projection: 'zhin.adapter-index/1', describe: () => [{ id: 'canonical', name: 'bot', admitted: true }],
    clientAdapter: () => 'sandbox', clientById: () => ({ connectionById: (id: string) => id === 'live' ? connection : undefined }) };
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: directory, children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, index]]) };
  const snapshots = new SnapshotStore(state);
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'full', tokens: [{ token: 'demo', scope: 'demo' }] });
  cleanups.push(() => snapshots.close(), () => http.close());
  registerConversationResultRoutes({ http, base: '/api', projectRoot: directory, snapshots });
  const { port } = await http.listen();
  const sessionId = `sandbox:${target}:group:${sceneId}`, store = new FileJournalStore(join(directory, '.zhin', 'agent-journal'));
  const conversation = { endpoint: { adapter: 'sandbox', id: 'canonical' }, kind: 'group' as const, id: sceneId };
  const run = { sessionId, turnId: 'offline' };
  await new PersistentTurnJournal(run, store).append({ type: 'turn_end', output: [{ type: 'text', content: 'completed offline' }], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  await store.recordDelivery({ run, subjectId: 'configured-owner', origin: { kind: 'im', platform: 'sandbox', endpoint: target, scope: 'group', sceneId, conversation },
    recordedAt: 2, status: 'not_sent', outcome: 'failed', code: 'sandbox_delivery_unavailable', messages: [], resources: [] });
  const request = (query: Record<string, string> = {}, token = 'full') => fetch(`http://127.0.0.1:${port}/api/conversations/results?${new URLSearchParams({ connectionId: 'live', sessionKey: sessionId, ...query })}`,
    { headers: { authorization: `Bearer ${token}` } });
  return { request, connection, directory, store };
}

it('recovers existing journal output and delivery facts read-only under the real connection owner', async () => {
  const f = await fixture();
  const first = await f.request({ subjectId: 'forged' });
  expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('no-store');
  const data = (await first.json()).data;
  expect(data).toMatchObject({ hasMore: false, nextCursor: null });
  expect(data).toMatchObject({ sessionKey: 'sandbox:bot:group:room', results: [{ turnId: 'offline', message: 'completed offline', deliveries: [{ status: 'not_sent', code: 'sandbox_delivery_unavailable' }] }] });
  expect(data.results[0].deliveries[0]).not.toHaveProperty('subjectId');
  expect((await (await f.request()).json()).data).toEqual(data);
  f.connection.owner = 'new-owner';
  expect((await (await f.request()).json()).data.results).toEqual([]);
});

it('recovers the unchanged journal identity when the bound target and scene contain colons', async () => {
  const f = await fixture('a:b', 'room:part');
  const response = await f.request(); expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ sessionKey: 'sandbox:a:b:group:room:part', results: [{ message: 'completed offline' }] });
  expect((await f.request({ sessionKey: 'sandbox:a:b-other:group:room:part' })).status).toBe(403);
});

it('rejects Demo, stale bindings, other endpoints and malformed scenes without selecting arbitrary identities', async () => {
  const f = await fixture();
  expect((await f.request({}, 'demo')).status).toBe(403);
  expect((await f.request({ connectionId: 'old' })).status).toBe(503);
  expect((await f.request({ sessionKey: 'sandbox:other:group:room' })).status).toBe(403);
  expect((await f.request({ sessionKey: 'icqq:bot:group:room' })).status).toBe(403);
  expect((await f.request({ sessionKey: 'sandbox:bot:invalid:room' })).status).toBe(400);
  expect((await f.request({ cursor: 'invalid' })).status).toBe(400);
  const oldest = Buffer.from(JSON.stringify({ completedAt: 0, turnId: 'oldest' })).toString('base64url');
  expect((await (await f.request({ cursor: oldest })).json()).data.results).toEqual([]);
  expect((await (await f.request({ sessionKey: 'sandbox:bot:private:room' })).json()).data.results).toEqual([]);
  f.connection.socket.readyState = 3;
  expect((await f.request()).status).toBe(503);
});

it('reports corrupt delivery storage as unavailable rather than empty history or successful delivery', async () => {
  const f = await fixture();
  const runDirectory = join(f.directory, '.zhin', 'agent-journal', Buffer.from('sandbox:bot:group:room').toString('base64url'), Buffer.from('offline').toString('base64url'));
  const receipt = (await readdir(runDirectory)).find(name => name.endsWith('.delivery'))!;
  await writeFile(join(runDirectory, receipt), 'invalid');
  const response = await f.request(); expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('result_store_unavailable');
});
