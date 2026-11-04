import { afterEach, expect, it, vi } from 'vitest';
import { defineAdapter, type EndpointDesiredRepository } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { NapcatAdapter } from '../src/adapter.js';
import { type NapCatEndpointConfig } from '../src/protocol.js';
import { MilkyAdapter } from '../../milky/src/adapter.js';
import type { MilkyEndpointConfig } from '../../milky/src/protocol.js';
import { BilibiliLiveClient } from '../../bilibili-live/src/client.js';
import { resolveBilibiliLiveConfig } from '../../bilibili-live/src/protocol.js';
import { BilibiliAdapter } from '../../bilibili/src/adapter.js';
import type { BilibiliEndpointConfig } from '../../bilibili/src/protocol.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0)) await stop(); vi.unstubAllGlobals(); });
const repository: EndpointDesiredRepository = { load: async () => ({ revision: 1, endpoints: [] }), compareAndSet: async () => { throw new Error('A read-only identity probe must not save'); } };
async function qqProbe(kind: 'napcat' | 'milky', value: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', retcode: 0,
    data: kind === 'napcat' ? { user_id: value } : { uin: value } }))));
  let probe: ((signal: AbortSignal) => Promise<string | undefined>) | undefined;
  if (kind === 'napcat') {
    class Inspect extends NapcatAdapter { inspect(config: NapCatEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal); } }
    const config: NapCatEndpointConfig = { id: 'fixture', connection: 'http', http_url: 'https://offline.invalid', post_path: '/offline' };
    const definition = defineAdapter<NapCatEndpointConfig>({ capabilities: ['inbound'], createAdapter(context) {
      const adapter = new Inspect(context); probe = signal => adapter.inspect(config, signal); return adapter;
    } });
    const h = await createAdapterHarness(definition, config, { name: kind, repository }); cleanup.push(h.stop); await h.start();
  } else {
    class Inspect extends MilkyAdapter { inspect(config: MilkyEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal); } }
    const config: MilkyEndpointConfig = { id: 'fixture', baseUrl: 'https://offline.invalid' };
    const definition = defineAdapter<MilkyEndpointConfig>({ capabilities: ['inbound'], createAdapter(context) {
      const adapter = new Inspect(context); probe = signal => adapter.inspect(config, signal); return adapter;
    } });
    const h = await createAdapterHarness(definition, config, { name: kind, repository }); cleanup.push(h.stop); await h.start();
  }
  if (!probe) throw new Error('Actual Adapter identity probe is missing'); return probe(new AbortController().signal);
}
it.each(['napcat', 'milky'] as const)('%s does not bind the known zero or empty QQ self-ID sentinel', async kind => {
  await expect(qqProbe(kind, 0)).resolves.toBeUndefined(); await expect(qqProbe(kind, '0')).resolves.toBeUndefined(); await expect(qqProbe(kind, '')).resolves.toBeUndefined();
});
it.each(['napcat', 'milky'] as const)('%s preserves a real nonempty QQ self-ID and rejects malformed identity data', async kind => {
  await expect(qqProbe(kind, 777)).resolves.toBe('qq:777'); await expect(qqProbe(kind, { invalid: true })).rejects.toThrow();
});
it('does not call an explicitly logged-in Bilibili live response with no real mid an anonymous success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { isLogin: true, mid: 0 } }))));
  const config = resolveBilibiliLiveConfig({ id: 'fixture', roomId: 1, sessdata: 'offline' });
  await expect(new BilibiliLiveClient(config, globalThis.fetch).identifySelf()).rejects.toThrow();
});
it('keeps a known logged-out Bilibili live response separate from HTTP lookup failure', async () => {
  const config = resolveBilibiliLiveConfig({ id: 'fixture', roomId: 1, sessdata: 'offline' });
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { isLogin: false } })));
  await expect(new BilibiliLiveClient(config, fetch).identifySelf()).resolves.toBeUndefined();
  fetch.mockResolvedValueOnce(new Response('offline failure', { status: 503 }));
  await expect(new BilibiliLiveClient(config, fetch).identifySelf()).rejects.toThrow();
});
async function commentProbe(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data }))));
  class Inspect extends BilibiliAdapter { inspect(config: BilibiliEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal); } }
  const config: BilibiliEndpointConfig = { id: 'fixture', sessdata: 'offline', videos: [] };
  let probe: (() => Promise<string | undefined>) | undefined;
  const entry = defineAdapter<BilibiliEndpointConfig>({ capabilities: ['inbound'], createAdapter(context) {
    const adapter = new Inspect(context); probe = () => adapter.inspect(config, new AbortController().signal); return adapter;
  } });
  const h = await createAdapterHarness(entry, config, { name: 'bilibili', repository }); cleanup.push(h.stop); await h.start();
  if (!probe) throw new Error('Bilibili Adapter probe is missing'); return probe();
}
it('keeps a confirmed logged-out comment account separate from a malformed logged-in provider response', async () => {
  await expect(commentProbe({ isLogin: false })).resolves.toBeUndefined();
  await expect(commentProbe({ isLogin: true, mid: 0 })).rejects.toThrow();
  await expect(commentProbe({ isLogin: true, mid: 777 })).resolves.toBe('bilibili:777');
});
