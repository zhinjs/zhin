import { expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { DingTalkEndpoint } from '../src/endpoint.js';
import { resolveDingTalkConfig, type DingTalkMessage } from '../src/protocol.js';

it('retains the complete DingTalk event/message while omitting sender when no actual user identity exists', async () => {
  const http = createHttpHost({ host: '127.0.0.1', port: 0 }), receive = vi.fn(async (_message: unknown) => undefined);
  const config = resolveDingTalkConfig({ id: 'synthetic-bot', appKey: 'synthetic-app', appSecret: 'synthetic-secret' });
  const harness = await createEndpointHarness(() => new DingTalkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'dingtalk'), config, http,
    fetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ errcode: 0, access_token: 'synthetic-token', expires_in: 7200 }) })) }), { gateway: createTestEventGateway({ receive }) });
  try {
    await harness.start(); harness.open();
    const event: DingTalkMessage = { msgtype: 'text', text: { content: 'anonymous group message' }, conversationType: '2', conversationId: 'actual-group', msgId: 'native-message', senderNick: 'display-only' };
    await harness.endpoint.admit(event);
    expect(receive).toHaveBeenCalledTimes(1);
    const message = receive.mock.calls[0]![0] as Record<string, unknown>;
    expect(message).toMatchObject({ content: 'anonymous group message', conversation: { kind: 'group', id: 'actual-group' }, message: { id: 'native-message' } });
    expect(message).not.toHaveProperty('sender'); expect(message.event).toBe(event);
    await harness.endpoint.admit({ ...event, senderStaffId: 'actual-staff' });
    expect(receive.mock.calls[1]![0]).toMatchObject({ sender: { id: 'actual-staff' } });
  } finally { await harness.stop(); await http.close(); }
});
