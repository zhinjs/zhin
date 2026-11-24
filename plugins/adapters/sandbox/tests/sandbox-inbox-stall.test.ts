import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint, sandboxConsoleUser } from '../src/endpoint.js';
import { resolveSandboxEndpoint } from '../src/protocol.js';
import { sandboxOperations } from './sandbox-operations.js';

// The ready frame is gated on a host `docker info` probe; keep this suite independent of the runner's Docker.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

type Frame = Record<string, any>;
type Principal = Parameters<typeof sandboxConsoleUser>[0];

function fakeHttp() {
  let accept: ((connection: unknown) => void) | undefined;
  const http = {
    ws: () => ({ onConnection: (listener: (connection: unknown) => void) => { accept = listener; return () => { accept = undefined; }; }, close: () => undefined }),
    route: () => () => undefined,
    address: undefined,
  };
  const connect = async (principal: Principal) => {
    const frames: Frame[] = [];
    const listeners = new Set<(data: string) => void>();
    accept!({
      url: new URL('http://127.0.0.1/sandbox'), headers: new Headers(), principal, bufferedAmount: 0,
      send: (data: string) => frames.push(JSON.parse(data) as Frame),
      close: () => undefined,
      onMessage: (listener: (data: string) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      onClose: () => () => undefined,
    });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
    const send = (payload: unknown) => { for (const listener of listeners) listener(JSON.stringify(payload)); };
    send({ op: 'subscribe', conversation: { type: 'private', id: 'room' } });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribed')).toBe(true));
    return { frames, send };
  };
  return { http, connect };
}

const user: Principal = { kind: 'user', userId: 'u-owner', username: 'u-owner', displayName: 'Owner', credentialId: 'c',
  grants: [{ scope: { kind: 'global' }, permissions: ['self.chat-identity'] }], roles: [] } as Principal;

async function fixture(receive: (payload: Frame) => unknown, extra: Partial<ConstructorParameters<typeof SandboxWsEndpoint>[0]> = {}) {
  const { http, connect } = fakeHttp();
  const events = vi.fn(async (event: EndpointEvent) => event.name === 'message.receive' ? receive(event.payload as Frame) : undefined);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'),
    http: http as never, defaults: resolveSandboxEndpoint({ id: 'shared-bot', owner: 'dev-user' }), ...extra,
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], operations: sandboxOperations, gateway: createTestEndpointEventGateway({ receive: events }) });
  await endpoint.start();
  endpoint.open();
  return { connect, endpoint };
}

const action = (payload: string, messageId: string) => ({ type: 'private', id: 'room', messageId, senderId: 'dev-user', asMe: true,
  content: [{ type: 'action', data: { id: payload, payload } }], timestamp: Date.now() });

describe('#1250 sandbox-button-stalls-connection', () => {
  it('admits a button click while the turn that asked for it is still running on the same socket', async () => {
    // A message's dispatch stays pending for its whole Agent turn; that turn waits for the answer the
    // page sends next on the same socket (a confirm card's button). The socket must not hold the
    // answer back behind the turn, or both wait until the ask times out.
    let answer!: (value: string) => void;
    const answered = new Promise<string>(resolve => { answer = resolve; });
    const seen: string[] = [];
    const { connect } = await fixture(async (payload) => {
      seen.push(String(payload.message?.id));
      if (payload.message?.id === 'ask-me') return { matched: true, value: await answered };
      if (Array.isArray(payload.segments) && payload.segments[0]?.type === 'action') answer(String(payload.content));
      return { matched: true };
    });
    const client = await connect(user);
    client.send({ type: 'private', id: 'room', messageId: 'ask-me', senderId: 'dev-user', asMe: true, content: 'run it', timestamp: Date.now() });
    await vi.waitFor(() => expect(seen).toEqual(['ask-me']));
    client.send(action('zhin:ask:1:1', 'click-1'));
    await vi.waitFor(() => expect(seen).toEqual(['ask-me', 'click-1']), { timeout: 2_000 });
    await expect(answered).resolves.toBe('zhin:ask:1:1');
    // Later text frames are echoed and dispatched too, in order.
    client.send({ type: 'private', id: 'room', messageId: 'after', senderId: 'dev-user', asMe: true, content: 'after', timestamp: Date.now() });
    await vi.waitFor(() => expect(seen).toEqual(['ask-me', 'click-1', 'after']));
    expect(client.frames.filter(frame => frame.direction === 'inbound').map(frame => frame.messageId)).toEqual(['ask-me', 'click-1', 'after']);
  });

  it('keeps frames in order while a speaker identity is being created', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    const { connect } = await fixture(async (payload) => { seen.push(String(payload.message?.id)); return { matched: true }; },
      { consoleSpeaker: { ensure: async () => { await gate; } } as never });
    const client = await connect(user);
    client.send({ type: 'private', id: 'room', messageId: 'first', senderId: 'dev-user', asMe: true, content: 'one', timestamp: Date.now() });
    client.send({ type: 'private', id: 'room', messageId: 'second', senderId: 'dev-user', content: 'two', timestamp: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(seen).toEqual([]);
    release();
    await vi.waitFor(() => expect(seen).toEqual(['first', 'second']));
  });

  it('reports a frame that could not be handed to the runtime on its card instead of leaving it 「已提交」', async () => {
    const { connect, endpoint } = await fixture(async () => ({ matched: true }));
    const client = await connect(user);
    // Ingress closed under the socket (generation handoff): the click is not admitted.
    await endpoint.close();
    client.send(action('zhin:ask:2:1', 'click-2'));
    await vi.waitFor(() => expect(client.frames.some(frame => frame.type === 'error' && frame.code === 'sandbox_gateway_receive_failed')).toBe(true));
    expect(client.frames.find(frame => frame.code === 'sandbox_gateway_receive_failed')).toMatchObject({
      messageId: 'click-2', conversation: { type: 'private', id: 'room' } });
  });
});
