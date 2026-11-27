import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { webhookRequest } from '../../test-utils/http.js';
import { DingTalkEndpoint } from '../src/endpoint.js';
import { ROBOT_TOPIC } from '../src/stream.js';
import { handleDingTalkWebhookRequest } from '../src/webhook.js';
import { resolveDingTalkConfig } from '../src/protocol.js';
import { AdmissionDedup } from '../src/admission-dedup.js';

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

/** A Runtime whose acceptance waits for `gate`; `refuse` makes the next hand-off fail before acceptance. */
function gatedRuntime() {
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const state = { refuse: 0, gated: false };
  /** Message hand-offs only (platform events reach the gateway too). */
  const handled = vi.fn();
  const receive = vi.fn(async (incoming: { name: string; accepted?: () => void }) => {
    if (incoming.name !== 'message.receive') return undefined;
    handled();
    if (state.refuse > 0) { state.refuse--; throw new Error('runtime refused the event'); }
    if (state.gated) await gate;
    incoming.accepted?.();
    return undefined;
  });
  return { receive, handled, state, open };
}
async function gatedFixture(mode: 'webhook' | 'stream', runtime: ReturnType<typeof gatedRuntime>, socket = new Socket()) {
  const config = resolveDingTalkConfig({ id: 'fixture', appKey: 'fixture-key', appSecret: SECRET, mode, webhookPath: '/dingtalk' });
  const endpoint = await createEndpointHarness(() => new DingTalkEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'dingtalk'),
    config, fetch, ...(mode === 'stream' ? { createStreamSocket: () => socket } : { http: { route: () => () => {} } as never }) }), {
    capabilities: ['inbound', 'outbound'], gateway: createTestEndpointEventGateway({ receive: runtime.receive as never }) });
  const starting = endpoint.start();
  if (mode === 'stream') { await vi.waitFor(() => expect(socket.listenerCount('open')).toBe(1)); socket.emit('open'); }
  await starting; endpoint.open();
  return endpoint;
}

// #1250 b115 L5: a redelivery that arrives while the first hand-off is still in flight shares it.
it('shares one in-flight hand-off between two concurrent deliveries of a msgId', async () => {
  const runtime = gatedRuntime(); runtime.state.gated = true;
  const endpoint = await gatedFixture('webhook', runtime);
  try {
    const body = JSON.stringify(message);
    const first = handleDingTalkWebhookRequest(signed(body), endpoint.endpoint);
    const second = handleDingTalkWebhookRequest(signed(body), endpoint.endpoint);
    await vi.waitFor(() => expect(runtime.handled).toHaveBeenCalledOnce());
    expect(await within(first, 50)).toBeUndefined(); // still waiting for the Runtime to accept
    runtime.open();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(runtime.handled).toHaveBeenCalledOnce();
  } finally { runtime.open(); await endpoint.stop(); }
});

// #1250 b115 M2 + L5: a failed hand-off answers 503 and releases the msgId, so DingTalk's redelivery is handled.
it('answers 503 when the hand-off fails and hands the redelivery off again', async () => {
  const runtime = gatedRuntime(); runtime.state.refuse = 1;
  const endpoint = await gatedFixture('webhook', runtime);
  try {
    const body = JSON.stringify(message);
    expect((await handleDingTalkWebhookRequest(signed(body), endpoint.endpoint)).status).toBe(503);
    expect((await handleDingTalkWebhookRequest(signed(body), endpoint.endpoint)).status).toBe(200);
    expect(runtime.handled).toHaveBeenCalledTimes(2);
    // Now handed off: a further redelivery is skipped.
    expect((await handleDingTalkWebhookRequest(signed(body), endpoint.endpoint)).status).toBe(200);
    expect(runtime.handled).toHaveBeenCalledTimes(2);
  } finally { await endpoint.stop(); }
});

// #1250 b115 L4: a closed input refuses the event instead of recording the msgId as handled for 24 hours.
it('refuses a delivery while closed without recording its msgId, so a later redelivery is handled', async () => {
  const runtime = gatedRuntime();
  const endpoint = await gatedFixture('webhook', runtime);
  try {
    endpoint.close();
    await expect(endpoint.endpoint.admit(message)).rejects.toThrow('DingTalk endpoint is closed');
    endpoint.open();
    await endpoint.endpoint.admit(message);
    expect(runtime.handled).toHaveBeenCalledOnce();
  } finally { await endpoint.stop(); }
});

// #1250 b115 L5: Stream may resend one msgId under a new frame messageId; it is handled once, both frames ACKed.
it('handles one msgId once across two Stream frames with different messageIds', async () => {
  const runtime = gatedRuntime();
  const socket = new Socket();
  const endpoint = await gatedFixture('stream', runtime, socket);
  const frame = (messageId: string) => Buffer.from(JSON.stringify({ type: 'CALLBACK', headers: { topic: ROBOT_TOPIC, messageId }, data: JSON.stringify(message) }));
  try {
    socket.emit('message', frame('frame-1'));
    socket.emit('message', frame('frame-2'));
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2), { timeout: 1_000 });
    expect(socket.send.mock.calls.map(([data]) => JSON.parse(data).headers.messageId).sort()).toEqual(['frame-1', 'frame-2']);
    expect(runtime.handled).toHaveBeenCalledOnce();
  } finally { await endpoint.stop(); }
});

it('does not ACK a Stream frame whose hand-off fails, and handles its resend', async () => {
  const runtime = gatedRuntime(); runtime.state.refuse = 1;
  const socket = new Socket();
  const endpoint = await gatedFixture('stream', runtime, socket);
  const frame = Buffer.from(JSON.stringify({ type: 'CALLBACK', headers: { topic: ROBOT_TOPIC, messageId: 'frame-1' }, data: JSON.stringify(message) }));
  try {
    socket.emit('message', frame);
    await vi.waitFor(() => expect(runtime.handled).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(socket.send).not.toHaveBeenCalled();
    socket.emit('message', frame);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce(), { timeout: 1_000 });
    expect(runtime.handled).toHaveBeenCalledTimes(2);
  } finally { await endpoint.stop(); }
});

describe('AdmissionDedup capacity (#1250 b115 L5)', () => {
  const pending = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
  it('evicts only completed entries at capacity', async () => {
    const dedup = new AdmissionDedup({ ttlMs: 60_000, capacity: 2 });
    const handoff = vi.fn(async () => undefined);
    await dedup.admit('done', handoff);
    const inflight = pending();
    const sharing = dedup.admit('inflight', () => inflight.promise);
    await dedup.admit('third', handoff); // evicts `done`, never `inflight`
    expect(dedup.size).toBe(2);
    await dedup.admit('done', handoff); // evicted, so handed off again (evicting `third`)
    expect(handoff).toHaveBeenCalledTimes(3);
    const shared = vi.fn(async () => undefined);
    const again = dedup.admit('inflight', shared); // still present: shares the first hand-off
    inflight.release(); await sharing; await again;
    expect(shared).not.toHaveBeenCalled();
  });
  it('refuses a new msgId when in-flight entries fill the table', async () => {
    const dedup = new AdmissionDedup({ ttlMs: 60_000, capacity: 2 });
    const a = pending(), b = pending();
    const first = dedup.admit('a', () => a.promise), second = dedup.admit('b', () => b.promise);
    const handoff = vi.fn(async () => undefined);
    await expect(dedup.admit('c', handoff)).rejects.toThrow('DingTalk admission dedup capacity exhausted');
    expect(handoff).not.toHaveBeenCalled();
    a.release(); b.release(); await first; await second;
    await dedup.admit('c', handoff); // completed entries can now be evicted
    expect(handoff).toHaveBeenCalledOnce();
  });
  it('releases a failed entry and expires a completed one after its window', async () => {
    vi.useFakeTimers();
    try {
      const dedup = new AdmissionDedup({ ttlMs: 1_000, capacity: 10 });
      await expect(dedup.admit('x', async () => { throw new Error('refused'); })).rejects.toThrow('refused');
      const handoff = vi.fn(async () => undefined);
      await dedup.admit('x', handoff); await dedup.admit('x', handoff);
      expect(handoff).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1_001);
      await dedup.admit('x', handoff);
      expect(handoff).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
