import { EventEmitter } from 'node:events';
import { Adapter, AdapterIndex, adapterFeatureId, defineAdapter, createEndpointSpecification, endpointSpec,
  endpointEventGatewayToken, type EndpointDesiredSnapshot, type EndpointDesiredRepository, type EndpointSendRequest, type EndpointControl, type EndpointManagement,
  type Endpoint as EndpointContract } from '@zhin.js/adapter';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import { MiddlewareIndex, middlewareFeatureId, defineMiddleware } from '@zhin.js/middleware';
import { HandlerIndex, handlerFeatureId, defineHandler as defineLifecycleHandler, type HandlerDefinition } from '@zhin.js/handler';
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
class NativeEndpoint extends SdkClient implements EndpointContract {
  readonly sent: EndpointSendRequest[] = [];
  readonly stopped = vi.fn();
  readonly sendNative = vi.fn(async (request: EndpointSendRequest) => { this.sent.push(request); return `sent-${this.sent.length}`; });
  readonly recall = vi.fn<NonNullable<EndpointControl['recall']>>(async () => undefined);
  readonly setGroupAdmin = vi.fn(async () => undefined);
  readonly inspectGroupMember = vi.fn<NonNullable<EndpointManagement['inspectGroupMember']>>(async () => ({ canModerate: false }));
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop: () => { this.stopped(); },
    control: { recall: request => this.recall(request) },
    management: { setGroupAdmin: () => this.setGroupAdmin(),
      inspectGroupMember: request => this.inspectGroupMember(request) },
    send: request => this.sendNative(request),
  });
}
class NativeAdapter extends Adapter<NativeEndpoint> {
  readonly created: NativeEndpoint[] = [];
  protected createEndpoint() { const endpoint = new NativeEndpoint(); this.created.push(endpoint); return endpoint; }
}
declare module '@zhin.js/feature-kit' { interface AdapterRegistry { native: NativeAdapter; } }

class NativeEvent { readonly buffer = Buffer.from('private'); method() { return 'event'; } }

async function fixture(execute: (session: OperationSession<string>, message: Message, signal: AbortSignal) => Promise<unknown>, sideHandler?: HandlerDefinition) {
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
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], operations: ['recall'], createAdapter: () => adapter }) });
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
  const side = sideHandler ? createCapabilitySlot({ owner: author, feature: handlerFeatureId, localName: 'side', source: '/handlers/side/index.ts', definition: sideHandler }) : undefined;
  const handlerSlots = side ? [handler, side] : [handler];
  const slots = [adapterSlot, command, outbound, ...handlerSlots];
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
    [middlewareFeatureId, new MiddlewareIndex([outbound], view)], [handlerFeatureId, new HandlerIndex(handlerSlots, view)],
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
    await management.setGroupAdmin!({ groupId: 'room', userId: 'member', enabled: true });
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
    await expect(port!.setGroupAdmin!({ groupId: 'room', userId: 'member', enabled: true })).rejects.toMatchObject({ code: 'operation_scope_ended', disposition: 'not_sent' });
    expect(f.endpoint.setGroupAdmin).not.toHaveBeenCalled();
  } finally { await f.close(); }
});


it.each(['platform.receive', 'notice.receive', 'request.receive', 'system.receive'] as const)(
  'cancels the actual %s Handler operation when its source account stops', async name => {
    const started = deferred(), resume = deferred();
    let signal: AbortSignal | undefined;
    const f = await fixture(async () => undefined, defineLifecycleHandler({ event: name, async handle() {
      signal = this.signal;
      expect(this.session).toBeUndefined();
      started.resolve();
      await resume.promise;
    } }));
    const common = { id: 'event', timestamp: 100, metadata: {} };
    const receiving = name === 'platform.receive'
      ? f.endpoint[endpointSpec].events.platform('native.ready', f.event)
      : f.endpoint[endpointSpec].events.emit(name, name === 'notice.receive'
        ? { ...common, type: 'notice', name: 'notice.group.member_increase', conversation: { kind: 'group', id: 'room' } }
        : name === 'request.receive'
          ? { ...common, type: 'request', name: 'request.group.invite', actor: { id: 'alice' },
            conversation: { kind: 'group', id: 'room' }, $approve() {}, $reject() {} }
          : { ...common, type: 'system', name: 'system.online' });
    let stopping: ReturnType<typeof f.adapter.stop> | undefined;
    try {
      await started.promise;
      stopping = f.adapter.stop(f.rows[0].instanceId, f.adapter.revision);
      await vi.waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 100 });
      expect(f.adapter.getEndpoint(f.rows[1].instanceId)).toBe(f.other);
      resume.resolve();
      await receiving;
      expect((await stopping)?.execution.status).toBe('applied');
    } finally {
      resume.resolve();
      await receiving;
      await stopping;
      await f.close();
    }
  },
);


it('validates native event source incarnation before any Handler dispatch', async () => {
  const called = vi.fn();
  const f = await fixture(async () => undefined, defineLifecycleHandler({ event: 'platform.receive', handle: called }));
  const endpoint = { id: f.rows[0].canonicalId, adapter: 'native' };
  const payload = { name: 'native.ready', event: f.event };
  try {
    await expect(f.im.endpointEvents.receive({ name: 'platform.receive', endpoint, payload, client: f.other }))
      .rejects.toMatchObject({ code: 'endpoint_inactive' });
    await f.adapter.stop(f.rows[0].instanceId, f.adapter.revision);
    await expect(f.im.endpointEvents.receive({ name: 'platform.receive', endpoint, payload, client: f.endpoint }))
      .rejects.toMatchObject({ code: 'endpoint_inactive' });
    expect(called).not.toHaveBeenCalled();
  } finally { await f.close(); }
});


it('propagates captured caller cancellation into an in-flight management inspection', async () => {
  const f = await fixture(async () => undefined), entered = deferred(), resume = deferred();
  const owner = new AbortController(), inspector = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  f.endpoint.inspectGroupMember.mockImplementationOnce(async ({ signal }) => {
    receivedSignal = signal;
    entered.resolve();
    await resume.promise;
    return { canModerate: false };
  });
  const operation = f.im.endpoints.captureOperation({ target: f.input.conversation,
    client: f.endpoint, signal: owner.signal, requester: f.author });
  const inspecting = operation.management!.inspectGroupMember!({ groupId: 'room', userId: 'member', signal: inspector.signal });
  try {
    await entered.promise;
    owner.abort(new Error('Retained work cancelled'));
    expect(operation.signal.aborted).toBe(true);
    expect(inspector.signal.aborted).toBe(false);
    expect(receivedSignal?.aborted).toBe(true);
  } finally {
    resume.resolve();
    await inspecting.catch(() => undefined);
    operation.release();
    await f.close();
  }
});


it('requires the actual source Client when capturing an account operation', async () => {
  const f = await fixture(async () => undefined);
  let captured: ReturnType<typeof f.im.endpoints.captureOperation> | undefined;
  try {
    expect(() => { captured = f.im.endpoints.captureOperation({ target: f.input.conversation, client: undefined }); })
      .toThrow();
  } finally {
    captured?.release();
    await f.close();
  }
});


it('retains the real source and author through send, rejects foreign refs and releases authority idempotently', async () => {
  const f = await fixture(async () => undefined);
  const operation = f.im.endpoints.captureOperation({ target: f.input.conversation, client: f.endpoint, requester: f.author });
  try {
    expect(() => f.im.endpoints.captureOperation({ target: f.input.conversation, client: f.other })).toThrow();
    const foreign = { ...f.input.conversation, endpoint: { id: f.rows[1].canonicalId, adapter: 'native' } };
    await expect(async () => operation.control!.recall!({ message: { conversation: foreign, id: 'foreign-message' } }))
      .rejects.toMatchObject({ code: 'endpoint_identity_mismatch', disposition: 'not_sent' });
    expect(f.endpoint.recall).not.toHaveBeenCalled();
    expect((await operation.send('captured answer')).status).toBe('sent');
    expect(f.owners).toEqual([f.author]);
    expect(f.endpoint.sent).toHaveLength(1);
    expect(f.endpoint.sent[0].payload).toBe('wrapped:captured answer');
    expect(f.other.sent).toHaveLength(0);
    operation.release();
    operation.release();
    await expect(operation.send('released answer')).rejects.toMatchObject({ code: 'operation_scope_ended' });
    await expect(operation.management!.setGroupAdmin!({ groupId: 'room', userId: 'member', enabled: true })).rejects.toMatchObject({ code: 'operation_scope_ended' });
    expect(f.endpoint.setGroupAdmin).not.toHaveBeenCalled();
    expect(f.adapter.getEndpoint(f.rows[0].instanceId)).toBe(f.endpoint);
  } finally { operation.release(); await f.close(); }
});

it('combines a retained control caller and per-call signal without cancelling the independent caller', async () => {
  const f = await fixture(async () => undefined), entered = deferred(), resume = deferred();
  const owner = new AbortController(), independent = new AbortController();
  let platformSignal: AbortSignal | undefined;
  f.endpoint.recall.mockImplementationOnce(async ({ signal }) => {
    platformSignal = signal; entered.resolve(); await resume.promise;
  });
  const operation = f.im.endpoints.captureOperation({ target: f.input.conversation, client: f.endpoint, signal: owner.signal });
  const recalling = operation.control!.recall!({ message: { conversation: f.input.conversation, id: 'source-message' }, signal: independent.signal });
  try {
    await entered.promise;
    owner.abort(new Error('Retained control cancelled'));
    expect(operation.signal.aborted).toBe(true);
    expect(platformSignal?.aborted).toBe(true);
    expect(independent.signal.aborted).toBe(false);
  } finally { resume.resolve(); await recalling.catch(() => undefined); operation.release(); await f.close(); }
});

it.each(['caller', 'root'] as const)('released capture keeps an admitted inspection owned and cancellable by its %s', async cancellation => {
  const f = await fixture(async () => undefined), entered = deferred(), finish = deferred();
  const caller = new AbortController(); let received: AbortSignal | undefined;
  f.endpoint.inspectGroupMember.mockImplementationOnce(async ({ signal }) => {
    received = signal; entered.resolve(); await finish.promise; return { canModerate: false };
  });
  const operation = f.im.endpoints.captureOperation({ target: f.input.conversation, client: f.endpoint, signal: caller.signal });
  const pending = operation.management!.inspectGroupMember!({ groupId: 'room', userId: 'member', signal: new AbortController().signal });
  let retiring: Promise<void> | undefined;
  try {
    await entered.promise; operation.release();
    await expect(operation.management!.inspectGroupMember!({ groupId: 'room', userId: 'late', signal: new AbortController().signal }))
      .rejects.toMatchObject({ disposition: 'not_sent' });
    if (cancellation === 'caller') caller.abort(new Error('original caller ended'));
    else retiring = f.store.close();
    expect(received?.aborted).toBe(true);
  } finally { finish.resolve(); await pending.catch(() => undefined); operation.release(); await retiring; await f.close(); }
});

it.each(['caller', 'root'] as const)('released capture keeps a submitted send owned and cancellable by its %s', async cancellation => {
  const f = await fixture(async () => undefined), entered = deferred(), finish = deferred();
  const caller = new AbortController(); let received: AbortSignal | undefined;
  f.endpoint.sendNative.mockImplementationOnce(async request => {
    received = request.signal; entered.resolve(); await finish.promise; return 'original-send';
  });
  const operation = f.im.endpoints.captureOperation({ target: f.input.conversation, client: f.endpoint, signal: caller.signal });
  const pending = operation.send('first'); let retiring: Promise<void> | undefined;
  try {
    await entered.promise; operation.release();
    await expect(operation.send('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    if (cancellation === 'caller') caller.abort(new Error('original caller ended'));
    else retiring = f.store.close();
    expect(received?.aborted).toBe(true); expect(f.endpoint.sendNative).toHaveBeenCalledOnce();
  } finally { finish.resolve(); await pending.catch(() => undefined); operation.release(); await retiring; await f.close(); }
});
