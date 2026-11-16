/**
 * Issue #1250 (`command-dispatch-from-middleware-author-binding`): a plugin middleware turning a
 * button callback into a command with `context.project<CommandIndex>(commandFeatureId).dispatch(…)`
 * used to throw `Message author binding belongs to another generation operation`, because the
 * projection was built against a projection-time snapshot view, not the committed snapshot the
 * message's operation runs on. These tests use the production shape (projections built on a view,
 * committed through a SnapshotStore) and also pin the author-binding guarantees.
 */
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, createEndpointSpecification, endpointSpec,
  endpointEventGatewayToken, type EndpointSendRequest, type Endpoint as EndpointContract } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand, type CommandDispatchResult } from '@zhin.js/command';
import { MiddlewareIndex, middlewareFeatureId, defineMiddleware } from '@zhin.js/middleware';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { SnapshotStore, createSnapshotView, createCapabilitySlot, rootPluginId, childPluginId,
  featureConversationOverridesToken, primaryConfigToken,
  type PrimaryConfig, type RuntimeSnapshot, type SnapshotState } from '@zhin.js/plugin-runtime';
import { ImRuntime, type Message, type OutboundEnvelope } from '../../src/plugin-runtime/im/index.js';

class TestEndpoint implements EndpointContract {
  readonly sent: EndpointSendRequest[] = [];
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {},
    send: async (request: EndpointSendRequest) => { this.sent.push(request); return `sent-${this.sent.length}`; },
  });
}
class TestAdapter extends Adapter<TestEndpoint> {
  protected createEndpoint() { return new TestEndpoint(); }
}
declare module '@zhin.js/feature-kit' { interface AdapterRegistry { 'dispatch-test': TestAdapter; } }

type DispatchCall = (index: CommandIndex, input: Message) => Promise<CommandDispatchResult>;

/** ADR 0057 §2 stored switches, keyed `<plugin>|<resolution key>` (e.g. `command-author|root/one`). */
type StoredSwitches = Readonly<Record<string, { enabled: false }>>;

async function fixture(call: DispatchCall, stored: StoredSwitches = {}) {
  const root = rootPluginId();
  const author = childPluginId(root, 'command-author');
  const buttons = childPluginId(root, 'buttons');
  const im = new ImRuntime({ enrichSender: sender => sender ? { ...sender, platform: { standing: 'admin' as const } } : sender });
  const adapter = new TestAdapter();
  const seen: { sender?: unknown; requester?: unknown }[] = [];
  const results: CommandDispatchResult[] = [];
  const errors: unknown[] = [];
  const outboundRequesters: string[] = [];
  const inputs: Message[] = [];

  const adapterSlot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'dispatch-test', source: '/adapters/dispatch-test/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const vote = createCapabilitySlot({ owner: author, feature: commandFeatureId, localName: 'vote', source: '/commands/vote/index.ts',
    definition: defineCommand<{}, unknown, Message>({ permit: ['platform:admin'], execute: async ({ input }) => {
      seen.push({ sender: input?.sender });
      await input!.$reply('voted');
      return undefined;
    } }) });
  const secret = createCapabilitySlot({ owner: author, feature: commandFeatureId, localName: 'secret', source: '/commands/secret/index.ts',
    definition: defineCommand<{}, unknown, Message>({ permit: ['user(bob)'], execute: async () => 'leaked' }) });
  const inbound = createCapabilitySlot({ owner: buttons, feature: middlewareFeatureId, localName: 'buttons', source: '/middlewares/buttons/index.ts',
    definition: defineMiddleware<Message>({ async handle(context, next) {
      if (!context.input.content.startsWith('btn:')) return next();
      inputs.push(context.input);
      try {
        results.push(await call(context.project<CommandIndex>(commandFeatureId), context.input));
      } catch (error) { errors.push(error); }
      return undefined;
    } }) });
  const outbound = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'outbound', source: '/middlewares/outbound/index.ts',
    definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound', handle: async ({ input }, next) => {
      outboundRequesters.push(input.requester); await next();
    } }) });
  const commands = [vote, secret];
  const middlewares = [inbound, outbound];
  const slots = [adapterSlot, ...commands, ...middlewares];
  const document = { configVersion: 2, plugins: { 'command-author': 'command', buttons: 'buttons' } };
  const primary: PrimaryConfig = { document, expanded: document, get: () => undefined };
  const switches = Object.keys(stored).length > 0 ? [[featureConversationOverridesToken.id, { version: 1, get: (plugin: string, key: string) =>
    stored[`${plugin}|${key}`] ? { enabled: false as const, patch: {}, revision: 1, updatedAt: 1 } : undefined }] as const] : [];
  const state: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [author, buttons] }],
    [author, { id: author, parent: root, instanceKey: 'command-author', packageName: 'command', packageRoot: '/fixture/command', children: [] }],
    [buttons, { id: buttons, parent: root, instanceKey: 'buttons', packageName: 'buttons', packageRoot: '/fixture/buttons', children: [] }],
  ]), config: new Map([[root, { commandPrefix: '/', endpoints: [{ id: 'one' }] }]]),
  resources: new Map([[root, new Map<string, unknown>([
    [endpointEventGatewayToken.id, im.endpointEvents], [permissionHostToken.id, new PermissionHost()],
    [primaryConfigToken.id, primary], ...switches,
  ])], [author, new Map()], [buttons, new Map()]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map() };
  // Production shape: projections see a projection-time view, not the snapshot committed below.
  const view = createSnapshotView(0, state);
  const index = await AdapterIndex.create([adapterSlot], view, new AbortController().signal);
  const commandIndex = new CommandIndex(commands, view);
  const store = new SnapshotStore({ ...state, projections: new Map<string, unknown>([
    [adapterFeatureId, index], [commandFeatureId, commandIndex], [middlewareFeatureId, new MiddlewareIndex(middlewares, view)],
  ]) as SnapshotState['projections'] });
  im.attach(store); await index.start(); index.open();
  const row = adapter.list()[0]!;
  const endpoint = adapter.getEndpoint(row.instanceId)!;
  const receive = (content: string, sender = { id: 'alice', name: 'Alice' }) => endpoint[endpointSpec].events.message({
    conversation: { endpoint: { id: row.canonicalId, adapter: 'dispatch-test' }, kind: 'group' as const, id: 'room' },
    content, sender, platformSentAt: 100,
  });
  return { author, buttons, view, commandIndex, endpoint, seen, results, errors, outboundRequesters, inputs, receive, store,
    close: async () => { await index.stop(); await store.close(); } };
}

describe('CommandIndex.dispatch from a plugin middleware (issue #1250)', () => {
  it('runs the command as the clicking message\'s real author through the send chain', async () => {
    const f = await fixture((commands, input) => commands.dispatch({ input: 'vote', source: input }));
    try {
      expect(f.store.current).not.toBe(f.view); // the bug's precondition: two different snapshot objects
      await f.receive('btn:vote:1');
      expect(f.errors).toEqual([]);
      expect(f.results).toEqual([expect.objectContaining({ matched: true, status: 'executed', command: 'vote', owner: f.author })]);
      // The command saw the actual sender (with Core's enrichment), not anything the middleware supplied.
      expect(f.seen).toEqual([{ sender: expect.objectContaining({ id: 'alice', name: 'Alice' }) }]);
      // Its reply is authored by the command's owner and goes through the outbound chain.
      expect(f.outboundRequesters).toEqual([f.author]);
      expect(f.endpoint.sent.map(request => request.payload)).toEqual(['voted']);
    } finally { await f.close(); }
  });

  it('still checks the command permit against the real sender', async () => {
    const f = await fixture((commands, input) => commands.dispatch({ input: 'secret', source: input }));
    try {
      await f.receive('btn:secret');
      expect(f.errors).toEqual([]);
      expect(f.results).toEqual([expect.objectContaining({ matched: true, status: 'denied', command: 'secret' })]);
      expect(f.endpoint.sent).toEqual([]);
    } finally { await f.close(); }
  });

  it('keeps refusing a snapshot that is not the message operation\'s own, with an actionable error', async () => {
    const f = await fixture((commands, input) => commands.dispatch({ input: 'vote', source: input, snapshot: f.view as RuntimeSnapshot }));
    try {
      await f.receive('btn:vote:1');
      expect(f.results).toEqual([]);
      expect(f.seen).toEqual([]);
      expect(String(f.errors[0])).toMatch(/Message author binding belongs to another generation operation/);
      expect(String(f.errors[0])).toMatch(/context\.project\(\)/);
      expect(f.endpoint.sent).toEqual([]);
    } finally { await f.close(); }
  });

  it('refuses a CommandIndex that is not the projection of the message\'s generation', async () => {
    // A projection kept from elsewhere (e.g. an earlier generation) must not act for this message.
    const stale = new CommandIndex([], createSnapshotView(0, { ...(await fixtureState()) }));
    const f = await fixture((_commands, input) => stale.dispatch({ input: 'vote', source: input }));
    try {
      await f.receive('btn:vote:1');
      expect(f.results).toEqual([]);
      expect(String(f.errors[0])).toMatch(/not the command projection of the message's generation/);
      expect(String(f.errors[0])).toMatch(/context\.project\(commandFeatureId\)/);
    } finally { await f.close(); }
  });

  it('does not run a command of a Plugin switched off for this endpoint (ADR 0050 gate)', async () => {
    // The command author is off on this endpoint: Core's own dispatcher does not see its commands,
    // and a middleware dispatching through the raw projection must not reach them either.
    const f = await fixture((commands, input) => commands.dispatch({ input: 'vote', source: input }), { 'command-author|root/one': { enabled: false } });
    try {
      await f.receive('/vote');
      expect(f.seen).toEqual([]);
      await f.receive('btn:vote:1');
      expect(f.errors).toEqual([]);
      expect(f.results).toEqual([expect.objectContaining({ matched: false, status: 'unmatched' })]);
      expect(f.seen).toEqual([]);
      expect(f.endpoint.sent).toEqual([]);
    } finally { await f.close(); }
  });

  it('fails closed when a retained message dispatches after its turn has ended', async () => {
    const f = await fixture(async () => Object.freeze({ matched: false, status: 'unmatched' }) as CommandDispatchResult);
    try {
      await f.receive('btn:vote:1');
      const retained = f.inputs[0]!;
      await expect(f.commandIndex.dispatch({ input: 'vote', source: retained })).rejects.toThrow(/scope has ended/);
      expect(f.seen).toEqual([]);
      expect(f.endpoint.sent).toEqual([]);
    } finally { await f.close(); }
  });
});

async function fixtureState(): Promise<SnapshotState> {
  const root = rootPluginId();
  return { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'stale', packageRoot: '/stale', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]), capabilities: new Map(), projections: new Map() };
}
