import { afterEach, expect, it, vi } from 'vitest';
import { withTestUsers } from '../utils/console-users.js';
import { type HttpHost } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import { adapterFeatureId } from '@zhin.js/adapter';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { ImRuntime, RuntimeMessage } from '@zhin.js/core/runtime';
import { registerInteractionRoutes } from '../../../src/instance/console/interaction-routes.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start(target = 'bot', sceneId = 'room', sender = 'configured-owner', answeredBy?: 'anyone') {
  const root = rootPluginId();
  const connection: { target: string; owner: string; placeholder: boolean; socket: { readyState: number }; principalOwner?: string | null } =
    { target, owner: 'configured-owner', placeholder: false, socket: { readyState: 1 } };
  const live = { self: undefined as string | undefined, asked: [] as unknown[] };
  const index = { $projection: 'zhin.adapter-index/1',
    describe: () => [{ id: 'canonical-endpoint', name: 'sandbox-slot', admitted: true }],
    clientAdapter: () => 'sandbox', capabilityProfile: () => ({ default: { runtime: { sandbox: true } } }), clientById: () => ({ connectionById: (id: string) => id === 'live-connection' ? connection : undefined,
      chatIdentityOf: (id: string, scene: unknown) => { live.asked.push([id, scene]); return live.self; } }) };
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map(), resources: new Map(), capabilities: new Map(), projections: new Map([[adapterFeatureId, index]]) };
  const snapshots = new SnapshotStore(state), im = new ImRuntime();
  im.attach(snapshots);
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { operator: 'owner', demo: 'none' });
  cleanups.push(() => snapshots.close(), () => http.close());
  registerInteractionRoutes({ http, base: '/api', im, snapshots });
  const { port } = await http.listen();
  const conversation = { endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group' as const, id: sceneId };
  const controller = new AbortController(), sent: unknown[] = [];
  const answer = im.createInteraction(new RuntimeMessage(
    { conversation: conversation, content: 'start', sender: { id: sender } },
    {
      generation: 0,
      reply: async (content) => {
        sent.push(content);
        return { status: 'sent' };
      },
    },
  ))!.ask({ type: 'confirm', title: 'Current approval', signal: controller.signal, ...(answeredBy ? { answeredBy } : {}) }).catch(error => error);
  cleanups.push(async () => { controller.abort(); await answer; });
  await Promise.resolve(); await Promise.resolve();
  const request = (query: Record<string, string> = {}, token = 'operator') => fetch(`http://127.0.0.1:${port}/api/interactions/pending?${new URLSearchParams({
    connectionId: 'live-connection', sessionKey: `sandbox:${target}:group:${sceneId}`, ...query,
  })}`, { headers: { authorization: `Bearer ${token}` } });
  return { request, im, sent, connection, live, controller, answer, snapshots, state };
}

it('reads the actual current prompt using server-owned canonical endpoint, owner and generation', async () => {
  const f = await start(), read = vi.spyOn(f.im, 'listPendingInteractions');
  const response = await f.request({ subjectId: 'forged-subject' });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { data } = await response.json();
  // Asked of a real identity that is not the requester's: shown read-only, its id never sent.
  expect(data).toMatchObject({ generation: 0, pending: [{ generation: 0, answerAs: { kind: 'other' } }] });
  expect(JSON.stringify(data.pending[0].answerAs)).not.toContain('configured-owner');
  expect(data.pending[0].conversation).toBeUndefined();
  expect(data.pending[0].segments).toEqual(f.sent[0]);
  expect(read).toHaveBeenCalledWith({ endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group', id: 'room' }, 0);
  expect(f.sent).toHaveLength(1);
});

it('reads pending prompts when the bound target and scene both contain colons', async () => {
  const f = await start('a:b', 'room:part'), read = vi.spyOn(f.im, 'listPendingInteractions');
  const response = await f.request(); expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.pending).toHaveLength(1);
  expect(read).toHaveBeenCalledWith({ endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group', id: 'room:part' }, 0);
  expect((await f.request({ sessionKey: 'sandbox:a:b-other:group:room:part' })).status).toBe(403);
});

it('denies Demo before any projection and fails unavailable bindings rather than accepting browser identity', async () => {
  const f = await start(), read = vi.spyOn(f.im, 'listPendingInteractions');
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
  vi.spyOn(f.im, 'listPendingInteractions').mockImplementation(() => { throw new Error('projection failed'); });
  const response = await f.request();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false, code: 'interactions_read_failed' });
  expect(f.sent).toHaveLength(1);
});

it('lists the prompt a Sandbox page actually raised: simulated speakers and open prompts, redacted to an allowlist', async () => {
  // The Sandbox never lets a page speak as `owner`: its senders are `~sim:<typed id>` (ADR 0060 §5.4).
  for (const [sender, answeredBy, answerAs] of [
    ['~sim:dev-user', undefined, { kind: 'simulated', senderId: '~sim:dev-user' }],
    ['~sim:dev-user', 'anyone', { kind: 'anyone' }],
  ] as const) {
    const f = await start('bot', 'room', sender, answeredBy);
    const { data } = await (await f.request()).json();
    expect(data.generation).toBe(0);
    expect(data.pending).toHaveLength(1);
    expect(Object.keys(data.pending[0]).sort()).toEqual(['answerAs', 'expiresAt', 'generation', 'id', 'segments']);
    expect(data.pending[0]).toMatchObject({ generation: 0, answerAs, segments: f.sent[0] });
    expect(JSON.stringify(data)).not.toContain('\\u0000');
    f.controller.abort(); await f.answer;
    expect((await (await f.request()).json()).data.pending).toEqual([]);
  }
});

it('#1250 b114 L2: a prompt asked of the requester\'s own chat identity is answerable as self', async () => {
  const f = await start('bot', 'room', 'console-operator');
  f.live.self = 'console-operator';
  const { data } = await (await f.request()).json();
  expect(data.pending[0].answerAs).toEqual({ kind: 'self' });
  expect(f.live.asked).toEqual([['live-connection', { endpoint: { adapter: 'sandbox', id: 'canonical-endpoint' }, kind: 'group', id: 'room' }]]);
  // Another user's identity stays `other`, even when the requester has an identity of their own.
  f.live.self = 'console-someone-else';
  expect((await (await f.request()).json()).data.pending[0].answerAs).toEqual({ kind: 'other' });
});

it('#1250 b114 L1: a connection opened by another Console principal is refused with 403 before any read', async () => {
  const f = await start(), read = vi.spyOn(f.im, 'listPendingInteractions');
  f.connection.principalOwner = 'user:someone-else';
  const refused = await f.request();
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ success: false, code: 'sandbox_connection_forbidden' });
  f.connection.principalOwner = null;
  expect((await f.request()).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  // The requester's own connection (`operator` is the signed-in user of these requests) is read.
  f.connection.principalOwner = 'user:operator';
  expect((await f.request()).status).toBe(200);
});
