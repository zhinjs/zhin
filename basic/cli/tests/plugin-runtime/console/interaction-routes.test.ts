import { afterEach, expect, it, vi } from 'vitest';
import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import { adapterFeatureId } from '@zhin.js/adapter';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { ImRuntime, RuntimeMessage } from '@zhin.js/core/runtime';
import { registerInteractionRoutes } from '../../../src/plugin-runtime/console/interaction-routes.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start(target = 'bot', sceneId = 'room') {
  const root = rootPluginId();
  const connection = { target, owner: 'configured-owner', placeholder: false, socket: { readyState: 1 } };
  const index = { $projection: 'zhin.adapter-index/1',
    describe: () => [{ id: 'canonical-endpoint', name: 'sandbox-slot', admitted: true }],
    clientAdapter: () => 'sandbox', clientById: () => ({ connectionById: (id: string) => id === 'live-connection' ? connection : undefined }) };
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, index]]) };
  const snapshots = new SnapshotStore(state), im = new ImRuntime();
  im.attach(snapshots);
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  cleanups.push(() => snapshots.close(), () => http.close());
  registerInteractionRoutes({ http, base: '/api', im, snapshots });
  const { port } = await http.listen();
  const conversation = { endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group' as const, id: sceneId };
  const controller = new AbortController(), sent: unknown[] = [];
  const answer = im.createInteraction(new RuntimeMessage(
    { conversation: conversation, content: 'start', sender: { id: connection.owner } },
    {
      generation: 0,
      reply: async (content) => {
        sent.push(content);
        return { status: 'sent' };
      },
    },
  ))!.ask({ type: 'confirm', title: 'Current approval', signal: controller.signal }).catch(error => error);
  cleanups.push(async () => { controller.abort(); await answer; });
  await Promise.resolve(); await Promise.resolve();
  const request = (query: Record<string, string> = {}, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/interactions/pending?${new URLSearchParams({
    connectionId: 'live-connection', sessionKey: `sandbox:${target}:group:${sceneId}`, ...query,
  })}`, { headers: { authorization: `Bearer ${token}` } });
  return { request, im, sent, connection, controller, answer, snapshots, state };
}

it('reads the actual current prompt using server-owned canonical endpoint, owner and generation', async () => {
  const f = await start(), read = vi.spyOn(f.im, 'readPendingInteraction');
  const response = await f.request({ subjectId: 'forged-subject' });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { data } = await response.json();
  expect(data).toMatchObject({ generation: 0, pending: [{ generation: 0, subjectId: 'configured-owner',
    conversation: { endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group', id: 'room' } }] });
  expect(data.pending[0].segments).toEqual(f.sent[0]);
  expect(read).toHaveBeenCalledWith({ endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group', id: 'room' }, 'configured-owner', 0);
  expect(f.sent).toHaveLength(1);
});

it('reads pending prompts when the bound target and scene both contain colons', async () => {
  const f = await start('a:b', 'room:part'), read = vi.spyOn(f.im, 'readPendingInteraction');
  const response = await f.request(); expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.pending[0].conversation.id).toBe('room:part');
  expect(read).toHaveBeenCalledWith({ endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group', id: 'room:part' }, 'configured-owner', 0);
  expect((await f.request({ sessionKey: 'sandbox:a:b-other:group:room:part' })).status).toBe(403);
});

it('denies Demo before any projection and fails unavailable bindings rather than accepting browser identity', async () => {
  const f = await start(), read = vi.spyOn(f.im, 'readPendingInteraction');
  expect((await f.request({}, 'demo')).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  for (const query of [{ connectionId: 'closed-connection' }, { connectionId: '' }]) {
    expect((await f.request(query)).status).toBe(query.connectionId ? 503 : 400);
  }
  f.connection.socket.readyState = 3;
  expect((await f.request()).status).toBe(503);
  expect(read).not.toHaveBeenCalled();
});

it('does not project another endpoint or scene, completed prompts, or a previous generation', async () => {
  const f = await start();
  expect((await f.request({ sessionKey: 'sandbox:other-bot:group:room' })).status).toBe(403);
  expect((await f.request({ sessionKey: 'icqq:bot:group:room' })).status).toBe(403);
  expect((await f.request({ sessionKey: 'sandbox:bot:invalid:room' })).status).toBe(400);
  const other = await (await f.request({ sessionKey: 'sandbox:bot:group:other-room' })).json();
  expect(other.data.pending).toEqual([]);
  f.snapshots.commit(0, { snapshot: f.state, dispose() {} });
  const next = await (await f.request()).json();
  expect(next.data).toEqual({ generation: 1, pending: [] });
  f.controller.abort(); await f.answer;
  expect((await (await f.request()).json()).data.pending).toEqual([]);
});

it('reports a projection failure as an error, never as an empty successful pending list', async () => {
  const f = await start();
  vi.spyOn(f.im, 'readPendingInteraction').mockImplementation(() => { throw new Error('projection failed'); });
  const response = await f.request();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false, code: 'interactions_read_failed' });
  expect(f.sent).toHaveLength(1);
});
