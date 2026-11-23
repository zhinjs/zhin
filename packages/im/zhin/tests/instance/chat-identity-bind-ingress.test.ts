/**
 * zhinjs/zhin#1250 bind-hint-omits-command-prefix: `绑定 <码>` works without the command prefix, like
 * `认领 <码>` — taken at the start of inbound by the bind guard (combined with the claim guard), with or
 * without the prefix; ordinary chat that mentions 绑定 still reaches the Agent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec, type Endpoint } from '@zhin.js/adapter';
import { ImRuntime, ingressRouteToken, type IngressRoute, type InboundSecretGuard } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import {
  SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type CapabilitySlot, type FeatureId, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import { ChatPeople } from '../../src/instance/chat-people.js';
import { ChatOwnerClaim, createChatOwnerClaimGuard } from '../../src/instance/chat-owner-claim.js';
import {
  ChatIdentityBindCodes, combineInboundSecretGuards, createChatIdentityBindGuard, matchChatIdentityBindText,
} from '../../src/instance/chat-identity-bind.js';

const CODE = 'BIND2222';

class TestEndpoint implements Endpoint {
  readonly sent: unknown[] = [];
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {},
    send: request => { this.sent.push(request.payload); return 'sent'; },
  });
}
class TestAdapter extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(); } }

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = rootPluginId();
  const qq = childPluginId(root, 'qq');
  const sandbox = childPluginId(root, 'sandbox');
  const store = new ChatRoleStore();
  const roles: InstanceChatRoleService = new ChatRoleService({ store });
  const people = new ChatPeople({ store });
  const codes = new ChatIdentityBindCodes({ people, code: () => CODE });
  // An owner exists, so no claim is open: only the bind guard can take messages.
  await store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'boss', role: 'owner' });
  const claim = new ChatOwnerClaim({ roles, logger: { info() {}, warn() {} }, now: () => 42, pid: 1 });
  await claim.refresh();
  const events = new MemoryConversationEventStore();
  const appended: unknown[] = [];
  const append = events.append.bind(events);
  events.append = async event => { appended.push(event); return append(event); };
  const im = new ImRuntime({ conversationEvents: events,
    inboundSecret: combineInboundSecretGuards(createChatOwnerClaimGuard({ claim }), createChatIdentityBindGuard({ codes })) });
  const agent = vi.fn<IngressRoute['route']>(async () => true);
  const adapters = { qq: new TestAdapter(), sandbox: new TestAdapter() };
  const slot = (owner: typeof qq, name: 'qq' | 'sandbox', profile: object) => createCapabilitySlot({ owner, feature: adapterFeatureId, localName: name,
    source: `/project/${name}/index.ts`, definition: defineAdapter({ capabilities: ['inbound', 'outbound'], profile, createAdapter: () => adapters[name] }) });
  const qqSlot = slot(qq, 'qq', { default: { delivery: { send: true } } });
  const sandboxSlot = slot(sandbox, 'sandbox', { default: { delivery: { send: true }, runtime: { sandbox: true } } });
  const node = (id: typeof qq, instanceKey: string) => ({ id, instanceKey, packageName: `@test/${instanceKey}`, packageRoot: `/project/${instanceKey}`, parent: root, children: [] });
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [qq, sandbox] }],
      [qq, node(qq, 'qq')], [sandbox, node(sandbox, 'sandbox')]]) as never,
    config: new Map([[root, {}], [qq, { commandPrefix: '#', endpoints: [{ id: 'bot' }] }], [sandbox, { endpoints: [{ id: 'sim' }] }]]),
    resources: new Map([[root, new Map<string, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [ingressRouteToken.id, { route: agent }]])],
      [qq, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])], [sandbox, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
    capabilities: new Map<CapabilityId, CapabilitySlot>([[qqSlot.id, qqSlot], [sandboxSlot.id, sandboxSlot]]), projections: new Map(),
  };
  const index = await AdapterIndex.create([qqSlot, sandboxSlot], createSnapshotView(0, state), new AbortController().signal);
  const snapshots = new SnapshotStore({ ...state, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index]]) });
  im.attach(snapshots);
  await index.start();
  index.open();
  cleanups.push(async () => { await index.stop(); await snapshots.close(); await claim.dispose(); });
  const endpointOf = (name: 'qq' | 'sandbox') => adapters[name].getEndpoint(adapters[name].list()[0]!.instanceId)!;
  let sequence = 0;
  const send = async (name: 'qq' | 'sandbox', kind: 'private' | 'group', content: string, sender = 'alice') => {
    const endpoint = endpointOf(name);
    const before = endpoint.sent.length;
    const conversation = { endpoint: { id: name, adapter: name }, kind, id: kind === 'private' ? sender : 'room' };
    await endpoint[endpointSpec].events.message({ conversation, content, endpointId: name === 'qq' ? 'bot' : 'sim', sender: { id: sender }, event: {},
      message: { conversation, id: `m${(sequence += 1)}` } });
    return endpoint.sent.slice(before).map(payload => JSON.stringify(payload)).join('\n');
  };
  return { store, codes, agent, send, appended };
}

describe('bind messages at inbound (#1250 bind-hint-omits-command-prefix)', () => {
  it.each([
    ['without the prefix', `绑定 ${CODE}`],
    ['with the prefix', `#绑定 ${CODE}`],
    ['english keyword, lower case, with gaps', 'bind bind-2222'],
  ])('a private chat binds %s', async (_label, text) => {
    const { send, codes, store, agent, appended } = await setup();
    codes.create({ consoleUserId: 'u1', consoleDisplayName: 'Una', canManageGlobal: false });
    const reply = await send('qq', 'private', text);
    expect(reply).toContain('已绑定');
    expect(store.principals.linkOfConsoleUser('u1')).toBeDefined();
    expect(agent).not.toHaveBeenCalled();
    expect(JSON.stringify(appended)).not.toContain(CODE);
  });

  it('with no open code nothing is taken: bind-shaped chat reaches commands / the Agent, uncounted (M1)', async () => {
    const { send, agent, codes, appended } = await setup();
    const guard = createChatIdentityBindGuard({ codes });
    const input = (text: string) => ({ text, prefix: '#', conversation: { endpoint: { id: 'qq', adapter: 'qq' }, kind: 'private', id: 'alice' } as never, snapshot: {} as never });
    // `USERNAME` and `82345678` have the shape of a code (8 symbols of its alphabet).
    for (const text of ['bind username', '绑定 82345678', '#绑定 82345678']) expect(guard.match(input(text))).toBeUndefined();
    expect(await send('qq', 'private', 'bind username')).toBe('');
    expect(await send('qq', 'private', '绑定 82345678')).toBe('');
    expect(agent).toHaveBeenCalledTimes(2);
    // The Agent still gets the message as sent (routing is unchanged)…
    expect(agent.mock.calls.map(([message]) => String(message.content))).toEqual(['bind username', '绑定 82345678']);
    // …but the record shows a bind-shaped text as `绑定 ***` by its shape alone, open code or not
    // (#1250 sandbox-transcript-shared-bind-code: records are read back by other Console users).
    // Known trade-off: `82345678` (8 symbols of the alphabet) cannot be told from a code, so a
    // project's own `绑定 <QQ号>` with such a number is recorded as `绑定 ***` too. `bind username`
    // (a word without a digit: every bind code holds one) is recorded as written.
    expect(JSON.stringify(appended)).not.toContain('82345678');
    expect(JSON.stringify(appended)).toContain('绑定 ***');
    expect(JSON.stringify(appended)).toContain('bind username');
    // Not counted: many of them never lock the sender out of a code created afterwards.
    for (let attempt = 0; attempt < 6; attempt += 1) await send('qq', 'private', '绑定 ZZZZ9999');
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    expect(await send('qq', 'private', `绑定 ${CODE}`)).toContain('已绑定');
  });

  it('while a code is open a mistyped one is answered and counted (5 lock the identity out), never sent to the Agent', async () => {
    const { send, agent, codes, store } = await setup();
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await send('qq', 'private', '绑定 ZZZZ9999')).toContain('绑定码不正确或已过期');
    expect(agent).not.toHaveBeenCalled();
    expect(await send('qq', 'private', `绑定 ${CODE}`)).toContain('错误次数过多');
    expect(store.principals.linkOfConsoleUser('u1')).toBeUndefined();
    // Not the shape of a code, or more than one token: ordinary chat even while a code is open.
    expect(await send('qq', 'private', 'bind it')).toBe('');
    expect(await send('qq', 'private', '绑定 手机 号码')).toBe('');
    expect(agent).toHaveBeenCalledTimes(2);
  });

  it('a bind message dropped before it is handled revokes the open code it carried (L1)', () => {
    const { codes } = { codes: new ChatIdentityBindCodes({ people: new ChatPeople({ store: new ChatRoleStore() }), code: () => CODE }) };
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    const guard = createChatIdentityBindGuard({ codes });
    const matched = guard.match({ text: `绑定 ${CODE}`, prefix: '', conversation: { kind: 'private' } as never, snapshot: {} as never });
    expect(matched?.redacted).toBe('绑定 ***');
    void matched!.discard!();
    expect(codes.isOpen(CODE)).toBe(false);
    expect(codes.anyOpen).toBe(false);
  });

  it('in a group only an open code is taken (revoked, told to use a private chat); the Sandbox refuses', async () => {
    const { send, codes } = await setup();
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    expect(await send('qq', 'group', `绑定 ${CODE}`)).toContain('绑定只接受私聊');
    expect(codes.isOpen(CODE)).toBe(false);
    expect(await send('qq', 'group', '绑定 ZZZZ9999')).toBe('');
    codes.create({ consoleUserId: 'u1', canManageGlobal: false });
    expect(await send('sandbox', 'private', `绑定 ${CODE}`)).toContain('不接受绑定');
  });

  it('every generated code holds a digit and has the code shape (#1250: the redaction needs one)', () => {
    const codes = new ChatIdentityBindCodes({ people: new ChatPeople({ store: new ChatRoleStore() }) });
    const seen = new Set<string>();
    for (let index = 0; index < 5_000; index += 1) {
      const { code } = codes.create({ consoleUserId: `u${index}`, canManageGlobal: false });
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/u);
      expect(code).toMatch(/\d/u);
      seen.add(code);
    }
    // Still drawn at random (no fixed digit position collapsing the space).
    expect(seen.size).toBeGreaterThan(4_990);
    expect(new Set([...seen].map(code => code.search(/\d/u))).size).toBeGreaterThan(4);
  });

  it('matches the bind shape only', () => {
    expect(matchChatIdentityBindText(`绑定 ${CODE}`)).toEqual({ keyword: '绑定', code: CODE });
    expect(matchChatIdentityBindText(`!!绑定 <${CODE}>`, '!!')).toEqual({ keyword: '绑定', code: CODE });
    expect(matchChatIdentityBindText('我想绑定 手机')).toBeUndefined();
    expect(matchChatIdentityBindText('绑定了')).toBeUndefined();
  });

  it('combineInboundSecretGuards: first match wins; native events are withheld when any guard says so', async () => {
    const hit = { name: 'a', redacted: 'a ***', handle: () => undefined };
    const discarded: string[] = [];
    const first: InboundSecretGuard = { match: () => undefined, inspectNative: () => false, discardNative: () => { discarded.push('first'); } };
    const second: InboundSecretGuard = { match: () => hit, inspectNative: () => true, discardNative: () => { discarded.push('second'); } };
    const combined = combineInboundSecretGuards(first, second);
    expect(combined.match({ text: 'x', prefix: '', conversation: {} as never, snapshot: {} as never })).toBe(hit);
    expect(combined.inspectNative!({}, { name: 'e' })).toBe(true);
    await combined.discardNative!({}, { name: 'e' });
    expect(discarded).toEqual(['first', 'second']);
  });
});
