import WebSocket, { WebSocketServer } from 'ws';
import { createHttpHost, httpHostToken } from '@zhin.js/host-http';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import definition from '../adapters/onebot11/index.js';
import { Onebot11Client } from '../src/client.js';
import type { EndpointSendRequest } from 'zhin.js/adapter';

/** Real Adapter/SDK protocol path; only the external platform is a local peer. */
async function fixture(connection: 'ws' | 'wss') {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const server = connection === 'ws' ? new WebSocketServer({ host: '127.0.0.1', port: 0 }) : undefined;
  const actions: Array<{ action: string; echo: string }> = [];
  let peer: WebSocket | undefined;
  const observe = (socket: WebSocket) => { peer = socket; socket.on('message', raw => {
    const request = JSON.parse(String(raw));
    if (request.action === 'get_login_info') socket.send(JSON.stringify({status:'ok', retcode:0, echo:request.echo, data:{user_id:123}}));
    else actions.push(request);
  }); };
  if (server) { server.on('connection', observe); await new Promise<void>(resolve => server.once('listening', resolve)); }
  const address = server?.address();
  const harness = await createAdapterHarness(definition, { id: 'synthetic', connection,
    access_token: 'synthetic', path: '/onebot11', heartbeat_interval: 60_000,
    url: address && typeof address !== 'string' ? `ws://127.0.0.1:${address.port}` : undefined,
  }, { name: 'onebot11', resources: new Map([[httpHostToken.id, http]]) });
  await harness.start(); harness.open();
  if (connection === 'wss') {
    const { port } = await http.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/onebot11`, { headers: { Authorization: 'Bearer synthetic' } });
    observe(socket); await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await vi.waitFor(() => expect(harness.index.describe()[0]?.transportState).toBe('open'));
  }
  const request: EndpointSendRequest = { conversation: { endpoint: { adapter: 'onebot11', id: harness.canonicalId }, kind: 'private', id: 'user' },
    payload: 'synthetic message' };
  return { ...harness, actions, request, response: (index: number, data: unknown) => peer!.send(JSON.stringify({ status: 'ok', retcode: 0, echo: actions[index]!.echo, data })),
    async cleanup() { peer?.terminate(); await harness.stop(); await http.close(); if (server) { for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } } };
}

it.each(['ws', 'wss'] as const)('%s account retirement cancels a pending send without waiting for its response', async mode => {
  const h = await fixture(mode);
  const sending = h.send(h.request).then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['send_private_msg']));
    const stopped = h.index.stop(); let completed = false; void stopped.then(() => { completed = true; });
    await vi.waitFor(() => expect(completed).toBe(true), { timeout: 200 });
    expect(await sending).toMatchObject({ error: { disposition: 'unknown' } });
    expect(h.actions.map(action => action.action)).toEqual(['send_private_msg']);
    await stopped;
  } finally { await h.cleanup(); await sending; }
});

it.each(['ws', 'wss'] as const)('%s request cancellation leaves the account usable and ignores late responses', async mode => {
  const h = await fixture(mode); const caller = new AbortController();
  const sending = h.send({ ...h.request, signal: caller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.actions).toHaveLength(1));
    caller.abort(new Error('synthetic operation ended'));
    let result: Awaited<typeof sending> | undefined; void sending.then(value => { result = value; });
    await vi.waitFor(() => expect(result).toMatchObject({ error: { disposition: 'unknown' } }), { timeout: 200 });
    h.response(0, { message_id: 99 });
    const next = h.send({ ...h.request, payload: 'next message' });
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['send_private_msg', 'send_private_msg']));
    h.response(1, { message_id: 42 }); await expect(next).resolves.toBe('42');
    expect(h.index.describe()[0]?.transportState).toBe('open');
  } finally { await h.cleanup(); await sending; }
});

it.each(['ws', 'wss'] as const)('%s content lookup cancellation releases the operation without retiring the account', async mode => {
  const h = await fixture(mode), caller = new AbortController();
  const lookup = h.index.resolveContent(h.canonicalId, { kind: 'message', message: { conversation: h.request.conversation, id: '42' } },
    { signal: caller.signal, maxDepth: 2, maxEntries: 10, maxChars: 1000 });
  try {
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['get_msg']));
    caller.abort(); await expect(lookup).resolves.toMatchObject({ status: 'expired' });
    h.response(0, { message: [] });
    const next = h.send({ ...h.request, payload: 'next message' });
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['get_msg', 'send_private_msg']));
    h.response(1, { message_id: 42 }); await expect(next).resolves.toBe('42');
  } finally { await h.cleanup(); await lookup; }
});

it.each(['ws', 'wss'] as const)('%s final stop removes framework subscriptions while retaining native user listeners', async mode => {
  const h = await fixture(mode); const client = h.endpoint;
  if (!(client instanceof Onebot11Client)) throw new Error('Native SDK Client was not retained');
  const observer = vi.fn(); client.on('event', observer);
  try {
    expect(client.listenerCount('event')).toBeGreaterThan(1);
    await h.index.stop(); expect(client.listeners('event')).toEqual([observer]);
  } finally { client.off('event', observer); await h.cleanup(); }
});

it.each([
  { mode: 'ws', authority: 'caller' }, { mode: 'wss', authority: 'caller' },
  { mode: 'ws', authority: 'source' }, { mode: 'wss', authority: 'source' },
] as const)('$mode $authority recall cancellation reaches RPC and leaves the account usable', async ({ mode, authority }) => {
  const h = await fixture(mode), caller = new AbortController();
  const control = h.index.control(h.canonicalId, 'recall', authority === 'source' ? { signal: caller.signal } : undefined);
  if (!control?.recall) throw new Error('Declared recall port is missing');
  const pending = control.recall({ message: { conversation: h.request.conversation, id: '42' },
    ...(authority === 'caller' ? { signal: caller.signal } : {}) })
    .then(() => ({ success: true }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['delete_msg']));
    caller.abort(); await expect(pending).resolves.toMatchObject({ error: { disposition: 'unknown' } });
    h.response(0, {});
    const next = h.send({ ...h.request, payload: 'next message' });
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['delete_msg', 'send_private_msg']));
    h.response(1, { message_id: 42 }); await expect(next).resolves.toBe('42');
  } finally { await h.cleanup(); await pending; }
});

it.each(['ws', 'wss'] as const)('%s management retains both caller and captured source lifetimes', async mode => {
  const h = await fixture(mode), source = new AbortController(), caller = new AbortController();
  const management = h.index.management(h.canonicalId, { signal: source.signal });
  const listing = management.listGroups!({ signal: caller.signal }).then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['get_group_list']));
    caller.abort(); await expect(listing).resolves.toMatchObject({ error: { disposition: 'unknown' } });
    h.response(0, []);
    const second = management.listFriends!().then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(h.actions.map(action => action.action)).toEqual(['get_group_list', 'get_friend_list']));
    source.abort(); await expect(second).resolves.toMatchObject({ error: { disposition: 'unknown' } });
    const fresh = h.index.management(h.canonicalId)!.listGroups!();
    await vi.waitFor(() => expect(h.actions).toHaveLength(3)); h.response(2, []);
    await expect(fresh).resolves.toEqual([]);
  } finally { await h.cleanup(); await listing; }
});
