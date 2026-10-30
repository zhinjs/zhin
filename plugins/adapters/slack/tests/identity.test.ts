import { expect, it, vi } from 'vitest';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { SlackAdapter } from '../src/adapter.js';
import type { SlackEndpointConfig } from '../src/protocol.js';

class ProbeAdapter extends SlackAdapter {
  prove(config: SlackEndpointConfig, signal: AbortSignal, changed: readonly string[]) { return this.identifyConfiguration(config, signal, changed); }
}
const config = { id: 'bot', token: 'synthetic', socketMode: false, signingSecret: 'synthetic-signing' };
async function probe(response: object) {
  const requests: Array<{ url?: string; signal?: unknown }> = [];
  let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context, {
    adapter: async request => { requests.push(request); return { config: request, data: response, status: 200, statusText: 'OK', headers: {}, request: { path: '/api/auth.test' } }; },
  }) }), {}, { repository: new MemoryDesiredRepository() });
  return { adapter, fixture, requests };
}
it('uses actual SDK auth.test to bind team plus bot user, without creating a Socket or Endpoint', async () => {
  const { adapter, fixture, requests } = await probe({ ok: true, team_id: 'T1', user_id: 'U1' });
  const abort = new AbortController();
  try {
    expect(await adapter.prove(config, abort.signal, ['token'])).toBe(JSON.stringify(['slack', 'T1', 'U1']));
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ url: 'https://slack.com/api/auth.test', signal: abort.signal });
    expect(adapter.list().every(row => adapter.getEndpoint(row.instanceId) === undefined)).toBe(true);
  } finally { await fixture.stop(); }
});
it.each(['appToken', 'signingSecret'])('does not substitute bot auth.test for unprovable %s identity', async field => {
  const { adapter, fixture, requests } = await probe({ ok: true, team_id: 'T1', user_id: 'U1' });
  try { expect(await adapter.prove(config, new AbortController().signal, [field])).toBeUndefined(); expect(requests).toHaveLength(0); }
  finally { await fixture.stop(); }
});
it.each([{ team_id: {}, user_id: 'U1' }, { team_id: 'T1', user_id: ' ' }])('rejects malformed Slack identity fields %j', async response => {
  const { adapter, fixture } = await probe({ ok: true, ...response });
  try { await expect(adapter.prove(config, new AbortController().signal, ['token'])).rejects.toThrow('identity response'); }
  finally { await fixture.stop(); }
});
it('cancels before SDK auth transport admission', async () => {
  const { adapter, fixture, requests } = await probe({ ok: true, team_id: 'T1', user_id: 'U1' });
  const abort = new AbortController(); abort.abort();
  try { await expect(adapter.prove(config, abort.signal, ['token'])).rejects.toBeInstanceOf(Error); expect(requests).toHaveLength(0); }
  finally { await fixture.stop(); }
});
