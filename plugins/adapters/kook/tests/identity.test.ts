import { afterEach, expect, it, vi } from 'vitest';
import { Client } from 'kook-client';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { KookAdapter } from '../src/adapter.js';
import { RuntimeKookClient } from '../src/ws.js';
import type { KookEndpointConfig } from '../src/protocol.js';

class ProbeAdapter extends KookAdapter {
  prove(config: KookEndpointConfig, signal: AbortSignal, changed: readonly string[]) { return this.identifyConfiguration(config, signal, changed); }
}
const config = { id: 'bot', token: 'synthetic' };
const nativeSelf = Client.prototype.getSelfInfo;
afterEach(() => vi.restoreAllMocks());
async function probe(result: object) {
  const requests: Array<{ url?: string; method?: string; signal?: unknown }> = [];
  const connect = vi.spyOn(RuntimeKookClient.prototype, 'connect').mockRejectedValue(new Error('Identity must never connect a Gateway'));
  vi.spyOn(RuntimeKookClient.prototype, 'getSelfInfo').mockImplementation(function () {
    expect(this.config.mode).toBe('webhook');
    this.request.defaults.adapter = async request => {
      requests.push(request); return { config: request, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: result } };
    };
    return nativeSelf.call(this);
  });
  let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context) }), {}, { repository: new MemoryDesiredRepository() });
  return { adapter, fixture, requests, connect };
}
it('uses actual SDK GET /v3/user/me without Gateway construction/start or cache preload', async () => {
  const { adapter, fixture, requests, connect } = await probe({ id: 'account' });
  const abort = new AbortController();
  try {
    expect(await adapter.prove(config, abort.signal, ['token'])).toBe(JSON.stringify(['kook', 'account']));
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ url: '/v3/user/me', method: 'get', signal: abort.signal });
    expect(connect).not.toHaveBeenCalled();
    expect(adapter.list().every(row => adapter.getEndpoint(row.instanceId) === undefined)).toBe(true);
  } finally { await fixture.stop(); }
});
it.each(['verify_token', 'encrypt_key'])('requires explicit replacement for an unprovable %s change', async field => {
  const { adapter, fixture, requests } = await probe({ id: 'account' });
  try { expect(await adapter.prove(config, new AbortController().signal, [field])).toBeUndefined(); expect(requests).toHaveLength(0); }
  finally { await fixture.stop(); }
});
it.each([{ id: {} }, { id: ' ' }])('rejects malformed KOOK identity %j', async response => {
  const { adapter, fixture } = await probe(response);
  try { await expect(adapter.prove(config, new AbortController().signal, ['token'])).rejects.toThrow('identity'); }
  finally { await fixture.stop(); }
});
it('cancels before the actual SDK HTTP submission', async () => {
  const { adapter, fixture, requests } = await probe({ id: 'account' });
  const abort = new AbortController(); abort.abort();
  try { await expect(adapter.prove(config, abort.signal, ['token'])).rejects.toBeInstanceOf(Error); expect(requests).toHaveLength(0); }
  finally { await fixture.stop(); }
});
