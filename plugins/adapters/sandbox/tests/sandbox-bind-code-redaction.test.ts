import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint, type sandboxConsoleUser } from '../src/endpoint.js';
import { redactSandboxBindCode } from '../src/bind-redaction.js';
import { parseSandboxWsPayload, resolveSandboxEndpoint } from '../src/protocol.js';
import { sandboxOperations } from './sandbox-operations.js';

// The ready frame is gated on a host `docker info` probe; keep this suite independent of the runner's Docker.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

type Frame = Record<string, unknown>;
type Principal = Parameters<typeof sandboxConsoleUser>[0];
const CODE = 'ABCD2345';
const scene = { type: 'group', id: 'shared-room' } as const;

const user = (userId: string, permissions: readonly string[]): Principal => ({ kind: 'user', userId, username: userId, displayName: userId,
  credentialId: `c-${userId}`, grants: [{ scope: { kind: 'global' }, permissions: [...permissions] }], roles: [] } as Principal);
/** User A: the owner (global iam.manage); user B: an operator of the same Console. */
const owner = user('u-owner', ['iam.manage', 'self.chat-identity', 'endpoint.operate']);
const operator = user('u-operator', ['endpoint.operate']);

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
    send({ op: 'subscribe', conversation: scene });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribed')).toBe(true));
    return { frames, send };
  };
  return { http, connect };
}

async function fixture() {
  const { http, connect } = fakeHttp();
  const receive = vi.fn(async (_input: unknown) => Object.freeze({ matched: true }));
  const events = vi.fn(async (event: EndpointEvent) => event.name === 'message.receive' ? receive(event.payload) : undefined);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'),
    http: http as never, defaults: resolveSandboxEndpoint({ id: 'shared-bot', owner: 'dev-user' }),
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], operations: sandboxOperations, gateway: createTestEndpointEventGateway({ receive: events }) });
  await endpoint.start();
  endpoint.open();
  return { connect, receive, events };
}

const carriesCode = (value: unknown) => JSON.stringify(value).toUpperCase().replace(/[\s-]/gu, '').includes(CODE);

describe('Sandbox bind code redaction (#1250 sandbox-transcript-shared-bind-code)', () => {
  it.each([
    ['without a command prefix', `绑定 ${CODE}`, '绑定 ***'],
    ['with a command prefix', `/绑定 ${CODE}`, '/绑定 ***'],
    ['as the English command, spaced and lower case', '#bind abcd-2345', '#bind ***'],
  ])('user A (owner) sends a bind code %s: user B (operator) never receives it', async (_label, text, hidden) => {
    const { connect, receive, events } = await fixture();
    const a = await connect(owner);
    const b = await connect(operator);
    a.send({ ...scene, messageId: 'bind-message', content: text });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(b.frames.some(frame => frame.direction === 'inbound')).toBe(true));
    // The broadcast to B, and A's own echo (it replaces A's typed bubble), show the hidden text only.
    const echoB = b.frames.find(frame => frame.direction === 'inbound')!;
    expect(echoB).toMatchObject({ messageId: 'bind-message', content: [{ type: 'text', data: { text: hidden } }] });
    expect(carriesCode(b.frames)).toBe(false);
    expect(carriesCode(a.frames)).toBe(false);
    // What the Runtime records (and so what history replays to B) and what native listeners get.
    const payload = receive.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ content: hidden, segments: [{ type: 'text', data: { text: hidden } }] });
    expect(carriesCode(payload)).toBe(false);
    expect(carriesCode(events.mock.calls.map(([event]) => event.payload))).toBe(false);
  });

  it('hides by shape alone and leaves other text alone', () => {
    const redact = (content: unknown) => redactSandboxBindCode(parseSandboxWsPayload(JSON.stringify({ ...scene, content })), JSON.stringify({ ...scene, content }));
    // No code needs to be open: an expired or never-issued code is hidden the same way.
    expect(redact('绑定 ZZZZ9999').message.text).toBe('绑定 ***');
    expect(redact('zhin 绑定 ABCD2345').message.text).toBe('zhin 绑定 ***');
    const hidden = redact([{ type: 'text', data: { text: '绑定 ' } }, { type: 'text', data: { text: CODE } }]);
    expect(hidden.message.content).toEqual([{ type: 'text', data: { text: '绑定 ***' } }]);
    expect(carriesCode(JSON.parse(hidden.raw))).toBe(false);
    // A code-shaped argument cannot be told from a code: it is hidden too (README: known trade-off).
    expect(redact('绑定 23456789').message.text).toBe('绑定 ***');
    for (const text of ['hello', '我想绑定 ABCD2345 这个号', '绑定 12345678', '认领 ABCD2345',
      'bind username', 'BIND ME PLEASE', 'Bind Mysterys', 'bind a-b-c-d-e-f-g-h', '绑定 ABCDEFGH', 'bind abcd-efgh']) {
      const result = redact(text);
      expect(result.redacted).toBe(false);
      expect(result.message.text).toBe(text);
    }
  });

  it('hides the code in an action-only frame: its segment payload and message.action too, and adds no text segment', () => {
    const content = [{ type: 'action', data: { id: 'bind', payload: `绑定 ${CODE}` } }];
    const frame = JSON.stringify({ ...scene, content });
    const result = redactSandboxBindCode(parseSandboxWsPayload(frame), frame);
    expect(result.redacted).toBe(true);
    expect(result.message.text).toBe('绑定 ***');
    expect(result.message.content).toEqual([{ type: 'action', data: { id: 'bind', payload: '绑定 ***' } }]);
    expect(result.message.content.every(segment => segment.type === 'action')).toBe(true);
    expect(result.message.action).toEqual({ id: 'bind', payload: '绑定 ***' });
    expect((JSON.parse(result.raw) as { content: unknown }).content).toEqual(result.message.content);
    expect(carriesCode(result.raw)).toBe(false);
    expect(carriesCode(result.message)).toBe(false);
  });

  it('hides an action whose id stands in for its payload, and leaves other actions alone', () => {
    const frame = JSON.stringify({ ...scene, content: [{ type: 'action', data: { id: `bind ${CODE}` } }] });
    const result = redactSandboxBindCode(parseSandboxWsPayload(frame), frame);
    expect(result.message.action).toEqual({ id: 'bind ***', payload: 'bind ***' });
    expect(carriesCode(result)).toBe(false);
    const plain = JSON.stringify({ ...scene, content: [{ type: 'action', data: { id: 'next', payload: '下一页' } }] });
    const parsed = parseSandboxWsPayload(plain);
    const kept = redactSandboxBindCode(parsed, plain);
    expect(kept).toEqual({ message: parsed, raw: plain, redacted: false });
  });

  it('user A clicks an action carrying a bind code: broadcast, raw, segments and metadata never carry it', async () => {
    const { connect, receive, events } = await fixture();
    const a = await connect(owner);
    const b = await connect(operator);
    a.send({ ...scene, messageId: 'bind-action', content: [{ type: 'action', data: { id: 'bind', payload: `绑定 ${CODE}` } }] });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(b.frames.some(frame => frame.direction === 'inbound')).toBe(true));
    expect(carriesCode(b.frames)).toBe(false);
    expect(carriesCode(a.frames)).toBe(false);
    const payload = receive.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ content: '绑定 ***', segments: [{ type: 'action', data: { id: 'bind', payload: '绑定 ***' } }] });
    expect(payload.metadata).toMatchObject({ action: { id: 'bind', payload: '绑定 ***' }, elements: [{ type: 'action', data: { payload: '绑定 ***' } }] });
    expect(carriesCode(payload.event)).toBe(false);
    expect(carriesCode(payload)).toBe(false);
    expect(carriesCode(events.mock.calls.map(([event]) => event.payload))).toBe(false);
  });
});
