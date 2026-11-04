import { expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig, type LarkMessage } from '../src/protocol.js';

it('keeps senderless Lark events and messages without inventing an unknown person or querying that person’s roles', async () => {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 }), receive = vi.fn(async (_message: unknown) => undefined);
  const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, tenant_access_token: 'synthetic-token', expire: 7200 }) }));
  const harness = await createEndpointHarness(() => new LarkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'), config: resolveLarkConfig({ id: 'synthetic', appId: 'synthetic-app', appSecret: 'synthetic-secret' }), http, fetch }), { gateway: createTestEventGateway({ receive }), operations: ['recall'] });
  try {
    await harness.start(); harness.open(); fetch.mockClear();
    const event: LarkMessage = { message_id: 'native-message', chat_id: 'actual-group', chat_type: 'group', message_type: 'text', content: '{"text":"senderless"}' };
    harness.endpoint.admit(event); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    const message = receive.mock.calls[0]![0] as Record<string, unknown>;
    expect(message).toMatchObject({ content: 'senderless', conversation: { kind: 'group', id: 'actual-group' } }); expect(message.event).toBe(event);
    expect(message).not.toHaveProperty('sender'); expect(fetch).not.toHaveBeenCalled();
  } finally { await harness.stop(); await http.close(); }
});
