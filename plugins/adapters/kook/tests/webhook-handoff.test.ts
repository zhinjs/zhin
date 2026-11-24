import { expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { webhookRequest } from '../../test-utils/http.js';
import { kookFixture } from './fixture.js';
import { KookWebhookEndpoint } from '../src/endpoint.js';
import { handleKookWebhookRequest } from '../src/webhook.js';
import { resolveKookConfig } from '../src/protocol.js';
import type { KookClientTransport } from '../src/ws.js';

const VERIFY = 'fixture';
const text = { channel_type: 'PERSON', type: 1, target_id: 'bot', author_id: 'actor', content: 'run it', msg_id: 'm1', msg_timestamp: 1,
  verify_token: VERIFY, extra: { author: { id: 'actor', username: 'actor', bot: false } } };
const click = { channel_type: 'PERSON', type: 255, target_id: 'bot', msg_id: 'click-id', msg_timestamp: 2, verify_token: VERIFY,
  extra: { type: 'message_btn_click', body: { user_id: 'actor', msg_id: 'sent-card', value: 'confirm:yes', target_id: '' } } };

// #1250 adapter-inbound-deadlock: the HTTP answer is KOOK's delivery ACK. It must come once the event was
// handed to the Runtime, not after its dispatch (an Agent turn that may wait for this user's next event).
it.each([['text message', text, 1], ['button click', click, 2]] as const)('answers a %s webhook while its dispatch still runs', async (_kind, event, sn) => {
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const receive = vi.fn(async () => { await turn; });
  const config = resolveKookConfig({ id: 'test', token: 'fixture', connection: 'webhook', verify_token: VERIFY });
  if (config.connection !== 'webhook') throw new Error('Wrong fixture');
  const client = { init: async () => {}, connect: async () => {}, disconnect: async () => {}, removeAllListeners: () => {} } as unknown as KookClientTransport;
  const endpoint = await kookFixture(() => new KookWebhookEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'kook'), config,
    http: { route: () => () => {} } as never }), () => client, undefined, undefined, createTestEndpointEventGateway({ receive: async (incoming) => {
    if (incoming.name !== 'message.receive') return undefined;
    incoming.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
    return receive();
  } }));
  await endpoint.start(); endpoint.open();
  try {
    const answering = handleKookWebhookRequest(webhookRequest(JSON.stringify({ s: 0, sn, d: event })), endpoint.endpoint as KookWebhookEndpoint);
    const response = await Promise.race([answering, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1_000))]);
    expect(response?.status).toBe(200);
    expect(receive).toHaveBeenCalledOnce();
  } finally { release(); await endpoint.stop(); }
});
