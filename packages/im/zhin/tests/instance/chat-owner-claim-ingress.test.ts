/**
 * zhinjs/zhin#1250 (`claim-hint-omits-command-prefix`, `claim-code-sent-to-llm`): a claim-shaped message
 * is taken at the start of inbound — with or without the command prefix, in private chats and groups,
 * with a correct or a wrong code — and never reaches the Agent, the conversation history, the message
 * event stream, diagnostics, outcomes or the log. Ordinary chat that mentions 认领 still reaches the Agent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, createPeerRegistry, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec, type Endpoint } from '@zhin.js/adapter';
import { ImRuntime, ingressRouteToken, roomMembershipToken, type IngressRoute } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import { containsChatOwnerClaimCode } from '@zhin.js/kernel';
import { addTransport, removeTransport, setLevel, getLogger } from '@zhin.js/logger';
import {
  SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type CapabilitySlot, type FeatureId, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import {
  CHAT_OWNER_CLAIM_NATIVE_LIMITS, ChatOwnerClaim, createChatOwnerClaimGuard, hasGlobalOwner, inspectNativeClaimPayload,
} from '../../src/instance/chat-owner-claim.js';

const CODE = 'AAAA2222';
const NEXT = 'BBBB3333';

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

async function setup(options: Readonly<{ deduper?: { claim(): never }; membership?: object }> = {}) {
  const root = rootPluginId();
  const qq = childPluginId(root, 'qq');
  const sandbox = childPluginId(root, 'sandbox');
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore() });
  const codes = [CODE, NEXT, 'CCCC4444', 'DDDD5555'];
  const claim = new ChatOwnerClaim({ roles, logger: { info() {}, warn() {} }, code: () => codes.shift()!, now: () => 42, pid: 1 });
  await claim.refresh();
  const events = new MemoryConversationEventStore();
  const appended: unknown[] = [];
  const append = events.append.bind(events);
  events.append = async event => { appended.push(event); return append(event); };
  const peers = createPeerRegistry();
  peers.declareExternal('qq', 'other-bot');
  const im = new ImRuntime({ conversationEvents: events, peerRegistry: peers, inboundSecret: createChatOwnerClaimGuard({ claim }),
    ...(options.deduper ? { inboundDeduper: options.deduper as never } : {}) });
  const agent = vi.fn<IngressRoute['route']>(async () => true);
  const route: IngressRoute = { route: agent };
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
    resources: new Map([[root, new Map<string, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [ingressRouteToken.id, route],
      ...(options.membership ? [[roomMembershipToken.id, options.membership] as const] : [])])], [qq, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])], [sandbox, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
    capabilities: new Map<CapabilityId, CapabilitySlot>([[qqSlot.id, qqSlot], [sandboxSlot.id, sandboxSlot]]), projections: new Map(),
  };
  const index = await AdapterIndex.create([qqSlot, sandboxSlot], createSnapshotView(0, state), new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index]]) });
  im.attach(store);
  await index.start();
  index.open();
  const published: unknown[] = [];
  const unsubscribe = im.messageEvents.subscribe(event => { published.push(event); });
  const logs: string[] = [];
  const transport = { write: (line: string) => { logs.push(line); } };
  addTransport(transport);
  setLevel('debug', getLogger('im.inbound'), true);
  cleanups.push(async () => { removeTransport(transport); unsubscribe(); await index.stop(); await store.close(); await claim.dispose(); });
  const endpointOf = (name: 'qq' | 'sandbox') => adapters[name].getEndpoint(adapters[name].list()[0]!.instanceId)!;
  let sequence = 0;
  const send = async (name: 'qq' | 'sandbox', kind: 'private' | 'group', content: string, sender = 'alice', segments?: readonly object[]) => {
    const endpoint = endpointOf(name);
    const before = endpoint.sent.length;
    const conversation = { endpoint: { id: name, adapter: name }, kind, id: kind === 'private' ? sender : 'room' };
    await endpoint[endpointSpec].events.message({ conversation, content, ...(segments ? { segments } : {}), endpointId: name === 'qq' ? 'bot' : 'sim', sender: { id: sender }, event: {},
      message: { conversation, id: `m${(sequence += 1)}` } });
    return endpoint.sent.slice(before).map(payload => JSON.stringify(payload)).join('\n');
  };
  /** Everything the runtime kept or emitted about the messages, except replies sent to the platform. */
  const kept = async () => JSON.stringify({
    appended,
    published, logs, diagnostics: im.messageDiagnostics.list(), outcomes: im.messageOutcomes.list(),
  });
  /** Whether anything kept carries `code`, however written. */
  const leaked = async (code = CODE) => containsChatOwnerClaimCode(await kept(), code);
  return { im, appended, claim, roles, agent, send, kept, leaked, published, logs, peers, endpointOf };
}

describe('claim-shaped messages at inbound (#1250)', () => {
  it.each([
    ['without the prefix', `认领 ${CODE}`],
    ['with the prefix', `#认领 ${CODE}`],
    ['english keyword', `claim ${CODE.toLowerCase()}`],
  ])('a private chat claims %s and nothing keeps the code', async (_label, text) => {
    const { send, agent, kept, roles, claim } = await setup();
    const reply = await send('qq', 'private', text);
    expect(reply).toContain('认领成功');
    expect(hasGlobalOwner(roles)).toBe(true);
    expect(claim.active).toBe(false);
    expect(agent).not.toHaveBeenCalled();
    const record = await kept();
    expect(record).not.toContain(CODE);
    expect(record).not.toContain(CODE.toLowerCase());
  });

  it.each([
    ['without the prefix', `认领 ZZZZ9999`],
    ['with the prefix', `#认领 ZZZZ9999`],
  ])('a wrong code %s in a private chat is answered and counted, not sent to the Agent', async (_label, text) => {
    const { send, agent, kept, roles, claim } = await setup();
    expect(await send('qq', 'private', text)).toContain('不正确');
    expect(await send('qq', 'private', text)).toContain('不正确');
    // Counted: the sender is locked after two wrong codes.
    expect(await send('qq', 'private', text)).toContain('错误次数过多');
    expect(agent).not.toHaveBeenCalled();
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(claim.active).toBe(true);
    expect(await kept()).not.toContain('ZZZZ9999');
  });

  it.each([
    ['without the prefix', `认领 ZZZZ9999`],
    ['with the prefix', `#认领 ZZZZ9999`],
    ['claim it', 'claim it'],
    ['认领 任务', '认领 任务'],
  ])('in a group, text without the current code (%s) goes to the Agent while a claim is open', async (_label, text) => {
    const { send, agent, claim } = await setup();
    expect(await send('qq', 'group', text)).toBe('');
    expect(agent).toHaveBeenCalledTimes(1);
    expect(claim.active).toBe(true);
  });

  it.each([
    ['认领:码', `认领:${CODE}`],
    ['traditional 認領', `認領 ${CODE}`],
    ['full-width', `ｃｌａｉｍ ａａａａ２２２２`],
    ['认领码', `认领码${CODE}`],
    ['split code', `认领 AAAA 2222`],
    ['trailing punctuation', `认领 ${CODE}!!!!`],
    ['zero-width characters', `认领 AA\u200BAA\u200D2222`],
    ['lower case with a hyphen', `claim aaaa-2222`],
  ])('a private message carrying the current code (%s) claims, and nothing keeps the code', async (_label, text) => {
    const { send, agent, leaked, roles } = await setup();
    expect(await send('qq', 'private', text)).toContain('认领成功');
    expect(hasGlobalOwner(roles)).toBe(true);
    expect(agent).not.toHaveBeenCalled();
    expect(await leaked()).toBe(false);
  });

  it.each([
    ['trailing words', `认领 ${CODE} 谢谢`],
    ['a long word carrying the code', `认领 ${'Z'.repeat(400)}${CODE}ZZZZ`],
    ['the command with a long word', `#认领 ${'Z'.repeat(400)}${CODE}`],
    ['many candidates, not claim-shaped', `${Array.from({ length: 300 }, (_, index) => `Z${String(index).padStart(3, '2')}ZZZZ`).join(' ')} ${CODE}`],
  ])('a private message carrying the code among other text (%s) revokes it and does not claim (#1289 review)', async (_label, text) => {
    const { send, agent, leaked, roles, claim } = await setup();
    expect(await send('qq', 'private', text)).toContain('码已作废');
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(agent).not.toHaveBeenCalled();
    expect(await leaked()).toBe(false);
    expect(claim.carries(CODE)).toBe(false);
    expect(claim.carries(NEXT)).toBe(true);
    expect(await send('qq', 'private', `认领 ${NEXT}`, 'bob')).toContain('认领成功');
  });

  it('a group message that @mentions the bot and carries the code burns it', async () => {
    const { send, agent, leaked, claim } = await setup();
    const reply = await send('qq', 'group', `@bot 认领 ${CODE}`, 'alice',
      [{ type: 'mention', data: { target: 'bot' } }, { type: 'text', data: { text: ` 认领 ${CODE}` } }]);
    expect(reply).toContain('只接受私聊');
    expect(agent).not.toHaveBeenCalled();
    expect(await leaked()).toBe(false);
    expect(claim.carries(CODE)).toBe(false);
    expect(claim.carries(NEXT)).toBe(true);
  });

  it('a peer bot posting the code in a group burns it without a reply or a record', async () => {
    const { send, agent, leaked, claim, appended } = await setup();
    expect(await send('qq', 'group', `认领 ${CODE}`, 'other-bot')).toBe('');
    expect(agent).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(await leaked()).toBe(false);
    expect(claim.carries(CODE)).toBe(false);
    expect(claim.active).toBe(true);
  });

  it('one of our own accounts posting the code (a self echo) burns it without a reply or a record (#1289 review)', async () => {
    const { send, agent, leaked, claim, appended, peers, im } = await setup();
    const row = im.endpoints.list().find(item => item.endpoint.adapter === 'qq')!;
    peers.registerEndpoint({}, { endpointId: row.endpoint.id as never, adapter: 'qq', selfUserId: 'bot-self' });
    expect(await send('qq', 'group', `认领 ${CODE}`, 'bot-self')).toBe('');
    expect(agent).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(await leaked()).toBe(false);
    expect(claim.carries(CODE)).toBe(false);
    expect(claim.carries(NEXT)).toBe(true);
  });

  it.each([
    ['the venue is not ready', 'dropped_unready', { membership: { isMember: () => false, isRoomReady: () => ({ ready: false, unreadyEndpoints: ['qq'] }) } }],
    ['deduplication fails', 'dropped_dedup_error', {
      deduper: { claim: (): never => { throw new Error('boom'); } },
      membership: { isMember: () => false, hasRoom: () => true },
    }],
  ] as const)('a group message carrying the code is burnt when %s, without a reply, a record or the Agent (#1289 review)', async (_label, outcome, options) => {
    const { send, agent, leaked, claim, appended, im } = await setup(options);
    expect(await send('qq', 'group', `认领 ${CODE}`)).toBe('');
    expect(agent).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(await leaked()).toBe(false);
    expect(claim.carries(CODE)).toBe(false);
    expect(claim.carries(NEXT)).toBe(true);
    expect(im.messageOutcomes.list({ limit: 1 })[0]?.outcome).toBe(outcome);
    // Text without the code is dropped the same way but burns nothing.
    await send('qq', 'group', 'hello');
    expect(claim.carries(NEXT)).toBe(true);
  });

  it.each([
    ['without the prefix', `认领 ${CODE}`],
    ['with the prefix', `#认领 ${CODE}`],
  ])('a correct code %s in a group is burnt and kept from the Agent', async (_label, text) => {
    const { send, agent, leaked, roles } = await setup();
    expect(await send('qq', 'group', text)).toContain('只接受私聊');
    expect(agent).not.toHaveBeenCalled();
    expect(await leaked()).toBe(false);
    // Burnt: the code no longer works in private either; the new one does.
    expect(await send('qq', 'private', `认领 ${CODE}`)).toContain('不正确');
    expect(await send('qq', 'private', `认领 ${NEXT}`, 'bob')).toContain('认领成功');
    expect(hasGlobalOwner(roles)).toBe(true);
    expect(agent).not.toHaveBeenCalled();
  });

  it('a simulation adapter refuses the claim without the Agent', async () => {
    const { send, agent, kept, roles } = await setup();
    expect(await send('sandbox', 'private', `认领 ${CODE}`)).toContain('不接受认领');
    expect(agent).not.toHaveBeenCalled();
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(await kept()).not.toContain(CODE);
  });

  it('logs and publishes the message with the code replaced', async () => {
    const { send, published, logs } = await setup();
    await send('qq', 'private', `认领 ZZZZ9999`);
    expect(JSON.stringify(published)).toContain('认领 ***');
    expect(logs.join('\n')).toContain('认领 ***');
  });

  it('ordinary chat that mentions 认领 still reaches the Agent and is recorded', async () => {
    const { send, agent, kept, claim } = await setup();
    for (const text of ['我想认领这个任务', '认领了吗', 'claim this task please', '请认领 一下']) {
      await send('qq', 'private', text);
    }
    expect(agent).toHaveBeenCalledTimes(4);
    expect(claim.active).toBe(true);
    expect(await kept()).toContain('我想认领这个任务');
  });

  it('after a global owner exists nothing is taken: claim-shaped text reaches the Agent as usual', async () => {
    const { send, agent, roles, claim, kept } = await setup();
    await roles.store.grant({ level: 'global', key: '', adapter: 'tg', userId: 'boss', role: 'owner' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(claim.active).toBe(false);
    await send('qq', 'private', 'claim reward');
    expect(agent).toHaveBeenCalledTimes(1);
    expect(String(agent.mock.calls[0]![0].content)).toBe('claim reward');
    await send('qq', 'group', '认领 任务');
    expect(agent).toHaveBeenCalledTimes(2);
    // The prefixed form is not taken either: it reaches the command dispatcher (here no commands: the Agent).
    await send('qq', 'private', '#认领 xxx');
    expect(agent).toHaveBeenCalledTimes(3);
    // Nothing to redact without an open claim.
    expect(await kept()).toContain('#认领 xxx');
  });

  it('a native platform event carrying the open code is withheld from native Handlers', async () => {
    const { claim } = await setup();
    const guard = createChatOwnerClaimGuard({ claim });
    expect(guard.inspectNative?.({ message: { elements: [{ type: 'text', text: `认领 ${CODE}` }] } })).toBe(true);
    expect(guard.inspectNative?.({ message: { elements: [{ type: 'text', text: 'claim it' }] } })).toBe(false);
    // A join request's comment, full-width and split by a format character.
    expect(guard.inspectNative?.({ type: 'request', comment: '认领 ＡＡＡＡ\u20622222', $approve() {} })).toBe(true);
    await claim.close();
    expect(guard.inspectNative?.({ text: `认领 ${CODE}` })).toBe(false);
  });

  it('reads every string of a native payload: buffers, maps, sets, class objects and neighbouring strings (#1289 review)', () => {
    class NativeMessage { constructor(readonly content: string) {} }
    for (const payload of [
      { raw: new TextEncoder().encode(`{"text":"认领 ${CODE}"}`) },
      { raw: Buffer.from(`claim ${CODE}`).buffer },
      { cache: new Map([['m1', { text: `认领 ${CODE}` }]]) },
      { keys: new Map([[`认领 ${CODE}`, 1]]) },
      { tags: new Set(['a', `claim ${CODE}`]) },
      { message: new NativeMessage(`认领 ${CODE}`) },
      { parts: ['认领 AAAA', '2222'] },
      // Past the old 2000-value bound, and deeper than the old depth 8.
      { items: [...Array.from({ length: 3000 }, (_, index) => `item ${index}`), `认领 ${CODE}`] },
      { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: `认领 ${CODE}` } } } } } } } } } },
      { text: `${'说'.repeat(200_000)} 认领 ${CODE}` },
    ]) expect(inspectNativeClaimPayload(payload, CODE), JSON.stringify(payload, (_k, v) => typeof v === 'string' && v.length > 40 ? `${v.slice(0, 40)}…` : v)).toBe('carried');
    const cyclic: Record<string, unknown> = { text: 'hello' };
    cyclic.self = cyclic;
    for (const payload of [{ text: 'claim it' }, cyclic, { at: 1700000000, ok: true, fn: () => CODE }, null, undefined, 'plain']) {
      expect(inspectNativeClaimPayload(payload, CODE)).toBe('clear');
    }
  });

  it('counts a native payload it cannot read completely as carrying the code (fail closed, #1289 review)', async () => {
    const limits = CHAT_OWNER_CLAIM_NATIVE_LIMITS;
    let deep: Record<string, unknown> = { text: 'hello' };
    for (let level = 0; level < limits.depth + 1; level += 1) deep = { next: deep };
    const throwing = { get text(): string { throw new Error('lazy field'); } };
    Object.defineProperty(throwing, 'text', { enumerable: true });
    for (const payload of [
      deep,
      { items: Array.from({ length: limits.values + 1 }, (_, index) => index) },
      { text: 'x'.repeat(limits.chars + 1) },
      { raw: new Uint8Array(limits.chars + 1) },
      throwing,
    ]) expect(inspectNativeClaimPayload(payload, CODE)).toBe('exceeded');
    // The guard withholds such an event while a claim is open, and only then.
    const { claim } = await setup();
    const guard = createChatOwnerClaimGuard({ claim });
    expect(guard.inspectNative?.(deep)).toBe(true);
    await claim.close();
    expect(guard.inspectNative?.(deep)).toBe(false);
  });
});
