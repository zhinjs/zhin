import { EventEmitter } from 'node:events';
import { retireEndpoint } from '../src/endpoint-specification.js';
import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotStore,
  RootController,
  GenerationHandoffStack,
  createCapabilitySlot,
  createToken,
  generationAdmissionBinder,
  childPluginId,
  rootPluginId,
  type GenerationAdmissionGate,
  type RuntimeSnapshot,
  type PluginId,
  type TokenId,
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import adapterFeature, {
  AdapterIndex,
  Adapter,
  createEndpointSpecification,
  endpointSpec,
  type Endpoint,
  type EndpointHooks,
  type EndpointCreationContext,
  type EndpointTransportState,
  type EndpointSpecification,
  adapterFeatureId,
  defineAdapter as defineAdapterContract,
  endpointEventGatewayToken,
  endpointCapabilitiesOf,
  isAdapterIndex,
  parseAdapterDefinition,
  endpointControlOf,
  createRecallEndpointControl,
  endpointContentOf,
  resolveEndpointManagement,
  type AdapterSegmentPolicy,
  type AdapterContext,
  type AdapterDefinition,
  type EndpointEvent,
} from '../src/index.js';

type FixtureDefinition<TConfig> = Omit<AdapterDefinition<TConfig>, '$feature' | 'createAdapter'> & {
  createEndpoint(context: AdapterContext<TConfig>): Endpoint | Promise<Endpoint>;
};
class NativeClient extends EventEmitter { nativeCall() { return 'native'; } }
class TestEndpoint extends NativeClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  get transportState(): EndpointTransportState | undefined { return 'open'; }
  constructor(hooks: Partial<EndpointHooks>) {
    super();
    const transportState = () => this.transportState;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: hooks.start ?? (() => undefined), open: hooks.open ?? (() => undefined), close: hooks.close ?? (() => undefined), stop: hooks.stop ?? (() => undefined),
      send: hooks.send, name: hooks.name, control: hooks.control, management: hooks.management, content: hooks.content,
      get transportState() { return transportState(); },
    });
  }
}
function defineFixtureAdapter<TConfig = unknown>(definition: FixtureDefinition<TConfig>): Readonly<AdapterDefinition<TConfig>> {
  const { createEndpoint, ...metadata } = definition;
  return defineAdapterContract({ ...metadata, createAdapter: context => new class extends Adapter<Endpoint, TConfig> {
    protected createEndpoint(config: TConfig, execution: EndpointCreationContext) {
      return createEndpoint({ ...context, config, id: execution.canonicalId, endpointId: execution.endpointId });
    }
  }() });
}

const testEndpointEvents = Object.freeze({
  async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); },
  receive: async (_event: EndpointEvent) => undefined,
  [generationAdmissionBinder](gate: GenerationAdmissionGate) {
    return Object.freeze({
      async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); },
      receive: (event: EndpointEvent) => gate.enter(() => this.receive(event)),
    });
  },
});

describe('Adapter Feature', () => {
  it('rejects JavaScript project access during transport creation instead of capturing another Feature', async () => {
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'invalid-construction', source: '/fixture/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['outbound'], createEndpoint(context) {
        expect(Reflect.has(context, 'project')).toBe(false);
        const invalid = context as unknown as { project(feature: unknown): never };
        return invalid.project(adapterFeatureId);
      } }),
    });
    await expect(createAdapterIndex([slot], snapshot([slot]))).rejects.toThrow(/project/);
  });

  it('derives explicit endpoint operations from the adapter declaration', () => {
    const definition = defineFixtureAdapter({
      capabilities: ['inbound', 'outbound'],
      operations: ['recall', 'typing'],
      createEndpoint: () => new TestEndpoint({}),
    });

    expect(endpointCapabilitiesOf(definition)).toEqual({
      inbound: true,
      outbound: true,
      operations: { recall: true, typing: true },
    });
    expect(() => defineFixtureAdapter({
      capabilities: ['outbound'],
      operations: ['send' as never],
      createEndpoint: () => new TestEndpoint({}),
    })).toThrow('operations');
  });

  it('exposes endpoint management only through the explicit semantic port', async () => {
    const listFriends = async () => [{ user_id: 1, nickname: 'Ada', remark: '' }];
    const management = resolveEndpointManagement({ management: { listFriends } });

    await expect(management?.listFriends?.()).resolves.toEqual([
      { user_id: 1, nickname: 'Ada', remark: '' },
    ]);
    expect(resolveEndpointManagement({ friends: new Map() })).toBeUndefined();
  });

  it('resolves message control only through the semantic port', async () => {
    const explicitRecall = async () => undefined;
    const control = endpointControlOf({
      control: { recall: explicitRecall },
    });

    expect(control?.recall).toBe(explicitRecall);
    expect(endpointControlOf({ recallMessage: async () => undefined })).toBeUndefined();
  });

  it('adapts platform recall-by-id methods to canonical MessageRef control', async () => {
    const recall = vi.fn(async () => undefined);
    const control = createRecallEndpointControl(recall);
    await control.recall?.({ message: {
      conversation: {
        endpoint: { id: 'memory', adapter: 'memory' },
        kind: 'group',
        id: 'room-1',
      },
      id: 'message-1',
    } });

    expect(recall).toHaveBeenCalledWith('message-1', undefined);
    expect(Object.isFrozen(control)).toBe(true);
  });

  it('resolves conversation references only through the explicit content port', async () => {
    const root = rootPluginId();
    const conversation = {
      endpoint: { id: 'memory', adapter: 'memory' },
      kind: 'group' as const,
      id: 'room-1',
    };
    const reference = { kind: 'message' as const, message: { conversation, id: 'm-1' } };
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          content: {
            resolve: async (received) => ({
              status: 'resolved' as const,
              reference: received,
              value: {
                ref: reference.message,
                segments: [{ type: 'text', data: { text: 'resolved' } }],
                timestamp: 1,
              },
            }),
          },
        }),
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    await index.activate(new AbortController().signal);
    await expect(index.resolveContent(slot.id, reference, {
      signal: new AbortController().signal,
      maxDepth: 2,
      maxEntries: 50,
      maxChars: 12_000,
    })).resolves.toEqual(expect.objectContaining({ status: 'resolved' }));
    expect(endpointContentOf({ getMessage: async () => undefined })).toBeUndefined();
    await index.stop();
  });

  it('requires declared operations to exist on an explicit control port', async () => {
    const root = rootPluginId();
    const invalid = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'invalid-control',
      source: '/adapters/invalid-control/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        operations: ['edit', 'typing'],
        createEndpoint: () => new TestEndpoint({
          send: async () => 'message-1',
          control: { recall: async () => undefined },
        }),
      }),
    });
    await expect(createAdapterIndex([invalid], snapshot([invalid])))
      .rejects.toThrow('declares edit but control.edit is missing');

    const valid = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'valid-control',
      source: '/adapters/valid-control/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        operations: ['recall', 'edit', 'reaction', 'typing'],
        createEndpoint: () => new TestEndpoint({
          send: async () => 'message-1',
          control: {
            recall: async () => undefined,
            edit: async () => 'edited',
            addReaction: async () => 'reaction',
            typing: async () => undefined,
          },
        }),
      }),
    });
    const index = await createAdapterIndex([valid], snapshot([valid]));
    await index.stop();
  });

  it('resolves and exposes exact operations for each expanded Endpoint', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'multi-mode',
      source: '/adapters/multi-mode/index.ts',
      definition: defineFixtureAdapter<{ mode: 'gateway' | 'webhook' }>({
        capabilities: ['inbound', 'outbound'],
        operations: (context) => context.config.mode === 'gateway'
          ? ['recall', 'reaction']
          : ['recall'],
        createEndpoint: (context) => new TestEndpoint({
          send: async () => 'message-1',
          control: {
            recall: async () => undefined,
            ...(context.config.mode === 'gateway'
              ? { addReaction: async () => 'reaction-1' }
              : {}),
          },
        }),
      }),
    });
    expect(() => endpointCapabilitiesOf(slot.definition)).toThrow(
      'Dynamic Adapter operations must be resolved for one Endpoint',
    );
    const index = await createAdapterIndex([slot], snapshot([slot], new Map([[root, {
      endpoints: [
        { id: 'socket', mode: 'gateway' },
        { id: 'hook', mode: 'webhook' },
      ],
    }]])));

    const socket = index.describe().find((row) => row.name === 'socket');
    const hook = index.describe().find((row) => row.name === 'hook');
    expect(socket?.operations).toEqual(['recall', 'reaction']);
    expect(hook?.operations).toEqual(['recall']);
    expect(index.capabilities(socket!.id)).toEqual({
      inbound: true,
      outbound: true,
      operations: { recall: true, reaction: true },
    });
    expect(index.capabilities(hook!.id)).toEqual({
      inbound: true,
      outbound: true,
      operations: { recall: true },
    });
    await index.stop();
  });

  it('rejects explicit control operations that were not declared', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'hidden-control',
      source: '/adapters/hidden-control/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        createEndpoint: () => new TestEndpoint({
          send: async () => 'message-1',
          control: { recall: async () => undefined },
        }),
      }),
    });

    await expect(createAdapterIndex([slot], snapshot([slot])))
      .rejects.toThrow('exposes control.recall but does not declare recall');

    const hiddenReactionRemoval = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'hidden-reaction-removal',
      source: '/adapters/hidden-reaction-removal/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        createEndpoint: () => new TestEndpoint({
          send: async () => 'message-1',
          control: { removeReaction: async () => undefined },
        }),
      }),
    });
    await expect(createAdapterIndex(
      [hiddenReactionRemoval],
      snapshot([hiddenReactionRemoval]),
    )).rejects.toThrow('exposes control.removeReaction but does not declare reaction');
  });

  it('forwards only the structured conversation request', async () => {
    const root = rootPluginId();
    let received: unknown;
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        createEndpoint: () => new TestEndpoint({ send: async (request) => {
          received = request;
          return 'message-1';
        } }),
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    await index.start();
    index.open();
    const conversation = {
      endpoint: { id: String(slot.id), adapter: 'memory' },
      kind: 'group' as const,
      id: 'room-1',
    };
    await index.send(slot.id, {
      conversation,
      payload: 'hello',
    });
    expect(received).toEqual({ conversation, payload: 'hello', signal: expect.any(AbortSignal) });
    await index.stop();
  });

  it('rejects outbound declarations without the exact send contract', async () => {
    const root = rootPluginId();
    const missing = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'missing-send',
      source: '/adapters/missing-send/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        createEndpoint: () => new TestEndpoint({}),
      }),
    });
    await expect(createAdapterIndex([missing], snapshot([missing])))
      .rejects.toThrow('declares outbound but send() is missing');
  });

  it.each([
    'legacy-id',
    { parts: [{ messageId: 'first', sourceIndices: [0] }, { sourceIndices: [1] }, { messageId: 'last', sourceIndices: [2] }] },
    { parts: [{}] },
  ])('preserves single-ID and ordered multi-part native send evidence: %j', async result => {
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'batch',
      source: '/adapters/batch/index.ts', definition: defineFixtureAdapter({ capabilities: ['outbound'],
        createEndpoint: () => new TestEndpoint({ send: () => result }),
      }) });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    await index.start();
    try {
      expect(await index.send(slot.id, {
        conversation: { endpoint: { id: String(slot.id), adapter: 'batch' }, kind: 'group', id: 'scene' },
        payload: ['first', 'share', 'last'],
      })).toEqual(result);
    } finally { await index.stop(); }
  });

  it.each([undefined, '', { message_id: 'wrong-shape' }, { parts: [] }, { parts: [null] },
    { parts: [{ messageId: '' }] }, { parts: [{ sourceIndices: [-1] }] }, { parts: [{ sourceIndices: [0.5] }] },
  ])('rejects malformed send evidence as unknown without resending: %j', async result => {
    const send = vi.fn(() => result as never);
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'batch',
      source: '/adapters/batch/index.ts', definition: defineFixtureAdapter({ capabilities: ['outbound'],
        createEndpoint: () => new TestEndpoint({ send }),
      }) });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    await index.start();
    try {
      await expect(index.send(slot.id, {
        conversation: { endpoint: { id: String(slot.id), adapter: 'batch' }, kind: 'group', id: 'scene' }, payload: 'hello',
      })).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
      expect(send).toHaveBeenCalledOnce();
    } finally { await index.stop(); }
  });

  it('reports an invalid create result before checking outbound send', async () => {
    const root = rootPluginId();
    const invalid = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'invalid-result',
      source: '/adapters/invalid-result/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['outbound'],
        createEndpoint: () => null as never,
      }),
    });

    await expect(createAdapterIndex([invalid], snapshot([invalid])))
      .rejects.toThrow('must implement Endpoint');
  });

  it('brands definitions and discovers named adapter modules', async () => {
    const definition = defineFixtureAdapter({
      capabilities: ['inbound', 'outbound'],
      createEndpoint: () => new TestEndpoint({}),
    });
    expect(parseAdapterDefinition(definition)).toBe(definition);
    expect(() => defineFixtureAdapter({ capabilities: [], createEndpoint: () => new TestEndpoint({}) })).toThrow(
      'capabilities',
    );
    // ADR 0038 §5: liveDanmaku marks a live-stream adapter and needs inbound.
    const live = defineFixtureAdapter({ capabilities: ['inbound', 'outbound', 'liveDanmaku'], createEndpoint: () => new TestEndpoint({}) });
    expect(parseAdapterDefinition(live).capabilities).toEqual(['inbound', 'outbound', 'liveDanmaku']);
    expect(() => defineFixtureAdapter({ capabilities: ['outbound', 'liveDanmaku'], createEndpoint: () => new TestEndpoint({}) }))
      .toThrow('liveDanmaku requires inbound');
    expect(() => defineFixtureAdapter({ capabilities: ['liveDanmaku'], createEndpoint: () => new TestEndpoint({}) })).toThrow('capabilities');
    expect(() => parseAdapterDefinition({ ...live, capabilities: ['outbound', 'liveDanmaku'] }))
      .toThrow('Adapter module must default-export defineAdapter(...)');

    const source = '/project/adapters/discord/index.ts';
    const host = new MemoryDiscoveryHost({
      '/project/adapters': [{ name: 'discord', kind: 'directory' }],
      '/project/adapters/discord': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(adapterFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['discord']);
  });

  it('injects symbol identity and owns the actual native Endpoint lifecycle exactly once per transition', async () => {
    const events: string[] = [], root = rootPluginId();
    const endpoint = new TestEndpoint({ start: () => { events.push('start'); }, open: () => { events.push('open'); }, close: () => { events.push('close'); }, stop: () => { events.push('stop'); },
      send: async request => { events.push('send:' + request.conversation.id + ':' + request.payload); return 'sent'; } });
    const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'memory', source: '/adapters/memory/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['outbound'], createEndpoint(context) { events.push('create:' + context.name + ':' + context.id); return endpoint; } }) });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    expect(endpoint.emit).toBe(EventEmitter.prototype.emit); expect(index.clientAdapter(slot.id)).toBe('memory');
    expect(endpoint[endpointSpec].identity).toEqual({ id: slot.id, adapter: 'memory' });
    expect(isAdapterIndex(index)).toBe(true); expect(isAdapterIndex({ $projection: 'zhin.adapter-index/1' })).toBe(true);
    await index.start(); index.open();
    await expect(index.send(slot.id, { conversation: { endpoint: { id: slot.id, adapter: 'memory' }, kind: 'private', id: 'room' }, payload: 'hello' })).resolves.toBe('sent');
    await index.close(); index.open(); await index.stop(); await index.stop();
    expect(events).toEqual(['create:memory:' + slot.id, 'start', 'open', 'send:room:hello', 'close', 'open', 'close', 'stop']);
  });

  it('rejects the removed compact lifecycle factory before any connection resource can be created', () => {
    const connect = vi.fn();
    expect(() => defineAdapterContract({ capabilities: ['inbound'], create: () => ({ client: {}, connect }) } as never)).toThrow(/createAdapter/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('still stops the actual native transport when closing its input fails', async () => {
    const events: string[] = [];
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'cleanup-failure', source: '/adapters/cleanup-failure/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new TestEndpoint({ close: () => { events.push('input close'); throw new Error('input close failed'); }, stop: () => { events.push('native stop'); } }) }) });
    const index = await createAdapterIndex([slot], snapshot([slot])); await index.start(); index.open();
    await expect(index.stop()).rejects.toBeInstanceOf(AggregateError); expect(events).toEqual(['input close', 'native stop']);
  });



  it('handles both promises when a synchronous Endpoint start aborts and throws', async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const originalError = new Error('synchronous startup failure');
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'sync-abort', source: '/adapters/sync-abort/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new TestEndpoint({
        start: () => {
          controller.abort(new Error('startup cancelled'));
          throw originalError;
        },
        stop: cleanup,
      }) }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(index.activate(controller.signal)).rejects.toBe(originalError);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      process.off('unhandledRejection', unhandled);
      await index.stop();
    }
  });

  it('does not invoke deferred Endpoint start after cancellation already stopped its record', async () => {
    const controller = new AbortController();
    const start = vi.fn();
    const cleanup = vi.fn();
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'cancel-before-start', source: '/adapters/cancel-before-start/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new TestEndpoint({ start, stop: cleanup }) }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    const starting = index.start(controller.signal);
    controller.abort(new Error('cancelled before adapter invocation'));
    await expect(starting).rejects.toThrow('cancelled before adapter invocation');
    expect(start).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('fails Endpoint creation closed and disposes already-created candidates', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const good = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'a-good',
      source: '/adapters/a-good/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          start: () => { events.push('start-good'); },
          stop: () => { events.push('stop-good'); },
        }),
      }),
    });
    const broken = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'z-broken',
      source: '/adapters/z-broken/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => { throw new Error('create failed'); },
      }),
    });

    await expect(createAdapterIndex([broken, good], snapshot([good, broken])))
      .rejects.toThrow('create failed');
    expect(events).toEqual(['stop-good']);
  });

  it('releases an endpoint returned after prepare cancellation', async () => {
    const controller = new AbortController();
    const stop = vi.fn();
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'late', source: '/adapters/late/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: async () => {
        controller.abort(new Error('cancel prepare'));
        return new TestEndpoint({ stop });
      } }),
    });
    await expect(AdapterIndex.create([slot], snapshot([slot]), controller.signal)).rejects.toThrow('cancel prepare');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases the current factory result when outbound validation fails', async () => {
    const stop = vi.fn();
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'invalid', source: '/adapters/invalid/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['outbound'], createEndpoint: () => new TestEndpoint({ stop }) }),
    });
    await expect(createAdapterIndex([slot], snapshot([slot]))).rejects.toThrow('send() is missing');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('waits for every required Endpoint to become ready before activation completes', async () => {
    const events: string[] = [];
    let resolveStart!: () => void;
    const started = new Promise<void>((resolve) => { resolveStart = resolve; });
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'slow',
      source: '/adapters/slow/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound', 'outbound'],
        createEndpoint: () => new TestEndpoint({
          async start() {
            events.push('start-begin');
            await started;
            events.push('start-done');
          },
          send: async () => 'message-1',
          open() { events.push('open'); },
          stop() { events.push('stop'); },
        }),
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    const activation = index.activate(new AbortController().signal);
    await vi.waitFor(() => expect(events).toEqual(['start-begin']));
    resolveStart();
    await activation;
    expect(events).toEqual(['start-begin', 'start-done', 'open']);
    await index.stop();
    expect(events.at(-1)).toBe('stop');
  });

  it('rolls back the complete candidate set when one Endpoint start fails', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const healthy = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'a-healthy',
      source: '/adapters/a-healthy/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          start: () => { events.push('healthy:start'); },
          stop: () => { events.push('healthy:stop'); },
        }),
      }),
    });
    const broken = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'z-broken',
      source: '/adapters/z-broken/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          start() {
            events.push('broken:start');
            throw new Error('connect failed');
          },
          stop: () => { events.push('broken:stop'); },
        }),
      }),
    });
    const index = await createAdapterIndex([broken, healthy], snapshot([healthy, broken]));

    await expect(index.activate(new AbortController().signal)).rejects.toThrow('connect failed');
    expect(events).toEqual([
      'healthy:start',
      'broken:start',
      'broken:stop',
      'healthy:stop',
    ]);
  });

  it('fails Root integrity when candidate Endpoint cleanup cannot be proven', async () => {
    const rootId = rootPluginId();
    const slot = createCapabilitySlot({
      owner: rootId,
      feature: adapterFeatureId,
      localName: 'broken-cleanup',
      source: '/adapters/broken-cleanup/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          start: () => { throw new Error('connect failed'); },
          stop: () => { throw new Error('cleanup failed'); },
        }),
      }),
    });
    const initial = snapshot([]);
    const candidateSnapshot = snapshot([slot]);
    const projection = await adapterFeature.runtime.project([slot], {
      snapshot: candidateSnapshot,
      signal: new AbortController().signal,
    });
    const handoff = new GenerationHandoffStack();
    if (projection.handoff) handoff.add(projection.handoff);
    const root = new RootController(snapshotState(initial));
    await root.start(() => ({ snapshot: snapshotState(initial), dispose: () => undefined }));

    await expect(root.transact(() => ({
      snapshot: {
        ...snapshotState(candidateSnapshot),
        projections: new Map([[adapterFeatureId, projection.value]]),
      },
      handoff: handoff.seal(),
      dispose: projection.dispose ?? (() => undefined),
    }))).rejects.toThrow('Root integrity failed');
    expect(root.state).toBe('failed');
    await expect(root.stop()).resolves.toBeUndefined();
  });

  it('lets Root Stop abort and settle required Endpoint readiness', async () => {
    const rootId = rootPluginId();
    const events: string[] = [];
    const slot = createCapabilitySlot({
      owner: rootId,
      feature: adapterFeatureId,
      localName: 'waiting',
      source: '/adapters/waiting/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          start(signal) {
            events.push('start');
            return new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          },
          stop: () => { events.push('stop'); },
        }),
      }),
    });
    const initial = snapshot([]);
    const candidateSnapshot = snapshot([slot]);
    const projection = await adapterFeature.runtime.project([slot], {
      snapshot: candidateSnapshot,
      signal: new AbortController().signal,
    });
    const handoff = new GenerationHandoffStack();
    if (projection.handoff) handoff.add(projection.handoff);
    const root = new RootController(snapshotState(initial));
    await root.start(() => ({ snapshot: snapshotState(initial), dispose: () => undefined }));

    const transaction = root.transact(() => ({
      snapshot: {
        ...snapshotState(candidateSnapshot),
        projections: new Map([[adapterFeatureId, projection.value]]),
      },
      handoff: handoff.seal(),
      dispose: projection.dispose ?? (() => undefined),
    }));
    await vi.waitFor(() => expect(events).toContain('start'));
    const stopping = root.stop();

    await expect(transaction).rejects.toThrow('stopping');
    await expect(stopping).resolves.toBeUndefined();
    expect(events).toEqual(['start', 'stop']);
    expect(root.state).toBe('stopped');
  });

  it('rejects missing Endpoint configuration instead of publishing an inert stub', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'broken',
      source: '/adapters/broken/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => { throw new TypeError('icqq requires uin'); },
      }),
    });
    await expect(createAdapterIndex([slot], snapshot([slot])))
      .rejects.toThrow('icqq requires uin');
  });

  it('opens a candidate behind generation admission without quiescing the previous index', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const endpointSlot = (version: string) => createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint: () => new TestEndpoint({
          start: () => { events.push(`${version}:start`); },
          open: () => { events.push(`${version}:open`); },
          close: () => { events.push(`${version}:close`); },
          stop: () => { events.push(`${version}:stop`); },
        }),
      }),
    });
    const oldSlot = endpointSlot('old');
    const oldProjection = await adapterFeature.runtime.project([oldSlot], {
      snapshot: snapshot([oldSlot]),
      signal: new AbortController().signal,
    });
    await oldProjection.handoff?.activateNext?.(new AbortController().signal);
    const candidateSlot = endpointSlot('next');
    const candidate = await adapterFeature.runtime.project([candidateSlot], {
      snapshot: snapshot([candidateSlot]),
      signal: new AbortController().signal,
    });

    await candidate.handoff?.activateNext?.(new AbortController().signal);
    await candidate.handoff?.deactivateNext?.();
    await candidate.dispose?.();
    await oldProjection.dispose?.();

    expect(events).toEqual([
      'old:start',
      'old:open',
      'next:start',
      'next:open',
      'next:close',
      'next:stop',
      'old:close',
      'old:stop',
    ]);
  });

  it('binds endpoint ingress to the AdapterIndex generation admission', async () => {
    const root = rootPluginId();
    const accepted: string[] = [];
    const ingressToken = createToken<{ receive(value: string): boolean }>('test.ingress');
    const ingress = {
      receive(value: string): boolean {
        accepted.push(`unbound:${value}`);
        return true;
      },
      [generationAdmissionBinder](gate: GenerationAdmissionGate) {
        return Object.freeze({
          receive: (value: string) => gate.enter(() => {
            accepted.push(value);
            return true;
          }) ?? false,
        });
      },
    };
    let receive!: (value: string) => boolean;
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint(context) {
          receive = context.use(ingressToken).receive;
          return new TestEndpoint({});
        },
      }),
    });
    const candidateSnapshot = snapshot([slot], undefined, new Map([[ingressToken.id, ingress]]));
    const index = await createAdapterIndex([slot], candidateSnapshot);

    expect(receive('candidate')).toBe(false);
    const store = new SnapshotStore({
      ...snapshotState(candidateSnapshot),
      projections: new Map([[adapterFeatureId, index]]),
    });
    expect(receive('committed')).toBe(true);

    store.commit(0, {
      snapshot: { ...snapshotState(candidateSnapshot), projections: new Map() },
      dispose: () => index.stop(),
    });
    expect(receive('retired')).toBe(false);
    expect(accepted).toEqual(['committed']);
    await store.close();
  });

  it('bounds candidate events and exposes overflow and replay failures without payloads', async () => {
    class PublishingEndpoint extends TestEndpoint {
      publish() { return this[endpointSpec].events.emit('message.receive', { content: 'private payload' }); }
    }
    const endpoint = new PublishingEndpoint({});
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'buffer', source: '/adapters/buffer/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => endpoint }),
    });
    const candidate = snapshot([slot], undefined, new Map([[endpointEventGatewayToken.id, {
      async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); },
      receive: async () => { throw new Error('private error'); },
    }]]));
    const index = await createAdapterIndex([slot], candidate);
    for (let i = 0; i < 257; i += 1) await endpoint.publish();
    expect(index.describe()[0]!.eventDiagnostics!).toEqual({ buffered: 256, dropped: 1, dispatchFailures: 0 });
    const store = new SnapshotStore({ ...snapshotState(candidate), projections: new Map([[adapterFeatureId, index]]) });
    await vi.waitFor(() => expect(index.describe()[0]!.eventDiagnostics!.dispatchFailures).toBe(256));
    expect(index.describe()[0]?.eventDiagnostics).toEqual({ buffered: 0, dropped: 1, dispatchFailures: 256 });
    await store.close();
  });

  it('settles every reliable buffered event when a gateway throws synchronously', async () => {
    class ReliableEndpoint extends TestEndpoint {
      publish() { return this[endpointSpec].events.emitAccepted('message.receive', {}); }
    }
    const endpoint = new ReliableEndpoint({});
    let count = 0;
    const receive = vi.fn(() => { if (++count === 1) throw new Error('sync receive failure'); return Promise.resolve('accepted'); });
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'sync-buffer', source: '/adapters/sync-buffer/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => endpoint }) });
    const candidate = snapshot([slot], undefined, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive }]]));
    const index = await createAdapterIndex([slot], candidate); await index.start(); index.open();
    const first = endpoint.publish(); const failed = expect(first).rejects.toThrow('dispatch failed');
    const second = endpoint.publish();
    const store = new SnapshotStore({ ...snapshotState(candidate), projections: new Map([[adapterFeatureId, index]]) });
    await failed; await expect(second).resolves.toBe('accepted');
    expect(receive).toHaveBeenCalledTimes(2);
    expect(index.describe()[0]!.eventDiagnostics!.dispatchFailures).toBe(1);
    await store.close();
  });

  it('does not confirm queued events if retirement occurs inside the first dispatch', async () => {
    class ReliableEndpoint extends TestEndpoint {
      publish() { return this[endpointSpec].events.emitAccepted('message.receive', {}); }
    }
    const endpoint = new ReliableEndpoint({});
    const receive = vi.fn(() => { retireEndpoint(endpoint); return Promise.resolve('entered before retirement'); });
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'retiring-buffer', source: '/adapters/retiring-buffer/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => endpoint }) });
    const candidate = snapshot([slot], undefined, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive }]]));
    const index = await createAdapterIndex([slot], candidate); await index.start(); index.open();
    const first = endpoint.publish(), second = endpoint.publish();
    const rejected = expect(second).rejects.toThrow('retired before event admission');
    const store = new SnapshotStore({ ...snapshotState(candidate), projections: new Map([[adapterFeatureId, index]]) });
    await expect(first).resolves.toBe('entered before retirement'); await rejected;
    expect(receive).toHaveBeenCalledOnce(); await store.close();
  });

  it('reports unobserved native transport health as unknown after readiness resolves', async () => {
    class UnobservedEndpoint extends TestEndpoint { override get transportState() { return undefined; } }
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'unobserved', source: '/adapters/unobserved/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new UnobservedEndpoint({}) }) });
    const index = await createAdapterIndex([slot], snapshot([slot])); await index.start(); index.open();
    expect(index.describe()[0]).toMatchObject({ admitted: true, connected: false, status: 'offline', transportState: 'unknown' });
    await index.stop(); expect(index.describe()[0]).toMatchObject({ connected: false, transportState: 'stopped' });
  });

  it('settles start cancellation when endpoint stop throws synchronously', async () => {
    const controller = new AbortController();
    const stop = vi.fn(() => { throw new Error('sync stop failure'); });
    let entered = false;
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'sync-stop', source: '/adapters/sync-stop/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new TestEndpoint({ start() { entered = true; return new Promise(() => {}); }, stop }) }) });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    const starting = index.start(controller.signal);
    const rejected = expect(starting).rejects.toThrow('cleanup');
    await vi.waitFor(() => expect(entered).toBe(true)); controller.abort(new Error('cancelled'));
    await rejected; expect(stop).toHaveBeenCalled();
  });

  it('does not acknowledge reliable candidate events until actual dispatch completes', async () => {
    class ReliableEndpoint extends TestEndpoint {
      publish() { return this[endpointSpec].events.emitAccepted('message.receive', {}); }
    }
    const endpoint = new ReliableEndpoint({});
    let finish!: () => void;
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'reliable', source: '/adapters/reliable/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => endpoint }),
    });
    const candidate = snapshot([slot], undefined, new Map([[endpointEventGatewayToken.id, {
      async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); },
      receive: () => new Promise<void>((resolve) => { finish = resolve; }),
    }]]));
    const index = await createAdapterIndex([slot], candidate);
    await index.start(); index.open();
    const acknowledged = vi.fn();
    const publishing = endpoint.publish().then(acknowledged);
    await Promise.resolve();
    expect(acknowledged).not.toHaveBeenCalled();
    const store = new SnapshotStore({ ...snapshotState(candidate), projections: new Map([[adapterFeatureId, index]]) });
    expect(acknowledged).not.toHaveBeenCalled();
    finish(); await publishing;
    expect(acknowledged).toHaveBeenCalledOnce();
    await store.close();
  });

  it('rejects reliable candidate events on overflow and rollback', async () => {
    class ReliableEndpoint extends TestEndpoint {
      publish() { return this[endpointSpec].events.emitAccepted('message.receive', {}); }
    }
    const endpoint = new ReliableEndpoint({});
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'reliable', source: '/adapters/reliable/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => endpoint }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    const first = endpoint.publish();
    const firstResult = first.catch((error: Error) => error.message);
    const buffered = Array.from({ length: 256 }, () => endpoint.publish().catch((error: Error) => error.message));
    expect(await firstResult).toContain('overflow');
    await index.stop();
    expect(await Promise.all(buffered)).toEqual(Array(256).fill('Endpoint generation retired before event admission'));
    await expect(endpoint.publish()).rejects.toThrow('retired');
  });

  it('replays actual native pre-commit events with the same Client after admission opens', async () => {
    const received: EndpointEvent[] = [], endpoint = new TestEndpoint({});
    const slot = createCapabilitySlot({ owner: rootPluginId(), feature: adapterFeatureId, localName: 'native', source: '/adapters/native/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => endpoint }) });
    const candidate = snapshot([slot], undefined, new Map([[endpointEventGatewayToken.id, { async run<T>(this: import('@zhin.js/adapter').EndpointEventGateway, receive: (receipt: import('@zhin.js/adapter').EndpointReceipt) => T | Promise<T>) { return receive(this); }, receive: async (event: EndpointEvent) => { received.push(event); } }]]));
    const index = await createAdapterIndex([slot], candidate); await index.start();
    await endpoint[endpointSpec].events.message({ conversation: { kind: 'private', id: 'room-1' }, content: 'hello', sender: { id: 'user-1' } });
    expect(received).toEqual([]);
    const store = new SnapshotStore({ ...snapshotState(candidate), projections: new Map([[adapterFeatureId, index]]) });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ name: 'message.receive', payload: { conversation: { kind: 'private', id: 'room-1', endpoint: { id: slot.id, adapter: 'native' } }, content: 'hello' } });
    expect(received[0].client).toBe(endpoint); await store.close(); await index.stop();
  });

  it('describes endpoint status and resolves Console adapter/endpoint pairs', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'sandbox',
      source: '/adapters/sandbox/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound', 'outbound'],
        createEndpoint: () => new TestEndpoint({
          send: async () => 'ok',
        }),
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    expect(index.describe()).toEqual([expect.objectContaining({
      name: 'sandbox',
      connected: false,
      status: 'offline',
    })]);
    await index.start();
    index.open();
    expect(index.describe()[0]).toMatchObject({ connected: true, status: 'online' });
    expect(index.resolve('sandbox', 'sandbox')).toBe(slot.id);
    expect(index.resolve('missing', 'sandbox')).toBeUndefined();
  });

  it('separates generation admission from live transport health', async () => {
    let transport: 'open' | 'reconnecting' | 'closed' = 'open';
    class LiveEndpoint extends TestEndpoint {
      override get transportState() { return transport; }
    }
    const slot = createCapabilitySlot({
      owner: rootPluginId(), feature: adapterFeatureId, localName: 'live',
      source: '/adapters/live/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new LiveEndpoint({}) }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    await index.start();
    index.open();
    expect(index.describe()[0]).toMatchObject({ admitted: true, connected: true, transportState: 'open' });
    transport = 'reconnecting';
    expect(index.describe()[0]).toMatchObject({ admitted: true, connected: false, phase: 'reconnecting' });
    transport = 'closed';
    expect(index.describe()[0]).toMatchObject({ admitted: true, connected: false, status: 'offline' });
    transport = 'open';
    expect(index.describe()[0]?.connected).toBe(true);
    await index.stop();
    expect(index.describe()[0]).toMatchObject({ admitted: false, connected: false, transportState: 'stopped' });
  });

  it('resolves Console pairs by the live Endpoint identity (bot uin)', async () => {
    const root = rootPluginId();
    const slotA = createCapabilitySlot({
      owner: childPluginId(root, 'icqq'),
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq-a/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound', 'outbound'],
        createEndpoint: () => new TestEndpoint({
          name: '111111',
          send: async () => 'a',
        }),
      }),
    });
    const slotB = createCapabilitySlot({
      owner: childPluginId(root, 'icqq-2'),
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq-b/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound', 'outbound'],
        createEndpoint: () => new TestEndpoint({
          name: '222222',
          send: async () => 'b',
        }),
      }),
    });
    const index = await createAdapterIndex([slotA, slotB], snapshot([slotA, slotB]));
    expect(index.resolve('icqq', '111111')).toBe(slotA.id);
    expect(index.resolve('icqq', '222222')).toBe(slotB.id);
    expect(index.resolve('icqq', '999999')).toBeUndefined();
    expect(index.connection('icqq', '222222')).toMatchObject({ name: '222222' });
  });

  it('expands an endpoints array into one record per entry with merged config', async () => {
    const root = rootPluginId();
    const seen: Array<{ id: string; config: Record<string, unknown> }> = [];
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound'],
        createEndpoint(context) {
          seen.push({ id: String(context.id), config: context.config as Record<string, unknown> });
          return new TestEndpoint({ start() {}, stop() {} });
        },
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot], new Map([[root, {
      master: '1659488338',
      endpoints: [
        { id: '111111' },
        { id: '222222', outboundMedia: 'base64' },
      ],
    }]])));

    expect(index.describe()).toHaveLength(2);
    expect(new Set(index.describe().map((summary) => summary.id)).size).toBe(2);
    expect(seen).toHaveLength(2);
    // 顶层字段共享，entry 逐项覆盖；endpoints 键不传给适配器
    expect(seen[0].config).toMatchObject({ id: '111111', master: '1659488338' });
    expect(seen[1].config).toMatchObject({ id: '222222', master: '1659488338', outboundMedia: 'base64' });
    expect(seen[0].config).not.toHaveProperty('endpoints');
    expect(seen[0].id).toContain('~111111');
    expect(seen[1].id).toContain('~222222');
  });

  it('rejects malformed or duplicate endpoint identities', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory/index.ts',
      definition: defineFixtureAdapter({ capabilities: ['inbound'], createEndpoint: () => new TestEndpoint({}) }),
    });

    await expect(createAdapterIndex([slot], snapshot([slot], new Map([[root, {
      endpoints: [{ id: 'same' }, { id: 'same' }],
    }]])))).rejects.toThrow('duplicated');
    await expect(createAdapterIndex([slot], snapshot([slot], new Map([[root, {
      endpoints: [{ name: 'missing-id' }],
    }]])))).rejects.toThrow('non-empty string');
  });

  it('resolves expanded endpoints by slot~entry localName ($adapter from messages)', async () => {
    // 入站消息的 $adapter 是 CapabilityId 的 localName 段（展开后形如 `icqq~8596238`），
    // activity-feedback / OutboundHost 用它 + live endpoint 名回解析。
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq/index.ts',
      definition: defineFixtureAdapter({
        capabilities: ['inbound', 'outbound'],
        createEndpoint: (context) => new TestEndpoint({
          name: (context.config as { id?: string }).id,
          send: async () => 'ok',
        }),
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot], new Map([[root, {
      endpoints: [{ id: '8596238' }, { id: '1234567' }],
    }]])));

    expect(index.resolve('icqq~8596238', '8596238')).toBe(`${slot.id}~8596238`);
    expect(index.resolve('icqq~1234567', '1234567')).toBe(`${slot.id}~1234567`);
    // 错误的 adapter/endpoint 组合不得命中其它 record
    expect(index.resolve('icqq~8596238', '1234567')).toBeUndefined();
    expect(index.resolve('missing~8596238', '8596238')).toBeUndefined();
    expect(index.connection('icqq~8596238', '8596238')).toMatchObject({ name: '8596238' });
  });
});

describe('defineAdapter segments policy', () => {
  const createEndpoint = () => new TestEndpoint({});

  it('defaults segments to undefined（未声明 = 未迁移，宽松）', () => {
    const definition = defineFixtureAdapter({ capabilities: ['outbound'], createEndpoint });
    expect(definition.segments).toBeUndefined();
    expect(parseAdapterDefinition(definition).segments).toBeUndefined();
  });

  it('accepts outboundMedia / interactive / markdown declarations, deduped and frozen', () => {
    const definition = defineFixtureAdapter({
      capabilities: ['outbound'],
      segments: { outboundMedia: ['url', 'base64', 'url'], interactive: 'text', markdown: 'native' },
      createEndpoint,
    });
    expect(definition.segments).toEqual({
      outboundMedia: ['url', 'base64'],
      interactive: 'text',
      markdown: 'native',
    });
    expect(Object.isFrozen(definition.segments)).toBe(true);
    expect(Object.isFrozen(definition.segments?.outboundMedia)).toBe(true);
    expect(parseAdapterDefinition(definition)).toBe(definition);
  });

  it('rejects invalid segments shapes', () => {
    const defineWithSegments = (segments: unknown) => () => defineFixtureAdapter({
      capabilities: ['outbound'],
      segments: segments as AdapterSegmentPolicy,
      createEndpoint,
    });
    expect(defineWithSegments('native')).toThrow('segments');
    expect(defineWithSegments({ outboundMedia: [] })).toThrow('outboundMedia');
    expect(defineWithSegments({ outboundMedia: 'base64' })).toThrow('outboundMedia');
    expect(defineWithSegments({ outboundMedia: ['ftp'] })).toThrow('outboundMedia');
    expect(defineWithSegments({ interactive: 'button' })).toThrow('interactive');
    expect(defineWithSegments({ markdown: 'html' })).toThrow('markdown');
    expect(defineWithSegments({ model: [] })).toThrow('segments.model');
    expect(defineWithSegments({ model: { share: { fields: [''] } } })).toThrow('segments.model');
    expect(defineWithSegments({ model: { share: { hint: ' ' } } })).toThrow('segments.model');
    expect(defineWithSegments({ model: { share: { scopes: ['dm'] } } })).toThrow('segments.model');
    expect(defineWithSegments({ model: { share: { scopes: [] } } })).toThrow('segments.model');
    expect(defineWithSegments({ reaction: { values: [] } })).toThrow('segments.reaction');
    expect(defineWithSegments({ reaction: { values: [{ value: '76', label: ' ' }] } })).toThrow('segments.reaction');
    expect(defineWithSegments({ reaction: { values: [{ value: '76', label: '赞' }], scopes: ['dm'] } })).toThrow('segments.reaction');
  });

  it('accepts reactions with labels, deduped by value and frozen', () => {
    const definition = defineFixtureAdapter({
      capabilities: ['outbound'],
      segments: { reaction: { values: [{ value: '76', label: ' 赞 ' }, { value: '76', label: '赞' }], scopes: ['group', 'group'] } },
      createEndpoint,
    });
    expect(definition.segments?.reaction).toEqual({ values: [{ value: '76', label: '赞' }], scopes: ['group'] });
    expect(Object.isFrozen(definition.segments?.reaction?.values)).toBe(true);
  });

  it('accepts model extensions per segment type, deduped and frozen', () => {
    const definition = defineFixtureAdapter({
      capabilities: ['outbound'],
      segments: { supported: ['text', 'share'], model: { share: { fields: ['audio', 'audio'], hint: ' music card ', scopes: ['group', 'group'] } } },
      createEndpoint,
    });
    expect(definition.segments?.model).toEqual({ share: { fields: ['audio'], hint: 'music card', scopes: ['group'] } });
    expect(Object.isFrozen(definition.segments?.model?.share?.scopes)).toBe(true);
    expect(Object.isFrozen(definition.segments?.model?.share)).toBe(true);
  });

  it('parseAdapterDefinition rejects invalid segments on hand-built definitions', () => {
    const definition = defineFixtureAdapter({ capabilities: ['outbound'], createEndpoint });
    expect(() => parseAdapterDefinition({
      ...definition,
      segments: { outboundMedia: ['url', 'cdn'] },
    })).toThrow('outboundMedia');
    expect(() => parseAdapterDefinition({
      ...definition,
      segments: { interactive: 'fancy' },
    })).toThrow('interactive');
    expect(() => parseAdapterDefinition({
      ...definition,
      segments: { markdown: 'rich' },
    })).toThrow('markdown');
  });
});

function createAdapterIndex(
  slots: Parameters<typeof AdapterIndex.create>[0],
  value: Parameters<typeof AdapterIndex.create>[1],
) {
  return AdapterIndex.create(slots, value, new AbortController().signal);
}

function snapshot(
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
  configs?: ReadonlyMap<ReturnType<typeof rootPluginId>, Record<string, unknown>>,
  rootResources: ReadonlyMap<TokenId, unknown> = new Map(),
): RuntimeSnapshot {
  const root = rootPluginId();
  const tree = new Map<PluginId, {
    id: PluginId;
    instanceKey: string;
    packageName: string;
    packageRoot: string;
    children: PluginId[];
  }>([[root, {
    id: root,
    instanceKey: 'root',
    packageName: '@test/root',
    packageRoot: '/project',
    children: [],
  }]]);
  for (const slot of slots) {
    if (tree.has(slot.owner)) continue;
    const instanceKey = String(slot.owner).split('/').pop() ?? 'child';
    tree.set(slot.owner, {
      id: slot.owner,
      instanceKey,
      packageName: `@test/${instanceKey}`,
      packageRoot: '/project',
      children: [],
    });
    tree.get(root)!.children.push(slot.owner);
  }
  return {
    generation: 1,
    root,
    tree,
    config: new Map([[root, configs?.get(root) ?? {}], ...slots.map((slot) => [slot.owner, configs?.get(slot.owner as ReturnType<typeof rootPluginId>) ?? {}] as const)]),
    resources: new Map([
      [root, new Map([
        ...rootResources,
        ...(!rootResources.has(endpointEventGatewayToken.id)
          ? [[endpointEventGatewayToken.id, testEndpointEvents] as const]
          : []),
      ])],
      ...slots.filter((slot) => slot.owner !== root).map((slot) => [
        slot.owner,
        new Map([[endpointEventGatewayToken.id, testEndpointEvents]]),
      ] as const),
    ]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

function snapshotState(snapshot: RuntimeSnapshot): Omit<RuntimeSnapshot, 'generation'> {
  const { generation: _generation, ...state } = snapshot;
  return state;
}

class MemoryDiscoveryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly modules: ReadonlyMap<string, unknown>,
  ) {}
  async list(directory: string): Promise<readonly DirectoryEntry[]> {
    return this.directories[directory] ?? [];
  }
  async loadModule<T>(source: string): Promise<T> {
    const module = this.modules.get(source);
    if (!module) throw new Error(`Missing module: ${source}`);
    return module as T;
  }
  async readText(): Promise<string> { throw new Error('Not implemented'); }
}
