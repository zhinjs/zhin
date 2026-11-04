import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import { WeixinContextTokenStore } from '../src/context-store.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';
import { idleIlinkTransport } from './transport-fixture.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.unstubAllGlobals(); });
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ilink-cancellation-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const state = new WeixinIlinkStateStore('synthetic', directory), tokens = new WeixinContextTokenStore(state);
  const bot = await createEndpointHarness(() => new WeixinIlinkEndpoint({ ...idleIlinkTransport,
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'weixin-ilink'),
    config: resolveWeixinIlinkConfig({ id: 'synthetic', dataDir: directory }), state, contextTokens: tokens,
    resolveCredentials: async () => ({ botToken: 'synthetic-token' }),
  }), { name: 'weixin-ilink', capabilities: ['inbound', 'outbound'], operations: ['typing'] });
  cleanups.push(() => bot.stop());
  await bot.start(); bot.open(); tokens.set('peer', 'synthetic-context');
  const conversation = { endpoint: { adapter: 'weixin-ilink', id: bot.canonicalId }, kind: 'private' as const, id: 'peer' };
  return { bot, conversation };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('propagates a single send cancellation to the API and never continues to its media upload', async () => {
  const network = deferred<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>(() => network.promise); vi.stubGlobal('fetch', fetch);
  const { bot, conversation } = await fixture(), caller = new AbortController();
  const send = bot.send({ conversation, signal: caller.signal, payload: [
    { type: 'text', data: { text: 'first' } },
    { type: 'image', data: { media: { kind: 'base64', value: 'aGVsbG8=' } } },
  ] });
  const rejected = expect(send).rejects.toMatchObject({ disposition: 'unknown' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const signal = fetch.mock.calls[0]![1]!.signal!;
  caller.abort(); await rejected; expect(signal.aborted).toBe(true);
  network.resolve(new Response('{}'));
  await new Promise(resolve => setImmediate(resolve));
  expect(fetch).toHaveBeenCalledOnce();
});
it('cancels remote-media preparation without publishing a message or falling through to later text', async () => {
  const network = deferred<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>(() => network.promise); vi.stubGlobal('fetch', fetch);
  const { bot, conversation } = await fixture(), caller = new AbortController();
  const send = bot.send({ conversation, signal: caller.signal, payload: [
    { type: 'image', data: { media: { kind: 'url', value: 'https://synthetic.invalid/media.png' } } },
    { type: 'text', data: { text: 'must not publish' } },
  ] });
  const rejected = expect(send).rejects.toMatchObject({ disposition: 'not_sent' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  caller.abort(); await rejected;
  expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  network.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
  await new Promise(resolve => setImmediate(resolve));
  expect(fetch).toHaveBeenCalledOnce();
});
it('ends a typing waiter while its configuration lookup finishes, without sending late typing', async () => {
  const config = deferred<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>(() => config.promise); vi.stubGlobal('fetch', fetch);
  const { bot, conversation } = await fixture(), caller = new AbortController();
  const typing = bot.index.control(bot.canonicalId, 'typing').typing!({ conversation, active: true, signal: caller.signal });
  const rejected = expect(typing).rejects.toMatchObject({ disposition: 'not_sent' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  caller.abort(); await rejected;
  config.resolve(new Response(JSON.stringify({ ret: 0, typing_ticket: 'synthetic-ticket' })));
  await new Promise(resolve => setImmediate(resolve));
  expect(fetch).toHaveBeenCalledOnce();
});
