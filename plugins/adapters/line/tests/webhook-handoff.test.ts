import { createHmac } from 'node:crypto';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { webhookRequest } from '../../test-utils/http.js';
import { LineEndpoint } from '../src/endpoint.js';
import { handleLineWebhookRequest } from '../src/webhook.js';
import { resolveLineConfig } from '../src/protocol.js';

const config = resolveLineConfig({ id: 'fixture', channelSecret: 'fixture-secret', channelAccessToken: 'fixture-token' });
const event = { webhookEventId: 'fixture-event', type: 'message', replyToken: 'fixture-reply', timestamp: 1,
  source: { type: 'user', userId: 'Ufixture' }, message: { id: 'fixture-message', type: 'text', text: 'probe' } };
function signed(body: string) {
  return webhookRequest(body, { 'x-line-signature': createHmac('sha256', config.channelSecret).update(body).digest('base64') });
}
const within = <T>(pending: Promise<T>, ms = 1_000) =>
  Promise.race([pending, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);

// #1250 b115: the HTTP answer is LINE's delivery ACK. It must come once the event was handed to the Runtime,
// not after its dispatch (a whole Agent turn), or LINE times out and redelivers.
it('answers the webhook while the dispatch still runs and does not dispatch a redelivery twice', async () => {
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const dispatch = vi.fn(async () => { await turn; });
  const endpoint = await createEndpointHarness(() => new LineEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'line'),
    http: { route: () => () => {} } as never, config }), { capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({
    receive: async (incoming) => {
      if (incoming.name !== 'message.receive') return undefined;
      incoming.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
      return dispatch();
    },
  }) });
  await endpoint.start(); endpoint.open();
  try {
    const body = JSON.stringify({ events: [event] });
    const first = await within(handleLineWebhookRequest(signed(body), endpoint.endpoint));
    expect(first?.status).toBe(200);
    const redelivery = JSON.stringify({ events: [{ ...event, deliveryContext: { isRedelivery: true } }] });
    const second = await within(handleLineWebhookRequest(signed(redelivery), endpoint.endpoint));
    expect(second?.status).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
  } finally { release(); await endpoint.stop(); }
});

it('keeps the acknowledgement when the dispatch fails after the Runtime accepted the event', async () => {
  const dispatch = vi.fn(async () => { throw new Error('turn failed'); });
  const endpoint = await createEndpointHarness(() => new LineEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'line'),
    http: { route: () => () => {} } as never, config }), { capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({
    receive: async (incoming) => {
      if (incoming.name !== 'message.receive') return undefined;
      incoming.accepted?.();
      return dispatch();
    },
  }) });
  await endpoint.start(); endpoint.open();
  try {
    const response = await handleLineWebhookRequest(signed(JSON.stringify({ events: [event] })), endpoint.endpoint);
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  } finally { await endpoint.stop(); }
});
