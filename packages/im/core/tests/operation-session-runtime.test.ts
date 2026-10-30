import { EventEmitter } from 'node:events';
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, createEndpointSpecification, endpointSpec,
  endpointEventGatewayToken, type EndpointDesiredSnapshot, type EndpointDesiredRepository, type EndpointSendRequest,
  type PlatformEndpoint } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { MiddlewareIndex, middlewareFeatureId, defineMiddleware } from '@zhin.js/middleware';
import { HandlerIndex, handlerFeatureId } from '@zhin.js/handler';
import { defineHandler } from '../src/feature/handler.js';
import { readOperationSession, type OperationSession } from '@zhin.js/feature-kit';
import { SnapshotStore, createSnapshotView, createCapabilitySlot, rootPluginId, childPluginId,
  type SnapshotState } from '@zhin.js/plugin-runtime';
import { ImRuntime, type Message, type OutboundEnvelope } from '../src/plugin-runtime/im/index.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
class SdkClient extends EventEmitter {
  nativeMethod() { return 'native'; }
}
class NativeEndpoint extends SdkClient implements PlatformEndpoint {
  readonly sent: EndpointSendRequest[] = [];
  readonly stopped = vi.fn();
  readonly setGroupAdmin = vi.fn(async () => undefined);
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop: () => { this.stopped(); },
    management: { setGroupAdmin: () => this.setGroupAdmin() },
    send: async request => { this.sent.push(request); return `sent-${this.sent.length}`; },
  });
}
class NativeAdapter extends Adapter<NativeEndpoint> {
  readonly created: NativeEndpoint[] = [];
  protected createEndpoint() { const endpoint = new NativeEndpoint(); this.created.push(endpoint); return endpoint; }
}
declare module '@zhin.js/feature-kit' { interface AdapterRegistry { native: NativeAdapter; } }

class NativeEvent { readonly buffer = Buffer.from('private'); method() { return 'event'; } }

async function fixture(execute: (session: OperationSession<string>, message: Message, signal: AbortSignal) => Promise<unknown>) {
  const root = rootPluginId(), author = childPluginId(root, 'command-author');
  const im = new ImRuntime({ enrichSender: sender => sender ? { ...sender, roles: ['trusted', ...(sender.roles ?? [])] } : sender });
  const adapter = new NativeAdapter();
  let saved: EndpointDesiredSnapshot | undefined;
  const repository: EndpointDesiredRepository = {
      load: async () => saved,
      compareAndSet: async (_id: unknown, revision: number | null, endpoints: EndpointDesiredSnapshot['endpoints']) => {
        if ((saved?.revision ?? null) !== revision) throw new Error('conflict');
        saved = structuredClone({ revision: (revision ?? 0) + 1, endpoints }); return saved;
      },
  };

  const adapterSlot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'native', source: '/adapters/native/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const command = createCapabilitySlot({ owner: author, feature: commandFeatureId, localName: 'run', source: '/commands/run/index.ts',
    definition: defineCommand<{}, unknown, Message>({ execute: async ({ input, signal }) => execute(readOperationSession(input)!, input!, signal) }) });
  const owners: string[] = [];
  const outbound = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'outbound', source: '/middlewares/outbound/index.ts',
    definition: defineMiddleware<OutboundEnvelope>({ target: 'outbound', handle: async ({ input }, next) => {
      owners.push(input.requester); input.replace(`wrapped:${String(input.payload)}`); await next();
    } }) });
  const handlerReplies: string[] = [];
  const handler = createCapabilitySlot({ owner: author, feature: handlerFeatureId, localName: 'message', source: '/handlers/message/index.ts',
    definition: defineHandler({ adapter: 'native', event: 'message.receive', async handle(event) {
      expect(this.session?.endpoint).toBe(event.client);
      expect(this.session).toBe(readOperationSession(event));
      expect(this.session?.adapter).toBe(adapter);
      handlerReplies.push(this.session!.message.text);
    } }) });
  const slots = [adapterSlot, command, outbound, handler];
  const state: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [author] }],
    [author, { id: author, parent: root, instanceKey: 'command-author', packageName: 'command', packageRoot: '/fixture/command', children: [] }],
  ]), config: new Map([[root, { commandPrefix: '/', endpoints: [{ id: 'one' }, { id: 'two' }] }]]),
  resources: new Map([[root, new Map<string, unknown>([
    [endpointEventGatewayToken.id, im.endpointEvents],
  ])], [author, new Map()]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map() };
  const view = createSnapshotView(0, state);
  const index = await AdapterIndex.create([adapterSlot], view, new AbortController().signal, { repository });
  const store = new SnapshotStore({ ...state, projections: new Map<string, unknown>([
    [adapterFeatureId, index], [commandFeatureId, new CommandIndex([command], view)],
    [middlewareFeatureId, new MiddlewareIndex([outbound], view)], [handlerFeatureId, new HandlerIndex([handler], view)],
  ]) as SnapshotState['projections'] });
  im.attach(store); await index.start(); index.open();
  const rows = adapter.list();
  const endpoint = adapter.getEndpoint(rows[0].instanceId)!;
  const other = adapter.getEndpoint(rows[1].instanceId)!;
  const event = new NativeEvent();
  const input = { conversation: { endpoint: { id: rows[0].canonicalId, adapter: 'native' }, kind: 'group' as const,
    id: 'room', parent: { kind: 'channel' as const, id: 'parent' }, threadId: 'thread' },
  content: '/run', sender: { id: 'alice', name: 'Alice', roles: ['admin'] }, event, platformSentAt: 100 };
  return { adapter, author, rows, endpoint, other, im, index, store, input, event, owners, handlerReplies,
    receive: () => endpoint[endpointSpec].events.message(input),
    close: async () => { await index.stop(); await store.close(); } };
}

it('captures the real Adapter, SDK Endpoint and native event through Command and the unified send chain', async () => {
  let captured: OperationSession<string> | undefined;
  const f = await fixture(async (session, message, signal) => {
    captured = session;
    expect(session).toBe(readOperationSession(message));
    expect(signal).toBe(session.signal);
    expect(session.adapter).toBe(f.adapter);
    expect(session.endpoint).toBe(f.endpoint);
    expect(session.event).toBe(f.event);
    expect(session.sender).toEqual({ id: 'alice', name: 'Alice', platformRoles: ['admin'], authorizationRoles: ['trusted'] });
    expect(session.scene).toMatchObject({ kind: 'group', id: 'room', parent: { id: 'parent' }, threadId: 'thread' });
    expect(session.message).toMatchObject({ text: '/run', platformSentAt: 100, receivedAt: expect.any(Number) });
    await session.reply('answer');
  });
  try {
    await f.receive();
    expect(f.endpoint.sent).toHaveLength(1);
    expect(f.endpoint.sent[0].payload).toBe('wrapped:answer');
    expect(f.owners).toEqual([f.author]);
    expect(f.handlerReplies).toEqual(['/run']);
    expect(f.other.sent).toHaveLength(0);
    expect(f.endpoint.nativeMethod()).toBe('native');
    expect(f.event.method()).toBe('event');
    expect(Object.isFrozen(f.event)).toBe(false);
    await expect(async () => captured!.reply('late')).rejects.toThrow(/scope has ended/);
  } finally { await f.close(); }
});

it.each(['stop', 'update'] as const)('cancels only the captured account during %s without sending to its replacement', async action => {
  const started = deferred(), resume = deferred();
  let captured: OperationSession<string> | undefined;
  const f = await fixture(async session => { captured = session; started.resolve(); await resume.promise;
    expect(session.signal.aborted).toBe(true);
    await expect(async () => session.reply('late')).rejects.toMatchObject({ code: 'endpoint_inactive', disposition: 'not_sent' });
  });
  const running = f.receive();
  try {
    await started.promise;
    const row = f.rows[0];
    const changing = action === 'stop' ? f.adapter.stop(row.instanceId, f.adapter.revision)
      : f.adapter.update(row.instanceId, f.adapter.revision, { config: { id: 'one', changed: true } });
    await vi.waitFor(() => expect(captured!.signal.aborted).toBe(true));
    expect(f.adapter.getEndpoint(f.rows[1].instanceId)).toBe(f.other);
    expect(f.endpoint.stopped).not.toHaveBeenCalled(); // The old operation still holds the child lease.
    resume.resolve(); await running;
    expect((await changing).execution.status).toBe('applied');
    expect(f.endpoint.stopped).toHaveBeenCalledOnce();
    expect(f.endpoint.sent).toHaveLength(0);
    expect(f.other.sent).toHaveLength(0);
    if (action === 'update') {
      const replacement = f.adapter.getEndpoint(row.instanceId)!;
      expect(replacement).not.toBe(f.endpoint);
      expect(replacement.sent).toHaveLength(0);
      await expect(f.im.endpointEvents.receive({ name: 'message.receive', endpoint: { id: row.canonicalId, adapter: 'native' },
        client: f.endpoint, payload: f.input })).rejects.toMatchObject({ code: 'endpoint_inactive' });
    }
  } finally { resume.resolve(); await running; await f.close(); }
});

it('releases the Endpoint operation lease after a throwing command so account stop can drain', async () => {
  const f = await fixture(async () => { throw new Error('command failure'); });
  try {
    await expect(f.receive()).rejects.toThrow('command failure');
    expect((await f.adapter.stop(f.rows[0].instanceId, f.adapter.revision)).execution.status).toBe('applied');
    expect(f.endpoint.stopped).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('does not execute a retained framework management port after the account has stopped', async () => {
  const f = await fixture(async () => undefined);
  const entered = deferred(), resume = deferred();
  const row = f.rows[0];
  const running = f.im.endpoints.withManagement(String(row.canonicalId), String(row.canonicalId), async management => {
    entered.resolve(); await resume.promise;
    await management.setGroupAdmin!('room', 'member', true);
  });
  try {
    await entered.promise;
    await f.adapter.stop(row.instanceId, f.adapter.revision);
    resume.resolve();
    await expect(running).rejects.toMatchObject({ code: 'endpoint_inactive' });
    expect(f.endpoint.setGroupAdmin).not.toHaveBeenCalled();
    expect(f.adapter.getEndpoint(f.rows[1].instanceId)).toBe(f.other);
  } finally { resume.resolve(); await running.catch(() => undefined); await f.close(); }
});

it('expires a framework management port when its Root operation ends even if unrelated HMR retains the same Adapter', async () => {
  const f = await fixture(async () => undefined);
  try {
    const row = f.rows[0];
    const port = await f.im.endpoints.withManagement(String(row.canonicalId), String(row.canonicalId), management => management);
    const { generation, ...snapshot } = f.store.current;
    f.store.commit(generation, { snapshot, dispose: () => undefined });
    expect(f.adapter.getEndpoint(row.instanceId)).toBe(f.endpoint);
    await expect(port!.setGroupAdmin!('room', 'member', true)).rejects.toMatchObject({ code: 'operation_scope_ended', disposition: 'not_sent' });
    expect(f.endpoint.setGroupAdmin).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
