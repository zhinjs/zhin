import type { UserInteraction } from '@zhin.js/interaction';
import { describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken,
  type EndpointSendRequest, type EndpointDesiredRepository, type EndpointDesiredSnapshot, type EndpointEvent } from '@zhin.js/adapter';
import { HandlerIndex, handlerFeatureId } from '@zhin.js/handler';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState, type FeatureId } from '@zhin.js/plugin-runtime';
import { readOperationSession } from '@zhin.js/feature-kit';
import { defineHandler } from '../src/feature/handler.js';
import { ImRuntime, type IncomingMessage, type Message, type IncomingNotice, type IncomingRequest, type IncomingSystemEvent, type Notice, type Request, type SystemEvent } from '../src/plugin-runtime/im/index.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class EventClient {
  readonly stopped = vi.fn();
  readonly sent: EndpointSendRequest[] = [];
  constructor(readonly account: string) {}
  send(request: EndpointSendRequest) { this.sent.push(request); return `sent-${this.sent.length}`; }
}
class EventEndpoint extends EventClient implements Endpoint {
  onStart?: () => Promise<void> | undefined;
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: () => this.onStart?.(), open() {}, close() {}, stop: () => { this.stopped(); },
    send: request => this.send(request),
  });
  receiveMessage(input: IncomingMessage) { return this[endpointSpec].events.emit('message.receive', input); }
  receive(input: IncomingRequest | IncomingNotice | IncomingSystemEvent) { return this[endpointSpec].events.emit(`${input.type}.receive`, input); }
}
class EventAdapter extends Adapter<EventEndpoint> {
  onStart?: (endpoint: EventEndpoint) => Promise<void>;
  protected createEndpoint(config: Readonly<Record<string, unknown>>) {
    const endpoint = new EventEndpoint(String(config.id)); endpoint.onStart = () => this.onStart?.(endpoint); return endpoint;
  }
}
async function fixture(callbacks: { message?: (message: Message) => Promise<void>; request?: (request: Request, interaction?: UserInteraction) => Promise<void>; notice?: (notice: Notice, interaction?: UserInteraction) => Promise<void>; system?: (system: SystemEvent) => Promise<void> } = {}) {
  const root = rootPluginId(), im = new ImRuntime(), adapter = new EventAdapter();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'event-lifetime', source: '/fixture/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const received: EndpointEvent[] = [];
  const handlers = [
    createCapabilitySlot({ owner: root, feature: handlerFeatureId, localName: 'message', source: '/fixture/message.ts', definition: defineHandler({ event: 'message.receive', async handle(event) {
      received.push(event); await callbacks.message?.(event.payload);
    } }) }),
    createCapabilitySlot({ owner: root, feature: handlerFeatureId, localName: 'request', source: '/fixture/request.ts', definition: defineHandler({ event: 'request.receive', async handle(event) {
      received.push(event); await callbacks.request?.(event.payload, this.interaction);
    } }) }),
    createCapabilitySlot({ owner: root, feature: handlerFeatureId, localName: 'notice', source: '/fixture/notice.ts', definition: defineHandler({ event: 'notice.receive', async handle(event) {
      received.push(event); await callbacks.notice?.(event.payload, this.interaction);
    } }) }),
    createCapabilitySlot({ owner: root, feature: handlerFeatureId, localName: 'system', source: '/fixture/system.ts', definition: defineHandler({ event: 'system.receive', async handle(event) {
      received.push(event); await callbacks.system?.(event.payload);
    } }) }),
  ];
  const slots = [slot, ...handlers];
  const base: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { endpoints: [{ id: 'one' }, { id: 'two' }] }]]),
    resources: new Map([[root, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
    capabilities: new Map(slots.map(value => [value.id, value])), projections: new Map() };
  let saved: EndpointDesiredSnapshot | undefined;
  const repository: EndpointDesiredRepository = { load: async () => saved, compareAndSet: async (_id, revision, endpoints) => {
    if ((saved?.revision ?? null) !== revision) throw new Error('conflict'); return saved = structuredClone({ revision: (revision ?? 0) + 1, endpoints });
  } };
  const view = createSnapshotView(0, base), index = await AdapterIndex.create([slot], view, new AbortController().signal, { repository });
  let held = 0; const acquire = index.acquireInbound.bind(index);
  vi.spyOn(index, 'acquireInbound').mockImplementation((...args) => {
    const lease = acquire(...args); held++;
    let released = false;
    return Object.freeze({ ...lease, release: () => { if (!released) { held--; released = true; } lease.release(); } });
  });
  const store = new SnapshotStore({ ...base, projections: new Map<FeatureId, unknown>([[adapterFeatureId, index], [handlerFeatureId, new HandlerIndex(handlers, view)]]) });
  im.attach(store); await index.start(); index.open();
  const rows = adapter.list(), one = adapter.getEndpoint(rows[0]!.instanceId)!, two = adapter.getEndpoint(rows[1]!.instanceId)!;
  const approved = vi.fn(async () => undefined), rejected = vi.fn(async () => undefined);
  const request: IncomingRequest = { id: 'request-one', name: 'request.friend.add', type: 'request', actor: { id: 'user' },
    timestamp: Date.now(), conversation: { kind: 'private', id: 'user' }, metadata: { marker: 'retained' }, $approve: approved, $reject: rejected };
  return { adapter, index, im, store, rows, one, two, received, approved, rejected, request, held: () => held,
    close: async () => { await index.stop(); await store.close(); } };
}

describe('canonical Endpoint event operation lifetime', () => {
  it('admits a captured system.online while SDK start is pending', async () => {
    const f = await fixture();
    try {
      f.adapter.onStart = async endpoint => { await endpoint.receive({ id: 'starting-online', type: 'system', name: 'system.online', timestamp: Date.now(), metadata: {} }); };
      const added = await f.adapter.add(f.adapter.revision, { endpointId: 'third', config: { id: 'third' } });
      const third = added.endpoints.find(endpoint => endpoint.endpointId === 'third')!;
      expect((await f.adapter.start(third.instanceId, f.adapter.revision)).execution.status).toBe('applied');
      expect(f.received).toHaveLength(1); expect(f.received[0]!.payload).toMatchObject({ id: 'starting-online', name: 'system.online' });
      expect(f.received[0]!.client).toBe(f.adapter.getEndpoint(third.instanceId)!); expect(f.held()).toBe(0);
    } finally { await f.close(); }
  });
  it('admits a captured message during SDK start while keeping its reply send behind ready', async () => {
    const native = { buffer: Buffer.from('native') }; let source: EventEndpoint | undefined;
    const f = await fixture({ message: async message => {
      const session = readOperationSession(message)!;
      expect(session.event).toBe(native); expect(session.endpoint).toBe(source); expect(message.$client).toBe(source!);
      expect((await session.reply('before ready'))).toMatchObject({ status: 'failed' });
      expect(source!.sent).toEqual([]);
    } });
    try {
      f.adapter.onStart = async endpoint => {
        source = endpoint;
        await endpoint.receiveMessage({ conversation: { endpoint: endpoint[endpointSpec].identity, kind: 'private', id: 'user' }, sender: { id: 'user' }, content: 'hello', event: native });
      };
      const added = await f.adapter.add(f.adapter.revision, { endpointId: 'third', config: { id: 'third' } });
      const third = added.endpoints.find(endpoint => endpoint.endpointId === 'third')!;
      expect((await f.adapter.start(third.instanceId, f.adapter.revision)).execution.status).toBe('applied');
      expect(f.received).toHaveLength(1); expect(f.held()).toBe(0);
    } finally { await f.close(); }
  });
  it('rejects a pending-start request action when its captured Endpoint stops', async () => {
    const entered = deferred(), resume = deferred(); let failed: unknown;
    const f = await fixture({ request: async request => { entered.resolve(); await resume.promise; try { await request.$approve(); } catch (error) { failed = error; } } });
    f.adapter.onStart = async endpoint => { await endpoint.receive(f.request); };
    const added = await f.adapter.add(f.adapter.revision, { endpointId: 'third', config: { id: 'third' } });
    const third = added.endpoints.find(endpoint => endpoint.endpointId === 'third')!;
    const starting = f.adapter.start(third.instanceId, f.adapter.revision);
    let stopping: Promise<unknown> | undefined;
    try {
      await entered.promise;
      stopping = f.adapter.stop(third.instanceId, f.adapter.revision);
      await vi.waitFor(() => expect(f.adapter.getEndpoint(third.instanceId)).toBeUndefined());
      resume.resolve(); await starting; await stopping;
      expect(failed).toBeInstanceOf(Error); expect(f.approved).not.toHaveBeenCalled(); expect(f.held()).toBe(0);
      expect(f.adapter.getEndpoint(f.rows[0]!.instanceId)).toBe(f.one); expect(f.adapter.getEndpoint(f.rows[1]!.instanceId)).toBe(f.two);
    } finally { resume.resolve(); await starting; await stopping; await f.close(); }
  });

  it.each(['request', 'notice'] as const)('cancels a pending %s interaction on account stop so its event lease can drain', async kind => {
    let failure: unknown;
    const ask = async (_event: Request | Notice, interaction?: UserInteraction) => {
      try { await interaction!.ask({ type: 'text', title: 'Please reply' }); } catch (error) { failure = error; }
    };
    const f = await fixture({ [kind]: ask });
    const input: IncomingRequest | IncomingNotice = kind === 'request' ? f.request : {
      id: 'notice', type: 'notice', name: 'notice.group.member_increase', actor: { id: 'user' },
      conversation: { kind: 'group', id: 'group' }, timestamp: Date.now(), metadata: {},
    };
    const running = f.one.receive(input); let stopping: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => expect(f.one.sent).toHaveLength(1));
      stopping = f.adapter.stop(f.rows[0]!.instanceId, f.adapter.revision);
      await vi.waitFor(() => expect(failure).toBeInstanceOf(Error));
      await running; await stopping; expect(f.held()).toBe(0);
      expect(f.adapter.getEndpoint(f.rows[1]!.instanceId)).toBe(f.two);
    } finally {
      // Also release the original behavior's pending ask after a failed regression assertion.
      const current = f.store.current;
      f.store.commit(current.generation, { snapshot: { root: current.root, tree: current.tree, config: current.config, resources: current.resources,
        capabilities: current.capabilities, projections: current.projections }, dispose: () => undefined });
      await running; await stopping; await f.close();
    }
  });

  it.each(['stop', 'update'] as const)('rejects deferred request actions and Client access after %s without touching the other account', async action => {
    const entered = deferred(), resume = deferred(), failures: unknown[] = [];
    const f = await fixture({ request: async request => {
      entered.resolve(); await resume.promise;
      for (const operation of [() => request.$approve(), () => request.$reject(), () => Promise.resolve(request.$client)]) {
        try { await operation(); } catch (error) { failures.push(error); }
      }
    } });
    const running = f.one.receive(f.request);
    let changing: Promise<unknown> | undefined;
    try {
      await entered.promise;
      changing = action === 'stop' ? f.adapter.stop(f.rows[0]!.instanceId, f.adapter.revision)
        : f.adapter.update(f.rows[0]!.instanceId, f.adapter.revision, { config: { id: 'one', changed: true } });
      await vi.waitFor(() => expect(f.adapter.getEndpoint(f.rows[0]!.instanceId)).not.toBe(f.one));
      expect(f.adapter.getEndpoint(f.rows[1]!.instanceId)).toBe(f.two);
      resume.resolve(); await running; await changing;
      expect(failures).toHaveLength(3); expect(f.approved).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
      expect(f.one.stopped).toHaveBeenCalledOnce(); expect(f.held()).toBe(0);
      if (action === 'update') expect(f.adapter.getEndpoint(f.rows[0]!.instanceId)).not.toBe(f.one);
    } finally { resume.resolve(); await running; await changing; await f.close(); }
  });
  it('executes an admitted approval once and releases after an action or handler throws', async () => {
    const failed = new Error('synthetic action failure'); let failHandler = false;
    const f = await fixture({ request: async request => { if (failHandler) throw failed; await request.$approve(); } });
    try {
      await f.one.receive(f.request); expect(f.approved).toHaveBeenCalledOnce(); expect(f.held()).toBe(0);
      f.approved.mockRejectedValueOnce(failed);
      await expect(f.one.receive(f.request)).rejects.toBe(failed); expect(f.approved).toHaveBeenCalledTimes(2); expect(f.held()).toBe(0);
      failHandler = true;
      await expect(f.one.receive(f.request)).rejects.toBe(failed); expect(f.approved).toHaveBeenCalledTimes(2); expect(f.held()).toBe(0);
      expect((await f.adapter.stop(f.rows[0]!.instanceId, f.adapter.revision)).execution.status).toBe('applied');
    } finally { await f.close(); }
  });
  it('preserves Root-only held callback drain when an unrelated generation retains the Index', async () => {
    const entered = deferred(), resume = deferred();
    const f = await fixture({ request: async request => { entered.resolve(); await resume.promise; await request.$approve(); } });
    const running = f.one.receive(f.request);
    try {
      await entered.promise; const current = f.store.current;
      f.store.commit(current.generation, { snapshot: { root: current.root, tree: current.tree, config: current.config, resources: current.resources,
        capabilities: current.capabilities, projections: current.projections }, dispose: () => undefined });
      resume.resolve(); await running; expect(f.approved).toHaveBeenCalledOnce(); expect(f.held()).toBe(0);
    } finally { resume.resolve(); await running; await f.close(); }
  });
  it('preserves canonical notice/system payloads and native Client without manufacturing a Message Session', async () => {
    const f = await fixture();
    try {
      await f.one.receive({ id: 'notice', type: 'notice', name: 'notice.group.member_increase', timestamp: 123, metadata: { marker: 'notice' },
        actor: { id: 'person' }, conversation: { kind: 'group', id: 'group', parent: { kind: 'channel', id: 'parent' }, threadId: 'thread' } });
      await f.two.receive({ id: 'system', type: 'system', name: 'system.online', timestamp: 456, metadata: { marker: 'system' } });
      expect(f.received.map(event => ({ name: event.name, payload: event.payload }))).toMatchObject([
        { name: 'notice.receive', payload: { type: 'notice', id: 'notice', timestamp: 123, metadata: { marker: 'notice' }, actor: { id: 'person' }, conversation: { kind: 'group', id: 'group', threadId: 'thread', parent: { id: 'parent' } } } },
        { name: 'system.receive', payload: { type: 'system', id: 'system', timestamp: 456, metadata: { marker: 'system' } } },
      ]);
      expect(f.received[0]!.client).toBe(f.one); expect(f.received[1]!.client).toBe(f.two);
      expect(f.received.every(event => readOperationSession(event) === undefined)).toBe(true); expect(f.held()).toBe(0);
    } finally { await f.close(); }
  });
});
