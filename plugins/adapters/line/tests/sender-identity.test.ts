import { expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { LineEndpoint } from '../src/endpoint.js';
import { resolveLineConfig, type LineMessageEvent } from '../src/protocol.js';

it('retains the complete LINE group event/message without treating a group ID as its sender', async () => {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 }), receive = vi.fn(async (_message: unknown) => undefined);
  const config = resolveLineConfig({ id: 'synthetic-bot', channelSecret: 'synthetic-secret', channelAccessToken: 'synthetic-token' });
  const harness = await createEndpointHarness(() => new LineEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'line'), config, http,
    fetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })) }), { gateway: createTestEventGateway({ receive }) });
  try {
    await harness.start(); harness.open();
    const event: LineMessageEvent = { type: 'message', replyToken: 'native-reply', timestamp: 1, source: { type: 'group', groupId: 'actual-group' }, message: { id: 'native-message', type: 'text', text: 'anonymous group message' } };
    harness.endpoint.admit(event); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    const message = receive.mock.calls[0]![0] as Record<string, unknown>;
    expect(message).toMatchObject({ content: 'anonymous group message', conversation: { kind: 'group', id: 'actual-group' }, message: { id: 'native-message' } });
    expect(message).not.toHaveProperty('sender'); expect(message.event).toBe(event);
    harness.endpoint.admit({ ...event, source: { type: 'group', groupId: 'actual-group', userId: 'actual-user' } });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2)); expect(receive.mock.calls[1]![0]).toMatchObject({ sender: { id: 'actual-user' } });
  } finally { await harness.stop(); await http.close(); }
});
