import { expect, it, vi } from 'vitest';
import { AdapterIdentityUnsupportedError, defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { WeChatMpAdapter } from '../src/adapter.js';

const SECRET = 'original-secret-0123456789';
const ROTATED = 'rotated-secret-9876543210';
const config = { id: 'mp', appId: 'wx-fixture', appSecret: SECRET, token: 'callback-token' };

async function fixture() {
  let adapter!: WeChatMpAdapter;
  const fetch = vi.spyOn(globalThis, 'fetch');
  const harness = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new WeChatMpAdapter(context) }), { endpoints: [] },
    { repository: new MemoryDesiredRepository() });
  await harness.start(); harness.open();
  const saved = await adapter.add(adapter.revision, { endpointId: 'mp', config });
  return { adapter, harness, fetch, target: saved.endpoints[0]! };
}

// #1250 b115: WeChat has no confirmed read-only proof of a rotated appSecret (cgi-bin/token would
// start the running token's expiry and spend quota), so the refusal says so in Chinese instead of the
// generic "Identity cannot be verified", and calls no WeChat API.
it('refuses an appSecret-only rotation with a Chinese reason, without the secrets and without a token call', async () => {
  const { adapter, harness, fetch, target } = await fixture();
  try {
    const error = await adapter.update(target.instanceId, adapter.revision, { config: { ...config, appSecret: ROTATED } })
      .then(() => undefined, (cause: unknown) => cause as Error & { code?: string });
    expect(error).toMatchObject({ name: 'AdapterIdentityUnsupportedError', code: 'unsupported', message: '微信公众号暂不支持只换密钥，请使用替换账号' });
    // Recognized by its brand, so a framework loaded from another package copy still shows the reason.
    expect(AdapterIdentityUnsupportedError.is(error)).toBe(true);
    expect(error?.message).not.toContain(SECRET);
    expect(error?.message).not.toContain(ROTATED);
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); await harness.stop(); }
});

it('still saves a change that leaves appSecret alone', async () => {
  const { adapter, harness, fetch, target } = await fixture();
  try {
    const result = await adapter.update(target.instanceId, adapter.revision, { config: { ...config, passiveReplyTimeoutMs: 3000 } });
    expect(result.endpoints[0]!.instanceId).toBe(target.instanceId);
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); await harness.stop(); }
});
