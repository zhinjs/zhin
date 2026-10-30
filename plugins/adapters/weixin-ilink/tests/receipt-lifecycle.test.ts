import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { capabilityId, rootPluginId, featureId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';
import * as media from '../src/media-download.js';
import { downloadPlainCdnBuffer } from '../src/pic-decrypt.js';
import { idleIlinkTransport, idleIlinkUpdates } from './transport-fixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['close', 'stop', 'decoder-stop'] as const)('owns an accepted media callback through %s without acknowledging a retired account', async action => {
  const directory = mkdtempSync(join(tmpdir(), 'ilink-receipt-'));
  let release!: () => void;
  const download = new Promise<void>(resolve => { release = resolve; });
  const mediaRead = vi.spyOn(media, 'downloadMediaFromItem').mockImplementation(async (_item, options) => {
    await new Promise<void>((resolve, reject) => {
      download.then(resolve, reject);
      if (action !== 'decoder-stop') options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }); return {};
  });
  const message = { from_user_id: 'user', message_id: 1, message_type: 1, message_state: 2,
    item_list: [{ type: 2, image_item: { media: { full_url: 'https://synthetic.invalid/image' } } }] };
  const config = resolveWeixinIlinkConfig({ id: 'synthetic', botToken: 'synthetic-token', dataDir: directory });
  const state = new WeixinIlinkStateStore(config.id, directory), save = vi.spyOn(state, 'saveSyncBuf');
  const updates = vi.fn().mockResolvedValueOnce({ get_updates_buf: 'after', msgs: [message] }).mockImplementation(idleIlinkUpdates);
  const receive = vi.fn(async (_event: unknown) => undefined);
  const h = await createEndpointHarness(() => new WeixinIlinkEndpoint({ ...idleIlinkTransport,
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'synthetic'), config, state,
    resolveCredentials: async () => ({ botToken: 'synthetic-token' }), getUpdates: updates,
  }), { capabilities: ['inbound', 'outbound'], operations: ['typing'], gateway: createTestEventGateway({ receive }) });
  let closing: Promise<void> | undefined;
  try {
    await h.start(); h.open(); await vi.waitFor(() => expect(mediaRead).toHaveBeenCalledOnce());
    let closed = false; closing = (action === 'close' ? h.close() : h.stop()).then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(action !== 'close');
    release(); await closing;
    if (action === 'close') { expect(receive).toHaveBeenCalledOnce(); expect(receive.mock.calls[0]![0]).toMatchObject({ event: message }); }
    else expect(receive).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  } finally { release(); await closing; await h.stop(); rmSync(directory, { recursive: true, force: true }); }
});

it('passes retirement to the actual CDN fetch without a new timeout or a provider request', async () => {
  const retirement = new AbortController();
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
  vi.stubGlobal('fetch', fetch);
  const request = downloadPlainCdnBuffer('', 'https://synthetic.invalid', 'synthetic', 'https://synthetic.invalid/media', retirement.signal);
  const failed = expect(request).rejects.toThrow('Synthetic account retired');
  retirement.abort(new Error('Synthetic account retired'));
  await failed;
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://synthetic.invalid/media', { signal: retirement.signal });
});
