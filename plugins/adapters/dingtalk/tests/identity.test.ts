import { expect, it, vi } from 'vitest';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { DingTalkAdapter } from '../src/adapter.js';
import type { DingTalkFetch } from '../src/client.js';
import type { DingTalkEndpointConfig } from '../src/protocol.js';

class ProbeAdapter extends DingTalkAdapter {
  prove(config: DingTalkEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal, ['appSecret']); }
}
const SECRET = 'rotated-secret-0123456789';
const config: DingTalkEndpointConfig = { id: 'bot', appKey: 'ding-app-key', appSecret: SECRET };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
async function probe(fetch: DingTalkFetch) {
  let adapter!: ProbeAdapter;
  const fixture = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context, { fetch }) }), {},
    { repository: new MemoryDesiredRepository() });
  return { adapter, fixture };
}

// #1250 b115: rotating only appSecret is proved with one read-only gettoken, not refused as unverifiable.
it('proves the DingTalk app identity with one gettoken call', async () => {
  const fetch = vi.fn<DingTalkFetch>(async () => reply({ errcode: 0, errmsg: 'ok', access_token: 'issued', expires_in: 7200 }));
  const { adapter, fixture } = await probe(fetch);
  try {
    expect(await adapter.prove(config, new AbortController().signal)).toBe(JSON.stringify(['dingtalk', 'https://oapi.dingtalk.com', 'ding-app-key']));
    expect(fetch).toHaveBeenCalledOnce();
    const [url] = fetch.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/gettoken');
    expect(new URL(url).searchParams.get('appkey')).toBe('ding-app-key');
    expect(new URL(url).searchParams.get('appsecret')).toBe(SECRET);
  } finally { await fixture.stop(); }
});

it('rejects a wrong appSecret with DingTalk errcode and errmsg, never the secret', async () => {
  const fetch = vi.fn<DingTalkFetch>(async () => reply({ errcode: 40089, errmsg: `不合法的corpid或corpsecret appsecret=${encodeURIComponent(SECRET)} ${SECRET}` }));
  const { adapter, fixture } = await probe(fetch);
  try {
    const error = await adapter.prove(config, new AbortController().signal).then(() => undefined, (cause: unknown) => cause as Error);
    expect(error?.message).toMatch(/^DingTalk identity verification failed: .*不合法的corpid或corpsecret.*\(errcode 40089\)$/u);
    expect(error?.message).not.toContain(SECRET);
    expect(error?.message).not.toContain('0123456789');
  } finally { await fixture.stop(); }
});

it('rejects an HTTP failure without calling DingTalk again', async () => {
  const fetch = vi.fn<DingTalkFetch>(async () => reply({}, 503));
  const { adapter, fixture } = await probe(fetch);
  try {
    await expect(adapter.prove(config, new AbortController().signal)).rejects.toThrow('DingTalk identity verification failed: HTTP 503');
    expect(fetch).toHaveBeenCalledOnce();
  } finally { await fixture.stop(); }
});
