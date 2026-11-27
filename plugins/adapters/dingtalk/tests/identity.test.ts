import { expect, it, vi } from 'vitest';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { DingTalkAdapter } from '../src/adapter.js';
import { dingtalkFailureReason, type DingTalkFetch } from '../src/client.js';
import type { DingTalkEndpointConfig } from '../src/protocol.js';
import { httpHostToken } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import definition from '../adapters/dingtalk/index.js';

class ProbeAdapter extends DingTalkAdapter {
  prove(config: DingTalkEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal, ['appSecret']); }
  provePrevious(config: DingTalkEndpointConfig, signal: AbortSignal) { return this.identifyConfiguration(config, signal, ['appSecret'], { role: 'previous' }); }
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
    expect(await adapter.prove(config, new AbortController().signal)).toBe(JSON.stringify(['dingtalk', 'ding-app-key']));
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

it('answers the saved configuration offline: its appSecret may already be revoked', async () => {
  const fetch = vi.fn<DingTalkFetch>(async () => reply({ errcode: 40089, errmsg: 'invalid' }));
  const { adapter, fixture } = await probe(fetch);
  try {
    expect(await adapter.provePrevious({ ...config, apiBaseUrl: 'https://dingtalk-proxy.example.com' }, new AbortController().signal))
      .toBe(JSON.stringify(['dingtalk', 'ding-app-key']));
    expect(fetch).not.toHaveBeenCalled();
  } finally { await fixture.stop(); }
});

const OLD_SECRET = 'revoked-secret-0123456789', NEW_SECRET = 'rotated-secret-9876543210';
/** The real Adapter definition through the Index; every DingTalk request is answered in process. */
async function account() {
  const revoked = new Set<string>();
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/gettoken')) {
      // The saved secret was reset in the DingTalk console (or revoked after a leak): 40089.
      return new Response(JSON.stringify(!revoked.has(parsed.searchParams.get('appsecret') ?? '')
        ? { errcode: 0, errmsg: 'ok', access_token: 'issued', expires_in: 7200 }
        : { errcode: 40089, errmsg: '不合法的corpid或corpsecret' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(definition, { id: 'bot', appKey: 'ding-app-key', appSecret: OLD_SECRET, mode: 'webhook', webhookPath: '/dingtalk' },
    { name: 'dingtalk', repository, resources: new Map([[httpHostToken.id, http]]) });
  await h.start(); h.open();
  const original = h.adapter.list()[0]!;
  const gettoken = () => fetch.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname.endsWith('/gettoken'));
  return { ...h, fetch, repository, original, gettoken, revoke: (secret: string) => revoked.add(secret),
    async cleanup() { await h.stop(); await http.close(); vi.unstubAllGlobals(); } };
}

// #1250 b115 H1: the old secret no longer works, which is why it is rotated; the rotation must still succeed.
it('rotates only appSecret with one gettoken on the new secret while the saved one is already revoked', async () => {
  const h = await account();
  try {
    // Stopped, so the only DingTalk call left is the identity proof; then the saved secret is revoked.
    await h.adapter.stop(h.original.instanceId, h.adapter.revision);
    h.revoke(OLD_SECRET);
    h.fetch.mockClear();
    await expect(h.adapter.patchConfiguration(h.original.instanceId, h.adapter.revision, { appSecret: NEW_SECRET }))
      .resolves.toMatchObject({ endpoints: [expect.objectContaining({ instanceId: h.original.instanceId })] });
    const calls = h.gettoken();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get('appsecret')).toBe(NEW_SECRET);
    expect(h.repository.snapshot?.endpoints[0]?.config).toMatchObject({ appSecret: NEW_SECRET });
  } finally { await h.cleanup(); }
});

// #1250 b115 M1: apiBaseUrl is only the API entry (e.g. a reverse proxy), not another account.
it('keeps the running account when only apiBaseUrl changes', async () => {
  const h = await account();
  try {
    expect(h.original.desiredEnabled).toBe(true);
    const result = await h.adapter.patchConfiguration(h.original.instanceId, h.adapter.revision, { apiBaseUrl: 'https://dingtalk-proxy.example.com' });
    expect(result.endpoints).toHaveLength(1);
    const row = h.adapter.list()[0]!;
    expect(row.instanceId).toBe(h.original.instanceId);
    expect(row.canonicalId).toBe(h.original.canonicalId);
    expect(row.desiredEnabled).toBe(true);
    await vi.waitFor(() => expect(h.adapter.getEndpoint(h.original.instanceId)).toBeDefined());
    // The new entry is proved once (and the restarted Endpoint fetches its token there too).
    expect(h.gettoken().filter(url => url.origin === 'https://dingtalk-proxy.example.com').length).toBeGreaterThanOrEqual(1);
  } finally { await h.cleanup(); }
});

// #1250 b115 L2: errcode is only shown when it is a number; URL-encoded secrets are masked in either hex case.
it('shows errcode only when numeric and masks lowercase percent-encoded secrets', () => {
  const secret = 'a/b+c=d0123456789';
  const encoded = encodeURIComponent(secret);
  expect(encoded).toMatch(/%2F/u);
  const lower = encoded.replace(/%[0-9A-F]{2}/gu, part => part.toLowerCase());
  const reason = dingtalkFailureReason({ errcode: 40089, errmsg: `bad ${lower} ${encoded} ${secret}` }, [secret]);
  expect(reason).toBe('bad *** *** *** (errcode 40089)');
  expect(dingtalkFailureReason({ errcode: '40089', errmsg: 'x' }, [])).toBe('x (errcode 40089)');
  for (const errcode of [undefined, null, Number.NaN, Infinity, 'abc token=leaked', { toString: () => 'leaked' }, '12 34']) {
    expect(dingtalkFailureReason({ errcode, errmsg: 'x' }, [])).toBe('x (errcode unknown)');
  }
});
