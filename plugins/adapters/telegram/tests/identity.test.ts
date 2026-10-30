import { expect, it, vi } from 'vitest';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { TelegramAdapter } from '../src/adapter.js';
import type { TelegramEndpointConfig } from '../src/protocol.js';

class ProbeAdapter extends TelegramAdapter {
  prove(config: TelegramEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal); }
}
const config = { id: 'bot', token: '123:synthetic', polling: false, webhook: { domain: 'https://fixture.invalid' } };
it('proves the real Telegram identity with only readonly getMe and the operation signal', async () => {
  const abort = new AbortController();
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { id: 123 } })));
  let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context, { fetch }) }), {}, { repository: new MemoryDesiredRepository() });
  try {
    expect(await adapter.prove(config, abort.signal)).toBe(JSON.stringify(['telegram', '123']));
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.telegram.org/bot123:synthetic/getMe', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const calls = fetch.mock.calls as unknown as Array<[string, { signal: AbortSignal }]>;
    expect(calls[0]![1].signal.aborted).toBe(false);
    expect(adapter.list().every(row => adapter.getEndpoint(row.instanceId) === undefined)).toBe(true);
  } finally { await fixture.stop(); }
});
it.each([undefined, null, {}, '123'])('rejects an unproved Telegram ID %j', async id => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { id } })));
  let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context, { fetch }) }), {}, { repository: new MemoryDesiredRepository() });
  try { await expect(adapter.prove(config, new AbortController().signal)).rejects.toThrow('identity response'); }
  finally { await fixture.stop(); }
});
it('does not call Telegram when the identity operation is already cancelled', async () => {
  const fetch = vi.fn(); let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context, { fetch }) }), {}, { repository: new MemoryDesiredRepository() });
  const abort = new AbortController(); abort.abort();
  try { await expect(adapter.prove(config, abort.signal)).rejects.toMatchObject({ code: 'endpoint_cancelled', disposition: 'not_sent' }); expect(fetch).not.toHaveBeenCalled(); }
  finally { await fixture.stop(); }
});
