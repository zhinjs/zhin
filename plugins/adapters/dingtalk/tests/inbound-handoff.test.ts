import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { webhookRequest } from '../../test-utils/http.js';
import { DingTalkEndpoint } from '../src/endpoint.js';
import { ROBOT_TOPIC } from '../src/stream.js';
import { handleDingTalkWebhookRequest } from '../src/webhook.js';
import { resolveDingTalkConfig } from '../src/protocol.js';

const SECRET = 'fixture-secret';
const message = { msgtype: 'text', msgId: 'msg-1', text: { content: 'hello' }, conversationType: '1', conversationId: 'cid-1', senderId: 'user-1' };
const within = <T>(pending: Promise<T>, ms = 1_000) =>
  Promise.race([pending, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);
function signed(body: string) {
  const timestamp = String(Date.now());
  const sign = createHmac('sha256', SECRET).update(`${timestamp}\n${SECRET}`).digest('base64');
  return webhookRequest(body, {}, { url: `http://localhost/dingtalk?timestamp=${timestamp}&sign=${encodeURIComponent(sign)}` });
}
class Socket extends EventEmitter {
  send = vi.fn(); ping = vi.fn(); terminate = vi.fn(() => this.emit('close'));
}
const fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => '',
  json: async () => String(url).includes('/gettoken')
    ? { errcode: 0, access_token: 'token', expires_in: 7200 }
    : { endpoint: 'wss://example.com', ticket: 'ticket' } }));

/** A Runtime that accepts the message (as core does once it is recorded), then runs a long Agent turn. */
async function fixture(mode: 'webhook' | 'stream', dispatch: () => Promise<void>, socket = new Socket()) {
  const config = resolveDingTalkConfig({ id: 'fixture', appKey: 'fixture-key', appSecret: SECRET, mode, webhookPath: '/dingtalk' });
  const endpoint = await createEndpointHarness(() => new DingTalkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'dingtalk'),
    config, fetch, ...(mode === 'stream' ? { createStreamSocket: () => socket } : { http: { route: () => () => {} } as never }) }), {
    capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({ receive: async (incoming) => {
      if (incoming.name !== 'message.receive') return undefined;
      incoming.accepted?.();
      return dispatch();
    } }) });
  const starting = endpoint.start();
  if (mode === 'stream') { await vi.waitFor(() => expect(socket.listenerCount('open')).toBe(1)); socket.emit('open'); }
  await starting; endpoint.open();
  return endpoint;
}

// #1250 b115: DingTalk's webhook 200 and Stream ACK must not wait for the Agent turn, or DingTalk retries.
it('answers the webhook while the dispatch still runs and dispatches a redelivered msgId once', async () => {
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const dispatch = vi.fn(async () => { await turn; });
  const endpoint = await fixture('webhook', dispatch);
  try {
    const body = JSON.stringify(message);
    expect((await within(handleDingTalkWebhookRequest(signed(body), endpoint.endpoint)))?.status).toBe(200);
    expect((await within(handleDingTalkWebhookRequest(signed(body), endpoint.endpoint)))?.status).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
  } finally { release(); await endpoint.stop(); }
});

it('keeps the webhook 200 when the dispatch fails after the Runtime accepted the event', async () => {
  const dispatch = vi.fn(async () => { throw new Error('turn failed'); });
  const endpoint = await fixture('webhook', dispatch);
  try {
    expect((await handleDingTalkWebhookRequest(signed(JSON.stringify(message)), endpoint.endpoint)).status).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
  } finally { await endpoint.stop(); }
});

it('sends the Stream ACK while the dispatch still runs and dispatches a redelivered frame once', async () => {
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const dispatch = vi.fn(async () => { await turn; });
  const socket = new Socket();
  const endpoint = await fixture('stream', dispatch, socket);
  const frame = Buffer.from(JSON.stringify({ type: 'CALLBACK', headers: { topic: ROBOT_TOPIC, messageId: 'frame-1' }, data: JSON.stringify(message) }));
  try {
    socket.emit('message', frame);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce(), { timeout: 1_000 });
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ code: 200, headers: { messageId: 'frame-1' } });
    socket.emit('message', frame);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    expect(dispatch).toHaveBeenCalledOnce();
  } finally { release(); await endpoint.stop(); }
});
