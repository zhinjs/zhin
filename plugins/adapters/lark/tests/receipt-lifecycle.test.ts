import { expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig, type LarkMessage } from '../src/protocol.js';

it.each(['close', 'stop'] as const)('owns a slow role lookup through %s and rejects later callbacks', async action => {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  let release!: () => void;
  const role = new Promise<void>(resolve => { release = resolve; });
  const receive = vi.fn(async (_event: unknown) => undefined);
  const fetch = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    if (url.includes('/im/v1/chats/')) await new Promise<void>((resolve, reject) => {
      role.then(resolve, reject);
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
    return { ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, tenant_access_token: 'synthetic-token', expire: 7200,
      data: { owner_id: 'other', manager_ids: [] } }) };
  });
  const h = await createEndpointHarness(() => new LarkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'),
    config: resolveLarkConfig({ id: 'synthetic', appId: 'synthetic-app', appSecret: 'synthetic-secret' }), http, fetch }),
    { gateway: createTestEventGateway({ receive }), operations: ['recall'] });
  const event: LarkMessage = { message_id: 'accepted', chat_id: 'group', chat_type: 'group', sender: { sender_id: { open_id: 'user' } }, message_type: 'text', content: '{"text":"hello"}' };
  let closing: Promise<void> | undefined;
  try {
    await h.start(); h.open(); h.endpoint.admit(event);
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('/im/v1/chats/'))).toBe(true));
    let closed = false; closing = (action === 'close' ? h.close() : h.stop()).then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed).toBe(action === 'stop');
    h.endpoint.admit({ ...event, message_id: 'late' });
    release(); await closing;
    if (action === 'close') { expect(receive).toHaveBeenCalledOnce(); expect(receive.mock.calls[0]![0]).toMatchObject({ event }); }
    else expect(receive).not.toHaveBeenCalled();
  } finally { release(); await closing; await h.stop(); await http.close(); }
});
