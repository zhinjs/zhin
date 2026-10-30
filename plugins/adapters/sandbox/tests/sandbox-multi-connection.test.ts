import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import type { EndpointEvent } from 'zhin.js/adapter';
import type { ConversationRef } from '@zhin.js/im-contract';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint } from '../src/endpoint.js';
import { SandboxClient, type SandboxClientConnection } from '../src/client.js';
import { resolveSandboxEndpoint } from '../src/protocol.js';

type Frame = Record<string, unknown>;
type Scene = { type: 'private' | 'group' | 'channel'; id: string };
const endpointKey = String(capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'));
const hosts: ReturnType<typeof createHttpHost>[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(hosts.splice(0).map(host => host.close()));
});

function conversation(scene: Scene): ConversationRef {
  return { endpoint: { id: endpointKey, adapter: 'sandbox' }, kind: scene.type, id: scene.id };
}

async function fixture(authenticated = false) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0, ...(authenticated ? { tokens: [
    { token: 'full-test-token', scope: 'full' as const },
    { token: 'demo-test-token', scope: 'demo' as const },
  ] } : {}) });
  hosts.push(http);
  const receive = vi.fn(async (_input: unknown) => Object.freeze({ matched: true }));
  const events = vi.fn(async (event: EndpointEvent) => event.name === 'message.receive' ? receive(event.payload) : undefined);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'),
    http, defaults: resolveSandboxEndpoint({ id: 'shared-bot', owner: 'shared-owner' }),
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], gateway: { receive: events } });
  await endpoint.start();
  endpoint.open();
  const { port } = await http.listen();
  const connect = async (token?: string) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox${token ? `?token=${token}` : ''}`);
    clients.push(client);
    const frames: Frame[] = [];
    client.on('message', data => frames.push(JSON.parse(String(data)) as Frame));
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
    return {
      client, frames,
      ready: frames.find(frame => frame.type === 'ready')!,
      async subscribe(scene: Scene) {
        const start = frames.length;
        client.send(JSON.stringify({ op: 'subscribe', conversation: scene }));
        await vi.waitFor(() => expect(frames.slice(start).some(frame => frame.type === 'subscribed')).toBe(true));
      },
    };
  };
  return { endpoint, receive, events, connect };
}

describe('Sandbox scoped multi-connection transport', () => {
  it('shares a scene without replacing clients or duplicating core input, and isolates other scene kinds', async () => {
    const { endpoint, receive, connect } = await fixture();
    const first = await connect(), second = await connect(), other = await connect();
    expect(first.client.readyState).toBe(WebSocket.OPEN);
    expect(first.ready.endpoint).toBe('shared-bot');
    expect(second.ready.endpoint).toBe('shared-bot');
    expect(first.ready.connectionId).not.toBe(second.ready.connectionId);
    expect(first.ready.protocol).toBe('scoped-conversations-v1');
    const scene: Scene = { type: 'group', id: 'same-id' };
    await first.subscribe(scene);
    await second.subscribe(scene);
    await other.subscribe({ type: 'private', id: scene.id });
    first.client.send(JSON.stringify({ ...scene, messageId: 'client-message', content: 'hello' }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(second.frames.some(frame => frame.direction === 'inbound')).toBe(true));
    const echo = first.frames.find(frame => frame.direction === 'inbound')!;
    expect(echo).toMatchObject({ ...scene, senderId: 'shared-owner', messageId: 'client-message', content: [{ type: 'text', data: { text: 'hello' } }] });
    expect(second.frames.find(frame => frame.direction === 'inbound')).toEqual(echo);
    expect(receive.mock.calls[0]![0]).toMatchObject({ endpointId: 'shared-bot', sender: { id: 'shared-owner' }, message: { id: echo.messageId } });
    const receipt = await endpoint.send({ conversation: conversation(scene), payload: 'reply' });
    await vi.waitFor(() => expect(second.frames.some(frame => frame.messageId === receipt)).toBe(true));
    expect(first.frames.find(frame => frame.messageId === receipt)).toEqual(second.frames.find(frame => frame.messageId === receipt));
    await other.subscribe({ type: 'private', id: scene.id });
    expect(other.frames.some(frame => frame.messageId === receipt || frame.direction === 'inbound')).toBe(false);
    expect(receive).toHaveBeenCalledTimes(1);
    // A changed subscription replaces the old scene, including when IDs coincide.
    await first.subscribe({ type: 'private', id: scene.id });
    const nextReceipt = await endpoint.send({ conversation: conversation(scene), payload: 'remaining subscriber' });
    await vi.waitFor(() => expect(second.frames.some(frame => frame.messageId === nextReceipt)).toBe(true));
    await first.subscribe({ type: 'private', id: scene.id });
    expect(first.frames.some(frame => frame.messageId === nextReceipt)).toBe(false);
  });

  it('lets legacy inputs select their scene and generates one shared ID when absent', async () => {
    const { endpoint, receive, connect } = await fixture();
    const first = await connect(), second = await connect();
    await second.subscribe({ type: 'channel', id: 'legacy-room' });
    first.client.send(JSON.stringify({ type: 'guild', id: 'legacy-room', content: 'legacy input' }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(second.frames.some(frame => frame.direction === 'inbound')).toBe(true));
    const echo = second.frames.find(frame => frame.direction === 'inbound')!;
    expect(echo).toMatchObject({ type: 'channel', id: 'legacy-room', senderId: 'shared-owner' });
    expect(echo.messageId).toEqual(expect.any(String));
    expect(receive.mock.calls[0]![0]).toMatchObject({ message: { id: echo.messageId }, conversation: conversation({ type: 'channel', id: 'legacy-room' }) });
    expect(first.frames.some(frame => frame.direction === 'inbound')).toBe(false);
    const receipt = await endpoint.send({ conversation: conversation({ type: 'channel', id: 'legacy-room' }), payload: 'channel reply' });
    await vi.waitFor(() => expect(first.frames.some(frame => frame.messageId === receipt)).toBe(true));
    await vi.waitFor(() => expect(second.frames.some(frame => frame.messageId === receipt)).toBe(true));
    // Default subscriptions keep old clients able to receive private owner messages before input.
    const third = await connect();
    const privateReceipt = await endpoint.send({ conversation: conversation({ type: 'private', id: 'shared-owner' }), payload: 'private reply' });
    await vi.waitFor(() => expect(third.frames.some(frame => frame.messageId === privateReceipt)).toBe(true));
  });

  it('rejects malformed and unauthorized control frames without changing subscriptions or admitting model input', async () => {
    const { endpoint, receive, events, connect } = await fixture(true);
    const full = await connect('full-test-token'), demo = await connect('demo-test-token');
    await full.subscribe({ type: 'private', id: 'shared-owner' });
    const invalid = [
      { op: 'subscribe' }, { op: 'subscribe', conversation: null },
      { op: 'subscribe', conversation: { type: 'direct', id: 'room' } },
      { op: 'subscribe', conversation: { type: 'group', id: ' ' } },
      { op: 'subscribe', conversation: { type: 'group', id: 1 } },
      { op: 'not-a-chat-operation' },
    ];
    for (const frame of invalid) full.client.send(JSON.stringify(frame));
    demo.client.send(JSON.stringify({ op: 'subscribe', conversation: { type: 'private', id: 'shared-owner' } }));
    demo.client.send(JSON.stringify({ type: 'private', id: 'shared-owner', content: 'denied' }));
    await vi.waitFor(() => expect(full.frames.filter(frame => frame.type === 'error')).toHaveLength(invalid.length));
    await vi.waitFor(() => expect(demo.frames.filter(frame => frame.type === 'error')).toHaveLength(2));
    const receipt = await endpoint.send({ conversation: conversation({ type: 'private', id: 'shared-owner' }), payload: 'full only' });
    await vi.waitFor(() => expect(full.frames.some(frame => frame.messageId === receipt)).toBe(true));
    expect(demo.frames.some(frame => frame.messageId === receipt)).toBe(false);
    expect(receive).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => event.name === 'platform.receive'
      && (event.payload as { name: string }).name === 'message')).toHaveLength(0);
    await expect(endpoint.send({ conversation: conversation({ type: 'group', id: 'room' }), payload: 'unsubscribed' }))
      .rejects.toThrow(expect.objectContaining({ disposition: 'not_sent' }));
    const fullClosed = new Promise<void>(resolve => full.client.once('close', () => resolve()));
    full.client.close();
    await fullClosed;
    await vi.waitFor(() => expect(endpoint.endpoint.connections()).toHaveLength(1));
    await expect(endpoint.send({ conversation: conversation({ type: 'private', id: 'shared-owner' }), payload: 'demo cannot receive' }))
      .rejects.toThrow(expect.objectContaining({ disposition: 'not_sent' }));
  });

  it('continues delivering after one socket fails and never confirms delivery if all subscribers fail', async () => {
    const { endpoint, receive, connect } = await fixture();
    const first = await connect(), second = await connect();
    const scene: Scene = { type: 'group', id: 'room' };
    await first.subscribe(scene);
    await second.subscribe(scene);
    const failed = endpoint.endpoint.connectionById(String(first.ready.connectionId))!;
    const working = endpoint.endpoint.connectionById(String(second.ready.connectionId))!;
    vi.spyOn(failed.socket, 'send').mockImplementation(() => { throw new Error('synthetic socket failure'); });
    const receipt = await endpoint.send({ conversation: conversation(scene), payload: 'delivered once' });
    await vi.waitFor(() => expect(second.frames.some(frame => frame.messageId === receipt)).toBe(true));
    vi.spyOn(working.socket, 'send').mockImplementation(() => { throw new Error('synthetic socket failure'); });
    await expect(endpoint.send({ conversation: conversation(scene), payload: 'not delivered' }))
      .rejects.toThrow(expect.objectContaining({ disposition: 'unknown' }));
    first.client.send(JSON.stringify({ ...scene, content: 'echo failure must not block input' }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  });

  it('stamps edits with their canonical scene while preserving their legacy wire type', async () => {
    const { endpoint, connect } = await fixture();
    const group = await connect(), direct = await connect();
    const scene: Scene = { type: 'group', id: 'same-id' };
    await group.subscribe(scene);
    await direct.subscribe({ type: 'private', id: scene.id });
    const receipt = await endpoint.send({ conversation: conversation(scene), payload: {
      type: 'edit', id: scene.id, content: 'updated', messageId: 'edited-message',
      conversation: { type: 'private', id: 'wrong-envelope-scene' },
    } });
    await vi.waitFor(() => expect(group.frames.some(frame => frame.messageId === receipt)).toBe(true));
    expect(group.frames.find(frame => frame.messageId === receipt)).toMatchObject({ type: 'edit', conversation: scene });
    await direct.subscribe({ type: 'private', id: scene.id });
    expect(direct.frames.some(frame => frame.messageId === receipt)).toBe(false);
  });

  it('routes native envelopes by the canonical request even when all legacy address fields conflict', async () => {
    const { endpoint, connect } = await fixture();
    const group = await connect(), direct = await connect();
    const scene: Scene = { type: 'group', id: 'request-room' };
    const envelopeScene: Scene = { type: 'private', id: 'envelope-room' };
    await group.subscribe(scene);
    await direct.subscribe(envelopeScene);
    const receipt = await endpoint.send({ conversation: conversation(scene), payload: {
      ...envelopeScene, conversation: envelopeScene, content: 'canonical request wins', messageId: 'native-message',
    } });
    await vi.waitFor(() => expect(group.frames.some(frame => frame.messageId === receipt)).toBe(true));
    expect(group.frames.find(frame => frame.messageId === receipt)).toMatchObject({
      ...envelopeScene, conversation: scene, messageId: receipt,
    });
    await direct.subscribe(envelopeScene);
    expect(direct.frames.some(frame => frame.messageId === receipt)).toBe(false);
  });

  it('closes only the departing connection, preserves low-level targeting, and releases all sockets on stop', async () => {
    const { endpoint, connect } = await fixture();
    const first = await connect(), second = await connect();
    expect(endpoint.endpoint.connections()).toHaveLength(2);
    expect(endpoint.endpoint.connection('shared-bot')?.connectionId).toBe(second.ready.connectionId);
    endpoint.endpoint.send('shared-bot', JSON.stringify({ type: 'raw-client-test' }));
    await vi.waitFor(() => expect(second.frames.some(frame => frame.type === 'raw-client-test')).toBe(true));
    expect(first.frames.some(frame => frame.type === 'raw-client-test')).toBe(false);
    const firstClosed = new Promise<void>(resolve => first.client.once('close', () => resolve()));
    first.client.close();
    await firstClosed;
    await vi.waitFor(() => expect(endpoint.endpoint.connections()).toHaveLength(1));
    expect(endpoint.endpoint.connectionById(String(first.ready.connectionId))).toBeUndefined();
    expect(second.client.readyState).toBe(WebSocket.OPEN);
    const stopped = new Promise<number>(resolve => second.client.once('close', code => resolve(code)));
    await endpoint.stop();
    expect(await stopped).toBe(1001);
    expect(endpoint.endpoint.connections()).toHaveLength(0);
    expect(() => endpoint.endpoint.send('shared-bot', '{}')).toThrow();
  });

  it('owns native client connections without an Endpoint callback or parallel directory', () => {
    const socket = { send: vi.fn(), close: vi.fn() };
    const legacy: SandboxClientConnection = { target: 'legacy', owner: 'owner', socket, placeholder: false };
    class Client extends SandboxClient {
      constructor() { super(); this.connectionRecords.set('legacy', legacy); }
    }
    const client = new Client();
    expect(client.connection('legacy')).toMatchObject(legacy);
    expect(client.connectionById('missing')).toBeUndefined();
    client.send('legacy', 'raw payload');
    expect(socket.send).toHaveBeenCalledExactlyOnceWith('raw payload');
  });
});
