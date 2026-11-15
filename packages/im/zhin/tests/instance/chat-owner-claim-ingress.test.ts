/**
 * zhinjs/zhin#1250 (`claim-hint-omits-command-prefix`, `claim-code-sent-to-llm`): a claim-shaped message
 * is taken at the start of inbound — with or without the command prefix, in private chats and groups,
 * with a correct or a wrong code — and never reaches the Agent, the conversation history, the message
 * event stream, diagnostics, outcomes or the log. Ordinary chat that mentions 认领 still reaches the Agent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec, type Endpoint } from '@zhin.js/adapter';
import { ImRuntime, ingressRouteToken, type IngressRoute } from '@zhin.js/core/runtime';
import { MemoryConversationEventStore } from '@zhin.js/im-contract';
import { addTransport, removeTransport, setLevel, getLogger } from '@zhin.js/logger';
import {
  SnapshotStore, childPluginId, createCapabilitySlot, createSnapshotView, rootPluginId,
  type CapabilityId, type CapabilitySlot, type FeatureId, type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { ChatRoleService, ChatRoleStore, type InstanceChatRoleService } from '../../src/instance/chat-roles.js';
import { ChatOwnerClaim, createChatOwnerClaimGuard, hasGlobalOwner } from '../../src/instance/chat-owner-claim.js';

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

async function setup() {
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
  const im = new ImRuntime({ conversationEvents: events, inboundSecret: createChatOwnerClaimGuard({ claim }) });
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
    resources: new Map([[root, new Map<string, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [ingressRouteToken.id, route]])], [qq, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])], [sandbox, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
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
  const send = async (name: 'qq' | 'sandbox', kind: 'private' | 'group', content: string, sender = 'alice') => {
    const endpoint = endpointOf(name);
    const before = endpoint.sent.length;
    const conversation = { endpoint: { id: name, adapter: name }, kind, id: kind === 'private' ? sender : 'room' };
    await endpoint[endpointSpec].events.message({ conversation, content, endpointId: name === 'qq' ? 'bot' : 'sim', sender: { id: sender }, event: {},
      message: { conversation, id: `m${(sequence += 1)}` } });
    return endpoint.sent.slice(before).map(payload => JSON.stringify(payload)).join('\n');
  };
  /** Everything the runtime kept or emitted about the messages, except replies sent to the platform. */
  const kept = async () => JSON.stringify({
    appended,
    published, logs, diagnostics: im.messageDiagnostics.list(), outcomes: im.messageOutcomes.list(),
  });
  return { im, appended, claim, roles, agent, send, kept, published, logs };
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
    ['without the prefix', 'private', `认领 ZZZZ9999`, '不正确'],
    ['with the prefix', 'private', `#认领 ZZZZ9999`, '不正确'],
    ['without the prefix', 'group', `认领 ZZZZ9999`, '只接受私聊'],
    ['with the prefix', 'group', `#认领 ZZZZ9999`, '只接受私聊'],
  ] as const)('a wrong code %s in a %s chat is answered, not sent to the Agent', async (_label, kind, text, answer) => {
    const { send, agent, kept, roles, claim } = await setup();
    expect(await send('qq', kind, text)).toContain(answer);
    expect(agent).not.toHaveBeenCalled();
    expect(hasGlobalOwner(roles)).toBe(false);
    expect(claim.active).toBe(true);
    expect(await kept()).not.toContain('ZZZZ9999');
  });

  it.each([
    ['without the prefix', `认领 ${CODE}`],
    ['with the prefix', `#认领 ${CODE}`],
  ])('a correct code %s in a group is burnt and kept from the Agent', async (_label, text) => {
    const { send, agent, kept, roles } = await setup();
    expect(await send('qq', 'group', text)).toContain('只接受私聊');
    expect(agent).not.toHaveBeenCalled();
    expect(await kept()).not.toContain(CODE);
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

  it('after a global owner exists, groups chat normally and a private claim is told claims are closed', async () => {
    const { send, agent, roles } = await setup();
    await roles.store.grant({ level: 'global', key: '', adapter: 'tg', userId: 'boss', role: 'owner' });
    await new Promise(resolve => setTimeout(resolve, 0));
    await send('qq', 'group', '认领 任务');
    expect(agent).toHaveBeenCalledTimes(1);
    expect(await send('qq', 'private', `认领 ${CODE}`)).toContain('当前不接受认领');
    expect(agent).toHaveBeenCalledTimes(1);
  });
});
