// zhinjs/zhin#1250: `${prefix}` / `${menu}` / `${command.*}` in outbound templates are rendered for the
// account that sends the message, with the same prefix resolver as inbound command dispatch.
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, createEndpointSpecification, endpointSpec,
  endpointEventGatewayToken, type EndpointDesiredSnapshot, type EndpointDesiredRepository, type EndpointSendRequest,
  type Endpoint as EndpointContract } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { SnapshotStore, createSnapshotView, createCapabilitySlot, rootPluginId, childPluginId,
  type SnapshotState, type PluginId } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { ImRuntime, installComponentHost } from '../../src/plugin-runtime/im/index.js';
import { MessageDispatcher } from '../../src/plugin-runtime/im/message-dispatcher.js';
import * as environment from '../../src/plugin-runtime/im/outbound-command-environment.js';

class MemoryEndpoint implements EndpointContract {
  readonly sent: EndpointSendRequest[] = [];
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {},
    send: async (request: EndpointSendRequest) => { this.sent.push(request); return `sent-${this.sent.length}`; },
  });
}
class MemoryAdapter extends Adapter<MemoryEndpoint> {
  protected createEndpoint() { return new MemoryEndpoint(); }
}
declare module '@zhin.js/feature-kit' { interface AdapterRegistry { memory: MemoryAdapter } }

interface FixtureOptions {
  readonly prefixes?: readonly (string | undefined)[];
  readonly rootConfig?: Record<string, unknown>;
  readonly imCommandPrefix?: string;
}

async function fixture(options: FixtureOptions = {}) {
  const root = rootPluginId();
  const author = childPluginId(root, 'author');
  const other = childPluginId(root, 'other');
  const im = new ImRuntime(options.imCommandPrefix === undefined ? {} : { commandPrefix: options.imCommandPrefix });
  const adapter = new MemoryAdapter();
  let saved: EndpointDesiredSnapshot | undefined;
  const repository: EndpointDesiredRepository = {
    load: async () => saved,
    compareAndSet: async (_id: unknown, revision: number | null, endpoints: EndpointDesiredSnapshot['endpoints']) => {
      saved = structuredClone({ revision: (revision ?? 0) + 1, endpoints }); return saved;
    },
  };
  const prefixes = options.prefixes ?? ['#', '/'];
  const adapterSlot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'memory', source: '/adapters/memory/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const command = (owner: PluginId, localName: string) => createCapabilitySlot({ owner, feature: commandFeatureId, localName,
    source: `/commands/${localName}/index.ts`, definition: defineCommand({ execute: async () => 'ok' }) });
  const commands = [
    command(author, 'checkin'), command(author, 'group/kick'), command(author, 'keyword-add'),
    command(author, 'stats-rank'), command(other, 'secret'),
  ];
  const ids = [root, author, other];
  const state: SnapshotState = { root, tree: new Map(ids.map(id => [id, { id, ...(id === root ? {} : { parent: root }),
    instanceKey: id === root ? 'root' : id.split('/').at(-1)!, packageName: 'fixture', packageRoot: '/fixture',
    children: id === root ? [author, other] : [] }])),
  config: new Map<PluginId, unknown>([[root, { ...options.rootConfig,
    endpoints: prefixes.map((prefix, index) => ({ id: `account-${index}`, ...(prefix === undefined ? {} : { commandPrefix: prefix }) })) }]]),
  resources: new Map(ids.map(id => [id, new Map<string, unknown>(id === root ? [[endpointEventGatewayToken.id, im.endpointEvents]] : [])])),
  capabilities: new Map([adapterSlot, ...commands].map(slot => [slot.id, slot])), projections: new Map() };
  const view = createSnapshotView(0, state);
  const index = await AdapterIndex.create([adapterSlot], view, new AbortController().signal, { repository });
  const rootConfig = options.rootConfig ?? {};
  const menu = rootConfig.menuKeyword === false ? undefined
    : typeof rootConfig.menuKeyword === 'string' ? { keyword: rootConfig.menuKeyword } : {};
  // Root resources as the instance installs them: the IM gateway resources plus the Component Host.
  const resources = new Map(state.resources);
  const rootResources = new Map(state.resources.get(root)!);
  const scope = { provide: (token: { id: string }, value: unknown) => { rootResources.set(token.id, value); } };
  im.install(scope as never);
  installComponentHost()({ resources: scope } as never);
  resources.set(root, rootResources);
  const store = new SnapshotStore({ ...state, resources, projections: new Map<string, unknown>([
    [adapterFeatureId, index], [commandFeatureId, new CommandIndex(commands, view, menu)],
  ]) as SnapshotState['projections'] });
  im.attach(store); await index.start(); index.open();
  const rows = adapter.list();
  const conversationOf = (account: number): ConversationRef => ({ endpoint: { id: rows[account]!.canonicalId, adapter: 'memory' }, kind: 'group', id: 'room' });
  const send = async (account: number, text: string, extra: Partial<Parameters<ImRuntime['send']>[0]> = {}) => {
    const endpoint = adapter.getEndpoint(rows[account]!.instanceId)!;
    const before = endpoint.sent.length;
    const receipt = await im.send({ conversation: conversationOf(account), requester: author, content: text, ...extra });
    expect(receipt.status).toBe('sent');
    expect(endpoint.sent).toHaveLength(before + 1);
    const payload = endpoint.sent.at(-1)!.payload;
    return (Array.isArray(payload) ? payload : [payload]).map(item => typeof item === 'string' ? item : (item as { data: { text: string } }).data.text).join('');
  };
  return { im, author, store, send, conversationOf, close: async () => { await index.stop(); await store.close(); } };
}

describe('outbound templates · command environment of the sending account (#1250)', () => {
  it('renders the same template differently for two accounts with different prefixes', async () => {
    const f = await fixture();
    try {
      const template = '发送 ${menu} 查看，${command.checkin} 签到；前缀=[${prefix}]';
      expect(await f.send(0, template)).toBe('发送 #菜单 查看，#checkin 签到；前缀=[#]');
      expect(await f.send(1, template)).toBe('发送 /菜单 查看，/checkin 签到；前缀=[/]');
    } finally { await f.close(); }
  });

  it('an account without a prefix renders bare commands and an empty prefix', async () => {
    const f = await fixture({ prefixes: [undefined] });
    try {
      expect(await f.send(0, '[${prefix}] ${menu} ${command.checkin}')).toBe('[] 菜单 checkin');
    } finally { await f.close(); }
  });

  it('follows the ImRuntime prefix resolver, not the adapter configuration', async () => {
    const f = await fixture({ imCommandPrefix: '!' });
    try {
      expect(await f.send(0, '${menu} ${command.checkin}')).toBe('!菜单 !checkin');
      expect(await f.send(1, '${menu} ${command.checkin}')).toBe('!菜单 !checkin');
    } finally { await f.close(); }
  });

  it('uses a custom menu keyword and leaves ${menu} as written when the menu is off', async () => {
    const custom = await fixture({ rootConfig: { menuKeyword: '功能表' } });
    try {
      expect(await custom.send(0, '${menu}')).toBe('#功能表');
    } finally { await custom.close(); }
    const off = await fixture({ rootConfig: { menuKeyword: false } });
    try {
      expect(await off.send(0, '${menu} ${prefix}')).toBe('${menu} #');
    } finally { await off.close(); }
  });

  it('lists only the requester\'s commands: nested, dashed and missing paths', async () => {
    const f = await fixture();
    try {
      expect(await f.send(0, '${command.group.kick}|${command.keyword_add}|${command.stats_rank}')).toBe('#group kick|#keyword-add|#stats-rank');
      // Unknown paths, other plugins' commands, the object itself and PATH-incompatible keys stay as written.
      expect(await f.send(0, '${command.nope}|${command.secret}|${command}|${command.group}|${command.keyword-add}'))
        .toBe('${command.nope}|${command.secret}|${command}|${command.group}|${command.keyword-add}');
    } finally { await f.close(); }
  });

  it('builds command data without functions or accessors', async () => {
    const f = await fixture();
    try {
      const snapshot = f.store.current;
      const paths = environment.templateCommandPaths(snapshot, { conversation: f.conversationOf(0), locale: 'zh-CN' }, f.author, '#')!;
      const visit = (node: object): void => {
        expect(Object.isFrozen(node)).toBe(true);
        expect(Object.getPrototypeOf(Object.getPrototypeOf(node))).toBeNull();
        for (const key of Reflect.ownKeys(node)) {
          const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
          expect('value' in descriptor).toBe(true);
          expect(typeof descriptor.value).not.toBe('function');
          if (typeof descriptor.value === 'object') visit(descriptor.value as object);
        }
      };
      visit(paths);
      expect(Object.keys(paths).sort()).toEqual(['checkin', 'group', 'keyword_add', 'stats_rank']);
    } finally { await f.close(); }
  });

  it('a subject passed as incoming.sender is data: its nickname is never expanded', async () => {
    const f = await fixture();
    try {
      const incoming = { sender: { id: 'u-1', name: '${menu}{name}' }, content: '', timestamp: 1 };
      expect(await f.send(0, '欢迎 ${sender.name}（${sender.id}），发送 ${menu}', { incoming }))
        .toBe('欢迎 ${menu}{name}（u-1），发送 #菜单');
    } finally { await f.close(); }
  });

  it('computes nothing for text without a placeholder', async () => {
    const f = await fixture();
    const resolve = vi.spyOn(MessageDispatcher.prototype, 'commandEnvironment');
    try {
      expect(await f.send(0, '纯文本，没有占位符')).toBe('纯文本，没有占位符');
      expect(await f.send(0, { type: 'text', data: { text: 'segment text' } } as never)).toBe('segment text');
      expect(resolve).not.toHaveBeenCalled();
      expect(await f.send(0, '${menu}')).toBe('#菜单');
      expect(resolve).toHaveBeenCalledTimes(1);
      // Several texts of one send share one computation.
      expect(await f.send(0, ['${command.checkin}', ' ', '${command.group.kick}'] as never)).toBe('#checkin #group kick');
      expect(resolve).toHaveBeenCalledTimes(2);
    } finally {
      resolve.mockRestore();
      await f.close();
    }
  });

});
