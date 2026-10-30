// group-suite 欢迎套件（#1012 A9：欢迎验收收拢到同一个 group-suite 套件，去重旧 welcome-scope* 用例）。
// 三层各测一次、不重复：范围解析（纯函数）→ 投递（ImRuntime + handler）→ 原生链路（PluginTestKit / HMR / 回滚，子进程）。
// 会话级欢迎模板（ADR 0037 切片 A，Agent session-ops）的合并窗口 / 限频 / 过闸由 Agent 侧测试负责，这里不复制；
// 这里只测方案②的让路：会话开启 welcome.enabled 时本插件不发，由 MemberLifecycle 发唯一一条（真实 MemberLifecycle 接线）。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { DeliveryTarget } from 'zhin.js';
import { resolveGroupSuiteConfig } from '../src/config.js';
import { normalizeWelcomeConversations, welcomeConversationAllowed } from '../src/welcome-scope.js';
import { AdapterIndex, Endpoint, defineAdapter, adapterFeatureId, endpointEventGatewayToken, type EndpointSendRequest } from '../../../../packages/im/adapter/src/index.js';
import { HandlerIndex, handlerFeatureId } from '../../../../packages/im/handler/src/index.js';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '../../../../packages/im/middleware/src/index.js';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, childPluginId, type SnapshotState } from '../../../../packages/im/plugin-runtime/src/index.js';
import { ImRuntime, memberWelcomeOwnerToken, outboundMessageToken, type IncomingNotice, type OutboundEnvelope } from '../../../../packages/im/core/src/plugin-runtime/im/index.js';
import { EndpointDeliveryError } from '../../../../packages/im/im-contract/src/index.js';
import { AiControlPlane, AiSessionOps, SessionProfileStore, type ControlFlagsPatch } from '../../../../packages/im/agent/src/index.js';
import { MemberLifecycle } from '../../../../basic/cli/src/plugin-runtime/agent/turn/member-lifecycle.js';
import { capabilityLocalName } from '../../../../basic/cli/src/plugin-runtime/agent/turn/request.js';
import welcome from '../handlers/welcome/index.js';

const root: DeliveryTarget = { endpoint: { adapter: 'icqq', id: 'root/qq\0zhin.adapter\0icqq~main' }, kind: 'group', id: 'g1' };
const nested: DeliveryTarget = { ...root, parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' };

describe('group-suite welcome · exact scope', () => {
  it('preserves omitted scope, distinguishes [] and never mutates caller addresses', () => {
    expect(resolveGroupSuiteConfig({})).not.toHaveProperty('welcomeConversations');
    expect(welcomeConversationAllowed(undefined, nested)).toBe(true);
    expect(welcomeConversationAllowed([], root)).toBe(false);
    const input = [{ ...nested, endpoint: { ...nested.endpoint } }];
    const scopes = normalizeWelcomeConversations(input);
    expect(scopes).toEqual(input); expect(Object.isFrozen(scopes[0]?.endpoint)).toBe(true);
    input[0]!.endpoint = { adapter: 'other', id: 'changed' };
    expect(welcomeConversationAllowed(scopes, nested)).toBe(true);
  });

  it.each<DeliveryTarget>([
    { ...nested, endpoint: { ...nested.endpoint, id: `${nested.endpoint.id}-other` } },
    { ...nested, endpoint: { ...nested.endpoint, adapter: 'other' } },
    { ...nested, kind: 'channel' }, { ...nested, id: 'other' },
    { ...nested, parent: { kind: 'group', id: 'parent' } },
    { ...nested, parent: { kind: 'channel', id: 'other' } },
    { ...root, threadId: 'thread' }, { ...root, parent: nested.parent },
    { ...nested, threadId: 'other' }, root,
  ])('does not match a different full identity: %j', target => {
    expect(welcomeConversationAllowed([nested], target)).toBe(false);
  });

  it('matches absent fields only with absence and accepts an exact duplicate list', () => {
    expect(welcomeConversationAllowed([root], root)).toBe(true);
    expect(welcomeConversationAllowed([root], nested)).toBe(false);
    expect(welcomeConversationAllowed([nested, nested], nested)).toBe(true);
    expect(welcomeConversationAllowed([root, nested], nested)).toBe(true);
    expect(welcomeConversationAllowed([{ ...root, id: '*' }], root)).toBe(false);
    expect(welcomeConversationAllowed([{ ...root, threadId: '*' }], { ...root, threadId: 'topic' })).toBe(false);
  });

  it.each<unknown>([
    null, {}, 'g1', Array.from({ length: 101 }, () => root),
    [{ ...root, kind: 'private' }], [{ ...root, kind: 'channel' }],
    [{ ...root, id: '' }], [{ ...root, endpoint: { adapter: '', id: 'x' } }],
    [{ ...root, endpoint: { adapter: 'icqq', id: '' } }],
    [{ ...root, parent: null }], [{ ...root, parent: { kind: 'group' } }],
    [{ ...root, threadId: null }], [{ ...root, threadId: '' }],
  ])('refuses invalid startup addresses: %j', value => {
    expect(() => normalizeWelcomeConversations(value)).toThrow();
  });
});

/** Session-level welcome wiring as in the Agent host: MemberLifecycle on im.sceneEvents + memberWelcomeOwnerToken. */
interface SessionWelcomeOptions {
  readonly enabled: boolean;
  readonly flags?: ControlFlagsPatch;
}

async function fixture(session?: SessionWelcomeOptions) {
  const root = rootPluginId();
  const first = childPluginId(root, 'account-one'); const second = childPluginId(root, 'account-two');
  const alpha = childPluginId(root, 'alpha'); const beta = childPluginId(root, 'beta');
  const im = new ImRuntime(); const sent: EndpointSendRequest[] = []; const requesters: string[] = [];
  let failure: 'unknown' | 'not_sent' | undefined;
  class MemoryEndpoint extends Endpoint<object> {
    readonly client = {};
    start() {} stop() {} open() {} close() {}
    async send(request: EndpointSendRequest) {
      sent.push(request);
      if (failure) throw new EndpointDeliveryError('synthetic_delivery_failure', 'synthetic delivery failure', failure);
      return `message-${sent.length}`;
    }
  }
  const adapters = ([[first, 'memory'], [second, 'memory'], [first, 'another']] as const).map(([owner, localName]) => createCapabilitySlot({
    owner, feature: adapterFeatureId, localName, source: `/adapters/${localName}/index.ts`,
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], segments: { markdown: 'text', interactive: 'text' }, create: () => new MemoryEndpoint() }),
  }));
  const handlers = [alpha, beta].map(owner => createCapabilitySlot({ owner, feature: handlerFeatureId, localName: 'welcome',
    source: '/handlers/welcome/index.ts', definition: welcome }));
  const observer = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'observe', source: '/middlewares/observe/index.ts',
    definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound', async handle({ input }, next) { requesters.push(input.requester); await next(); } }) });
  const ids = [root, first, second, alpha, beta];
  const state: SnapshotState = { root,
    tree: new Map(ids.map(id => [id, { id, ...(id === root ? {} : { parent: root }), instanceKey: id.split('/').at(-1)!,
      packageName: '@test/welcome-scope', packageRoot: '/project', children: id === root ? ids.slice(1) : [] }])),
    config: new Map(ids.map(id => [id, id === alpha ? { welcomeMessage: '欢迎 {name} ({id})', welcomeConversations: [] }
      : id === beta ? { welcomeMessage: 'not enabled', welcomeConversations: [] } : {}])),
    capabilities: new Map([...adapters, ...handlers, observer].map(slot => [slot.id, slot])), projections: new Map(),
    resources: new Map(ids.map(id => [id, new Map<string, unknown>([[endpointEventGatewayToken.id, { receive: async () => undefined }], [outboundMessageToken.id, im]])])),
  };
  const lifecycle = session ? await sessionWelcome(im, String(adapters[0]!.id), session) : undefined;
  if (lifecycle) {
    const owner = Object.freeze({ ownsWelcome: lifecycle.ownsWelcome.bind(lifecycle) });
    for (const resources of state.resources.values()) (resources as Map<string, unknown>).set(memberWelcomeOwnerToken.id, owner);
  }
  const view = createSnapshotView(0, state);
  const index = await AdapterIndex.create(adapters, view, new AbortController().signal);
  const store = new SnapshotStore({ ...state, projections: new Map([
    [adapterFeatureId, index], [handlerFeatureId, new HandlerIndex(handlers, view)], [middlewareFeatureId, new MiddlewareIndex([observer], view)],
  ]) });
  im.attach(store); await index.start(); index.open();
  const target: DeliveryTarget = { endpoint: im.endpoints.list().find(item => item.id === String(adapters[0]!.id))!.endpoint,
    kind: 'group', id: 'same-group', parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' };
  const config = new Map(store.current.config);
  config.set(alpha, { welcomeMessage: '欢迎 {name} ({id})', welcomeConversations: [target, target] });
  store.commit(0, { snapshot: createSnapshotView(1, { ...store.current, config }), dispose() {} });
  const notice: IncomingNotice = { id: 'joined', type: 'notice', name: 'notice.group.member_increase', timestamp: 1, metadata: {},
    conversation: { kind: target.kind, id: target.id, parent: target.parent, threadId: target.threadId }, target: { id: 'new', name: 'Bob' } };
  const receive = (payload = notice, endpointId = String(adapters[0]!.id)) => {
    const row = im.endpoints.list().find(item => item.id === endpointId)!;
    return im.endpointEvents.receive({ name: 'notice.receive', endpoint: row.endpoint, payload,
      client: index.clientById(row.id as typeof adapters[number]['id']) });
  };
  return { target, alpha, root, sent, requesters, adapters, notice, receive, lifecycle,
    fail: (status: typeof failure) => { failure = status; },
    close: async () => { lifecycle?.dispose(); await store.close(); await index.stop(); },
  };
}

async function sessionWelcome(im: ImRuntime, endpointId: string, options: SessionWelcomeOptions): Promise<MemberLifecycle> {
  const platform = capabilityLocalName(endpointId);
  const ops = new AiSessionOps();
  await ops.set({ expectedRevision: 0, actorId: 'console',
    sessions: [{ platform, sceneId: 'group:same-group', welcome: { enabled: options.enabled, mergeWindowMs: 0, template: '会话欢迎 {members}' } }] });
  const plane = new AiControlPlane();
  if (options.flags) await plane.set({ expectedRevision: 0, actorId: 'op', sessions: [{ platform, sceneId: 'group:same-group', flags: options.flags }] });
  const sessions = new SessionProfileStore();
  const lifecycle = new MemberLifecycle({
    sessionOps: () => ops,
    controlPlane: () => plane,
    sessions: () => sessions,
    reader: () => im.conversationEventReader,
    send: async (conversation, parts) => {
      const content = parts.map(part => (part.type === 'text'
        ? { type: 'text', data: { text: part.text } }
        : { type: 'mention', data: { target: part.id } }));
      const receipt = await im.send({ conversation, requester: rootPluginId(), content });
      return receipt.status === 'sent' ? { status: 'sent', messageId: 'welcome' } : { status: 'failed', code: receipt.status, retryable: false };
    },
  });
  im.sceneEvents.subscribe(signal => { lifecycle.handle(signal); });
  return lifecycle;
}

/** Template welcome flushes asynchronously after the scene event; wait for its verdict (or none when disabled). */
async function settled(lifecycle: MemberLifecycle | undefined): Promise<void> {
  for (let i = 0; i < 50 && lifecycle && !lifecycle.lastResult; i++) await new Promise(resolve => setTimeout(resolve, 5));
}

describe('group-suite welcome · delivery', () => {
  it('A9 · sends exactly one welcome per member_increase, to the original target, under the configured instance owner', async () => {
    const f = await fixture();
    try {
      await f.receive();
      expect(f.sent).toHaveLength(1); // Duplicate entries still produce only one send; beta is independently disabled.
      expect(f.sent[0]!.conversation).toEqual(f.target); expect(f.requesters).toEqual([f.alpha]);
      expect(f.sent[0]!.payload).toEqual([{ type: 'text', data: { text: '欢迎 Bob (new)' } }]);
      for (const adapter of f.adapters.slice(1)) await f.receive(f.notice, String(adapter.id));
      const conversation = f.notice.conversation!;
      for (const changed of [
        { ...conversation, id: 'other' }, { ...conversation, parent: undefined },
        { ...conversation, parent: { kind: 'group' as const, id: 'parent' } },
        { ...conversation, parent: { kind: 'channel' as const, id: 'other' } },
        { ...conversation, threadId: undefined }, { ...conversation, threadId: 'other' },
        { ...conversation, kind: 'private' as const }, { ...conversation, kind: 'channel' as const },
      ]) await f.receive({ ...f.notice, conversation: changed });
      await f.receive({ ...f.notice, conversation: undefined }); await f.receive({ ...f.notice, target: undefined });
      expect(f.sent).toHaveLength(1);
    } finally { await f.close(); }
  });


  it('A9 · member_decrease never sends a group-suite message (leave stays silent)', async () => {
    const f = await fixture();
    try {
      await f.receive({ ...f.notice, id: 'left', name: 'notice.group.member_decrease' });
      expect(f.sent).toHaveLength(0); expect(f.requesters).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(['unknown', 'not_sent'] as const)('reports %s delivery once without retrying or changing the target', async status => {
    const f = await fixture();
    try {
      f.fail(status); await expect(f.receive()).rejects.toThrow('Group welcome delivery');
      expect(f.sent).toHaveLength(1); expect(f.sent[0]!.conversation).toEqual(f.target); expect(f.requesters).toEqual([f.alpha]);
    } finally { await f.close(); }
  });
});

describe('group-suite welcome · A9 option 2 redirect to the session welcome', () => {
  it('session welcome.enabled + welcomeMessage: exactly one welcome, sent by MemberLifecycle, group-suite stays silent', async () => {
    const f = await fixture({ enabled: true });
    try {
      await f.receive();
      await settled(f.lifecycle);
      expect(f.lifecycle!.lastResult).toEqual({ kind: 'sent', members: 1 });
      expect(f.sent).toHaveLength(1);
      expect(f.requesters).toEqual([f.root]);
      expect(f.sent[0]!.payload[0]).toEqual({ type: 'text', data: { text: '会话欢迎 ' } });
    } finally { await f.close(); }
  });

  it('session welcome disabled: group-suite keeps sending its own single welcome', async () => {
    const f = await fixture({ enabled: false });
    try {
      await f.receive();
      await settled(f.lifecycle);
      expect(f.lifecycle!.lastResult).toBeUndefined();
      expect(f.sent).toHaveLength(1);
      expect(f.requesters).toEqual([f.alpha]);
      expect(f.sent[0]!.payload).toEqual([{ type: 'text', data: { text: '欢迎 Bob (new)' } }]);
    } finally { await f.close(); }
  });

  it('mention_only does not block the redirected welcome (#1022 / #1023)', async () => {
    const f = await fixture({ enabled: true, flags: { mention_only: true } });
    try {
      await f.receive();
      await settled(f.lifecycle);
      expect(f.lifecycle!.lastResult).toEqual({ kind: 'sent', members: 1 });
      expect(f.sent).toHaveLength(1);
      expect(f.requesters).toEqual([f.root]);
    } finally { await f.close(); }
  });

  it('muted still blocks the session welcome and group-suite does not fall back to sending', async () => {
    const f = await fixture({ enabled: true, flags: { muted: true } });
    try {
      await f.receive();
      await settled(f.lifecycle);
      expect(f.lifecycle!.lastResult).toEqual({ kind: 'skipped', reason: 'control:muted' });
      expect(f.sent).toHaveLength(0);
    } finally { await f.close(); }
  });

  it('member_decrease still sends nothing from either path when the session welcome owns the group', async () => {
    const f = await fixture({ enabled: true });
    try {
      await f.receive({ ...f.notice, id: 'left', name: 'notice.group.member_decrease' });
      await settled(f.lifecycle);
      expect(f.sent).toHaveLength(0);
      expect(f.requesters).toEqual([]);
    } finally { await f.close(); }
  });
});

describe('group-suite welcome · native PluginTestKit loop', () => {
  it('validates welcome scope and isolated instances through native PluginTestKit, HMR and config rollback', async () => {
    const script = fileURLToPath(new URL('./welcome-native.mjs', import.meta.url));
    const result = await promisify(execFile)(process.execPath, ['--conditions=development', '--import', 'tsx', script], { timeout: 30000 });
    expect(result.stdout).toContain('WELCOME_SCOPE_NATIVE_OK');
  }, 35000);
});
