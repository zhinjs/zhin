import { describe, expect, it, vi } from 'vitest';
import {
  capabilityId, ChatRoleService, createChatRoleReader, featureId, isChatIdentity, rootPluginId,
  type ChatRoleEntry, type ChatRoleReader,
} from 'zhin.js';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint, sandboxConsoleUser } from '../src/endpoint.js';
import { parseSandboxWsFrame, resolveSandboxEndpoint, sandboxSimulatedSenderId } from '../src/protocol.js';
import { sandboxOperations } from './sandbox-operations.js';

// The ready frame is gated on a host `docker info` probe; keep this suite independent of the runner's Docker.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

type Frame = Record<string, unknown>;
type Principal = Parameters<typeof sandboxConsoleUser>[0];

/**
 * ADR 0060 §5.4 (P3): the Sandbox speaks as the Console user's linked chat identity only when asked
 * and only for a signed-in user; every client-chosen id is simulated and holds no zhin role.
 */
function fakeHttp() {
  let accept: ((connection: unknown) => void) | undefined;
  const http = {
    ws: () => ({ onConnection: (listener: (connection: unknown) => void) => { accept = listener; return () => { accept = undefined; }; }, close: () => undefined }),
    // ADR 0064 I1: the endpoint also mounts its hosted-media routes.
    route: () => () => undefined,
    address: undefined,
  };
  const connect = async (principal: Principal) => {
    const frames: Frame[] = [];
    const listeners = new Set<(data: string) => void>();
    const closeListeners = new Set<(code: number, reason: string) => void>();
    accept!({
      url: new URL('http://127.0.0.1/sandbox'), headers: new Headers(), principal, bufferedAmount: 0,
      send: (data: string) => frames.push(JSON.parse(data) as Frame),
      close: () => undefined,
      onMessage: (listener: (data: string) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      onClose: (listener: (code: number, reason: string) => void) => { closeListeners.add(listener); return () => closeListeners.delete(listener); },
    });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
    const send = (payload: unknown) => { for (const listener of listeners) listener(JSON.stringify(payload)); };
    // Echoes go to subscribed pages only.
    send({ op: 'subscribe', conversation: { type: 'private', id: 'room' } });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'subscribed')).toBe(true));
    // The Host closes the socket on close and on `principal-revoked`.
    const close = () => { for (const listener of [...closeListeners]) listener(4001, 'Credentials revoked'); };
    return { frames, send, close };
  };
  return { http, connect };
}

const OWNER_PERSON = { id: 'cp_owner', identities: [{ adapter: 'sandbox', userId: 'console-u-owner' }, { adapter: 'qq', userId: '10001' }] };

function roles(): ChatRoleReader {
  // The global owner holds `owner` on every identity of the person, including the old sandbox id `dev-user`.
  const entries: ChatRoleEntry[] = [
    { level: 'global', key: '', adapter: 'qq', userId: '10001', principalId: 'cp_owner', role: 'owner', source: 'grant' },
    { level: 'global', key: '', adapter: 'sandbox', userId: 'dev-user', role: 'owner', source: 'grant' },
  ];
  const service = new ChatRoleService({ store: {
    list: () => entries,
    principalOf: identity => OWNER_PERSON.identities.some(held => held.adapter === identity.adapter && held.userId === identity.userId) ? OWNER_PERSON : undefined,
    principal: id => id === OWNER_PERSON.id ? OWNER_PERSON : undefined,
  } });
  return createChatRoleReader({
    roles: () => service,
    conversationKey: conversation => `sandbox/shared-bot/${conversation.kind}:${conversation.id}`,
    consolePrincipal: user => user === 'u-owner' ? 'cp_owner' : undefined,
  });
}

type ConsoleSpeakerPort = NonNullable<ConstructorParameters<typeof SandboxWsEndpoint>[0]['consoleSpeaker']>;

async function fixture(reader: ChatRoleReader = roles(), extra: Readonly<{ consoleSpeaker?: ConsoleSpeakerPort; consoleSpeakerTimeoutMs?: number }> = {}) {
  const { http, connect } = fakeHttp();
  const receive = vi.fn(async (_input: unknown) => Object.freeze({ matched: true }));
  const events = vi.fn(async (event: EndpointEvent) => event.name === 'message.receive' ? receive(event.payload) : undefined);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'),
    http: http as never, defaults: resolveSandboxEndpoint({ id: 'shared-bot', owner: 'dev-user' }), chatRoles: reader, ...extra,
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], operations: sandboxOperations, gateway: createTestEndpointEventGateway({ receive: events }) });
  await endpoint.start();
  endpoint.open();
  const sent = async (client: Awaited<ReturnType<typeof connect>>, payload: Record<string, unknown>) => {
    const before = receive.mock.calls.length;
    client.send({ type: 'private', id: 'room', content: 'hi', ...payload });
    await vi.waitFor(() => expect(receive.mock.calls.length).toBe(before + 1));
    const echo = client.frames.filter(frame => frame.direction === 'inbound').at(-1)!;
    return { sender: (receive.mock.calls.at(-1)![0] as { sender: { id: string; name?: string } }).sender, echo };
  };
  return { connect, sent, receive };
}

/** A Console user; `self.chat-identity` (speaking as / creating one's own identity) unless `selfChatIdentity` is false. */
const user = (userId: string, displayName = 'Owner', globalIam = false, selfChatIdentity = true): Principal => ({ kind: 'user', userId, username: userId, displayName,
  credentialId: 'c', grants: [{ scope: { kind: 'global' }, permissions: [...(selfChatIdentity ? ['self.chat-identity'] : []), ...(globalIam ? ['iam.manage'] : [])] }],
  roles: [] } as Principal);

describe('Sandbox speaker identity (ADR 0060 §5.4)', () => {
  it('a typed owner id is simulated: reserved id, no zhin role, lowest trust (negative)', async () => {
    const { connect, sent } = await fixture();
    const client = await connect(user('u-plain', 'Operator'));
    // `dev-user` holds a stored global owner grant; typing it must not borrow that role.
    const { sender, echo } = await sent(client, { senderId: 'dev-user', senderName: 'Pretend owner' });
    expect(sender.id).toBe('~sim:dev-user');
    expect(isChatIdentity({ adapter: 'sandbox', userId: sender.id })).toBe(false);
    expect(echo).toMatchObject({ senderId: '~sim:dev-user', displaySenderId: 'dev-user', simulated: true, senderTrustLevel: 'group_member' });
    expect(echo.senderChatRole).toBeUndefined();
    // Also the id of the owner's own linked sandbox identity.
    const forged = await sent(client, { senderId: 'console-u-owner' });
    expect(forged.sender.id).toBe('~sim:console-u-owner');
    expect(forged.echo).toMatchObject({ simulated: true, senderTrustLevel: 'group_member' });
    // A client cannot pre-escape its id out of the namespace.
    expect((await sent(client, { senderId: '~sim:x' })).sender.id).toBe('~sim:x');
    // Without a sender id the configured default speaker is simulated as well.
    expect((await sent(client, {})).sender.id).toBe('~sim:dev-user');
  });

  it('「以我的聊天身份发言」 speaks as the linked person and resolves its role', async () => {
    const { connect, sent } = await fixture();
    const client = await connect(user('u-owner', 'Owner', true));
    expect(client.frames.find(frame => frame.type === 'ready')).toMatchObject({ consoleUser: true });
    const { sender, echo } = await sent(client, { asMe: true, senderId: 'ignored', senderName: 'ignored' });
    expect(sender).toMatchObject({ id: 'console-u-owner', name: 'Owner' });
    expect(echo).toMatchObject({ senderId: 'console-u-owner', simulated: false, senderChatRole: 'owner', senderTrustLevel: 'owner' });
  });

  it('security review: a linked person with a global grant speaks only for a caller with global iam.manage (negative)', async () => {
    const { connect, sent } = await fixture();
    // The link exists (e.g. the person received the global grant after the identity was created),
    // but this Console user lacks global iam.manage: simulated, role-less, with the reason.
    const client = await connect(user('u-owner', 'Owner', false));
    const { sender, echo } = await sent(client, { asMe: true, senderId: 'me' });
    expect(sender.id).toBe('~sim:me');
    expect(echo).toMatchObject({ simulated: true, asMeUnavailable: 'needs-global-iam', senderTrustLevel: 'group_member' });
    expect(echo.senderChatRole).toBeUndefined();
  });

  it('asMe without a linked identity, or without a signed-in user, falls back to a simulated sender (negative)', async () => {
    const { connect, sent } = await fixture();
    const unlinked = await connect(user('u-plain'));
    const first = await sent(unlinked, { asMe: true, senderId: 'dev-user' });
    expect(first.sender.id).toBe('~sim:dev-user');
    expect(first.echo).toMatchObject({ simulated: true, asMeUnavailable: 'no-identity', senderTrustLevel: 'group_member' });
    // Standalone / bootstrap: no Console user on the socket.
    for (const principal of [undefined, { kind: 'bootstrap', open: true } as Principal]) {
      const client = await connect(principal);
      expect(client.frames.find(frame => frame.type === 'ready')).toMatchObject({ consoleUser: false });
      const result = await sent(client, { asMe: true, senderId: 'dev-user' });
      expect(result.sender.id).toBe('~sim:dev-user');
      expect(result.echo).toMatchObject({ simulated: true, asMeUnavailable: 'no-console-user' });
    }
  });

  /** A reader whose `consoleSpeaker` answers for identities the port created. */
  const creating = () => {
    const created = new Set<string>();
    const base = roles();
    const reader: ChatRoleReader = {
      ...base,
      consoleSpeaker: (conversation, userId, options) => created.has(userId)
        ? { adapter: 'sandbox', userId: `console-${userId}` } : base.consoleSpeaker!(conversation, userId, options),
    };
    return { reader, created };
  };

  it('#1250 sandbox-speak-as-me: the first asMe message creates console-<userId> through the Adapter port and speaks as it', async () => {
    const ensured: unknown[] = [];
    const { reader, created } = creating();
    const consoleSpeaker: ConsoleSpeakerPort = {
      ensure: async (_conversation, principal) => {
        ensured.push(principal);
        // Slow on purpose: a second message sent meanwhile must not overtake the first.
        await new Promise(resolve => setTimeout(resolve, 20));
        created.add((principal as { userId: string }).userId);
      },
    };
    const { connect, sent } = await fixture(reader, { consoleSpeaker });
    const principal = user('u-new', 'Newbie');
    const client = await connect(principal);
    const { sender, echo } = await sent(client, { asMe: true, senderId: 'sandbox-user', senderName: 'Developer' });
    // The socket's own principal goes to the Root, which checks it (nothing self-reported).
    expect(ensured).toEqual([principal]);
    expect(sender).toMatchObject({ id: 'console-u-new', name: 'Newbie' });
    expect(echo).toMatchObject({ senderId: 'console-u-new', simulated: false });
    expect(echo.asMeUnavailable).toBeUndefined();
    // Once created it is used directly.
    await sent(client, { asMe: true });
    expect(ensured).toHaveLength(1);
  });

  it('#1250 M3: asMe needs self.chat-identity, like chat-identities.simulated.ensure (needs-self-chat-identity)', async () => {
    const ensure = vi.fn(async () => undefined);
    const { connect, sent } = await fixture(roles(), { consoleSpeaker: { ensure } });
    // Even the linked owner, even with global iam.manage, without self.chat-identity.
    for (const principal of [user('u-new', 'Viewer', false, false), user('u-owner', 'Owner', true, false)]) {
      const client = await connect(principal);
      const { sender, echo } = await sent(client, { asMe: true, senderId: 'me' });
      expect(sender.id).toBe('~sim:me');
      expect(echo).toMatchObject({ simulated: true, asMeUnavailable: 'needs-self-chat-identity', senderTrustLevel: 'group_member' });
    }
    expect(ensure).not.toHaveBeenCalled();
    expect(sandboxConsoleUser(user('u', 'U', false, false))).toMatchObject({ canUseChatIdentity: false });
  });

  it('#1250: a failed identity creation sends the message simulated with the reason (identity-failed)', async () => {
    const consoleSpeaker: ConsoleSpeakerPort = { ensure: async () => { throw new Error('未保存：聊天身份需要关系型项目数据库\n(sqlite)'); } };
    const { connect, sent } = await fixture(roles(), { consoleSpeaker });
    const client = await connect(user('u-new'));
    const { sender, echo } = await sent(client, { asMe: true, senderId: 'sandbox-user' });
    expect(sender.id).toBe('~sim:sandbox-user');
    expect(echo).toMatchObject({ simulated: true, asMeUnavailable: 'identity-failed', asMeError: '未保存：聊天身份需要关系型项目数据库 (sqlite)', senderTrustLevel: 'group_member' });
  });

  it('#1250 L2: a creation that never answers times out as identity-failed; later frames still go through', async () => {
    const consoleSpeaker: ConsoleSpeakerPort = { ensure: () => new Promise<void>(() => undefined) };
    const { connect } = await fixture(roles(), { consoleSpeaker, consoleSpeakerTimeoutMs: 30 });
    const client = await connect(user('u-new'));
    client.send({ type: 'private', id: 'room', content: 'first', asMe: true, messageId: 'm1' });
    client.send({ type: 'private', id: 'room', content: 'second', messageId: 'm2' });
    await vi.waitFor(() => expect(client.frames.filter(frame => frame.direction === 'inbound').map(frame => frame.messageId)).toEqual(['m1', 'm2']));
    expect(client.frames.find(frame => frame.messageId === 'm1')).toMatchObject({ simulated: true, asMeUnavailable: 'identity-failed',
      asMeError: expect.stringContaining('超时') });
  });

  it('keeps the order of a socket\'s messages while an identity is being created', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const consoleSpeaker: ConsoleSpeakerPort = { ensure: async () => { await gate; } };
    const { connect } = await fixture(roles(), { consoleSpeaker });
    const client = await connect(user('u-new'));
    client.send({ type: 'private', id: 'room', content: 'first', asMe: true, messageId: 'm1' });
    client.send({ type: 'private', id: 'room', content: 'second', messageId: 'm2' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(client.frames.filter(frame => frame.direction === 'inbound')).toEqual([]);
    release();
    await vi.waitFor(() => expect(client.frames.filter(frame => frame.direction === 'inbound').map(frame => frame.messageId)).toEqual(['m1', 'm2']));
    expect(client.frames.find(frame => frame.messageId === 'm1')).toMatchObject({ asMeUnavailable: 'no-identity' });
  });

  it('#1250 L2: once the socket closes (principal-revoked), the waiting and queued frames are never dispatched', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const consoleSpeaker: ConsoleSpeakerPort = { ensure: async () => { await gate; } };
    const { connect, receive } = await fixture(roles(), { consoleSpeaker });
    const client = await connect(user('u-new'));
    const before = receive.mock.calls.length;
    client.send({ type: 'private', id: 'room', content: 'first', asMe: true, messageId: 'm1' });
    client.send({ type: 'private', id: 'room', content: 'second', messageId: 'm2' });
    await new Promise(resolve => setTimeout(resolve, 10));
    client.close();
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(receive.mock.calls.length).toBe(before);
    expect(client.frames.filter(frame => frame.direction === 'inbound')).toEqual([]);
  });

  it('parses asMe only as a literal true and namespaces simulated ids once', () => {
    const parse = (payload: unknown) => (parseSandboxWsFrame(JSON.stringify(payload)) as { message: { asMe?: boolean } }).message;
    expect(parse({ type: 'private', id: 'r', content: 'x', asMe: true }).asMe).toBe(true);
    expect(parse({ type: 'private', id: 'r', content: 'x', asMe: 'yes' }).asMe).toBeUndefined();
    expect(sandboxSimulatedSenderId('a')).toBe('~sim:a');
    expect(sandboxSimulatedSenderId('~sim:a')).toBe('~sim:a');
    expect(sandboxConsoleUser({ kind: 'api-token', userId: 'u', username: 'u', displayName: '', credentialId: 'c', grants: [], roles: [] })).toEqual({ userId: 'u', canManageGlobal: false, canUseChatIdentity: false });
  });
});

describe('Sandbox page speaker helpers', () => {
  it('reads the server answer and asks for asMe only with a Console user', async () => {
    const { readServerSpeaker, wantsAsMe } = await import('../pages/index/chatIdentity.js');
    expect(readServerSpeaker({ senderId: '~sim:dev-user', displaySenderId: 'dev-user', simulated: true, senderTrustLevel: 'group_member', asMeUnavailable: 'no-identity' }))
      .toEqual({ senderId: '~sim:dev-user', displaySenderId: 'dev-user', simulated: true, trustLevel: 'group_member', asMeUnavailable: 'no-identity' });
    expect(readServerSpeaker({ senderId: 'console-u1', simulated: false, senderTrustLevel: 'owner', senderChatRole: 'owner' }))
      .toEqual({ senderId: 'console-u1', displaySenderId: 'console-u1', simulated: false, trustLevel: 'owner', chatRole: 'owner' });
    // An older Host echo without trust facts carries no speaker.
    expect(readServerSpeaker({ senderId: 'dev-user' })).toBeNull();
    expect(wantsAsMe('me', true)).toBe(true);
    expect(wantsAsMe('me', false)).toBe(false);
    expect(wantsAsMe('simulated', true)).toBe(false);
  });

  it('#1250: turns the switch off with the reason only when the server could not speak as me', async () => {
    const { asMeFallbackNotice, readServerSpeaker } = await import('../pages/index/chatIdentity.js');
    const failed = readServerSpeaker({ senderId: '~sim:dev-user', simulated: true, senderTrustLevel: 'group_member', asMeUnavailable: 'identity-failed', asMeError: 'no db' })!;
    expect(failed).toMatchObject({ asMeUnavailable: 'identity-failed', asMeError: 'no db' });
    expect(asMeFallbackNotice(failed)).toEqual({ reason: 'identity-failed', error: 'no db' });
    expect(asMeFallbackNotice(readServerSpeaker({ senderId: '~sim:x', simulated: true, senderTrustLevel: 'group_member', asMeUnavailable: 'needs-global-iam' })!))
      .toEqual({ reason: 'needs-global-iam' });
    expect(asMeFallbackNotice(readServerSpeaker({ senderId: '~sim:x', simulated: true, senderTrustLevel: 'group_member', asMeUnavailable: 'needs-self-chat-identity' })!))
      .toEqual({ reason: 'needs-self-chat-identity' });
    // An older Host that cannot create the identity keeps the manual button; speaking as me needs nothing.
    expect(asMeFallbackNotice(readServerSpeaker({ senderId: '~sim:x', simulated: true, senderTrustLevel: 'group_member', asMeUnavailable: 'no-identity' })!)).toBeNull();
    expect(asMeFallbackNotice(readServerSpeaker({ senderId: 'console-u1', simulated: false, senderTrustLevel: 'owner' })!)).toBeNull();
  });
});
