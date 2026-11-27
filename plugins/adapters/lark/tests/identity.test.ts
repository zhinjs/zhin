import { expect, it, vi } from 'vitest';
import { defineAdapter } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';
import { LarkAdapter } from '../src/adapter.js';
import type { LarkFetch } from '../src/client.js';
import type { LarkEndpointConfig } from '../src/protocol.js';

const OLD_SECRET = 'revoked-secret-0123456789', NEW_SECRET = 'rotated-secret-9876543210';
const config: LarkEndpointConfig = { id: 'bot', appId: 'cli_fixture', appSecret: OLD_SECRET, mode: 'websocket' };

/** Lark answers in process: the saved (old) secret is already revoked, the new one is valid. */
function larkFetch() {
  return vi.fn<LarkFetch>(async (url, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { app_secret?: string } : {};
    const json = new URL(url).pathname.includes('/auth/')
      ? (body.app_secret === NEW_SECRET ? { code: 0, tenant_access_token: 'issued', expire: 7200 } : { code: 10014, msg: 'app secret invalid' })
      : { code: 0, bot: { open_id: 'ou_fixture' } };
    return { ok: true, status: 200, text: async () => JSON.stringify(json), json: async () => json };
  });
}

class ProbeAdapter extends LarkAdapter {
  probe(input: LarkEndpointConfig, role?: 'previous' | 'next') {
    return this.identifyConfiguration(input, new AbortController().signal, ['appSecret'], role ? { role } : undefined);
  }
}

async function fixture(fetch: LarkFetch) {
  let adapter!: ProbeAdapter;
  const harness = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: context => adapter = new ProbeAdapter(context, { fetch }) }), {},
    { repository: new MemoryDesiredRepository() });
  return { adapter, harness };
}

// #1250 b115: rotating appSecret must work while the saved secret is already revoked.
it('answers the saved configuration offline and proves only the new one', async () => {
  const fetch = larkFetch();
  const { adapter, harness } = await fixture(fetch);
  try {
    const previous = await adapter.probe(config, 'previous');
    expect(fetch).not.toHaveBeenCalled();
    const next = await adapter.probe({ ...config, appSecret: NEW_SECRET }, 'next');
    expect(next).toBe(previous);
    expect(next).toBe(JSON.stringify(['lark', 'https://open.feishu.cn', 'cli_fixture']));
    expect(fetch.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/bot/v3/info'))).toBe(true);
    expect(fetch.mock.calls.map(([, init]) => String(init?.body ?? '')).join('\n')).not.toContain(OLD_SECRET);
  } finally { await harness.stop(); }
});

it('still proves a configuration when the caller does not say which one it is', async () => {
  const fetch = larkFetch();
  const { adapter, harness } = await fixture(fetch);
  try {
    await expect(adapter.probe(config)).rejects.toThrow();
    expect(fetch).toHaveBeenCalled();
  } finally { await harness.stop(); }
});

// Feishu and Lark Suite are separate platform regions: the API origin stays part of the identity.
it('keeps the platform region in the identity', async () => {
  const { adapter, harness } = await fixture(larkFetch());
  try {
    expect(await adapter.probe({ ...config, isFeishu: false }, 'previous')).toBe(JSON.stringify(['lark', 'https://open.larksuite.com', 'cli_fixture']));
  } finally { await harness.stop(); }
});
