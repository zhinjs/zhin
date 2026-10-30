import { afterEach, expect, it, vi } from 'vitest';
import { REST } from 'discord.js';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { DiscordAdapter } from '../src/adapter.js';
import type { DiscordEndpointConfig } from '../src/protocol.js';

class ProbeAdapter extends DiscordAdapter {
  prove(config: DiscordEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal); }
}
const config = { id: 'bot', token: 'synthetic', connection: 'interactions' as const, applicationId: 'app', publicKey: 'a'.repeat(64) };
const nativeGet = REST.prototype.get;
afterEach(() => vi.restoreAllMocks());
async function probe(response: object) {
  const requests: Array<{ url: string; method?: string; signal?: unknown }> = [];
  vi.spyOn(REST.prototype, 'get').mockImplementation(function (path, options) {
    this.options.makeRequest = async (url, init) => {
      init.signal?.throwIfAborted();
      requests.push({ url: String(url), method: init.method, signal: init.signal });
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return nativeGet.call(this, path, options);
  });
  let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context) }), {}, { repository: new MemoryDesiredRepository() });
  return { adapter, fixture, requests };
}
it('uses the actual readonly current-application route to bind the token, app ID and verification key', async () => {
  const { adapter, fixture, requests } = await probe({ id: 'app', verify_key: 'A'.repeat(64) });
  try {
    expect(await adapter.prove(config, new AbortController().signal)).toBe(JSON.stringify(['discord', 'app']));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://discord.com/api/v10/applications/@me', method: 'GET', signal: expect.any(AbortSignal) });
    expect(adapter.list().every(row => adapter.getEndpoint(row.instanceId) === undefined)).toBe(true);
  } finally { await fixture.stop(); }
});
it.each([{ id: 'other', verify_key: 'a'.repeat(64) }, { id: 'app', verify_key: 'b'.repeat(64) }, { id: {}, verify_key: 'a'.repeat(64) }])('rejects an unproved Discord application configuration %j', async response => {
  const { adapter, fixture } = await probe(response);
  try { await expect(adapter.prove(config, new AbortController().signal)).rejects.toThrow('identity'); }
  finally { await fixture.stop(); }
});
it('does not send a cancelled Discord identity request', async () => {
  const { adapter, fixture, requests } = await probe({ id: 'app', verify_key: 'a'.repeat(64) });
  const abort = new AbortController(); abort.abort();
  try { await expect(adapter.prove(config, abort.signal)).rejects.toBeInstanceOf(Error); expect(requests).toHaveLength(0); }
  finally { await fixture.stop(); }
});
