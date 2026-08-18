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
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import adapterFeature, {
  AdapterIndex,
  adapterFeatureId,
  defineAdapter,
  endpointCapabilitiesOf,
  isAdapterIndex,
  parseAdapterDefinition,
  endpointControlOf,
  resolveEndpointManagement,
  type AdapterSegmentPolicy,
} from '../src/index.js';

describe('Adapter Feature', () => {
  it('derives explicit endpoint operations from the adapter declaration', () => {
    const definition = defineAdapter({
      capabilities: ['inbound', 'outbound'],
      operations: ['recall', 'typing'],
      create: () => ({}),
    });

    expect(endpointCapabilitiesOf(definition)).toEqual({
      inbound: true,
      outbound: true,
      operations: { recall: true, typing: true },
    });
    expect(() => defineAdapter({
      capabilities: ['outbound'],
      operations: ['send' as never],
      create: () => ({}),
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

  it('requires declared operations to exist on an explicit control port', async () => {
    const root = rootPluginId();
    const invalid = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'invalid-control',
      source: '/adapters/invalid-control.ts',
      definition: defineAdapter({
        capabilities: ['outbound'],
        operations: ['edit', 'typing'],
        create: () => ({ control: { recall: async () => undefined } }),
      }),
    });
    await expect(createAdapterIndex([invalid], snapshot([invalid])))
      .rejects.toThrow('declares edit but control.edit is missing');

    const valid = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'valid-control',
      source: '/adapters/valid-control.ts',
      definition: defineAdapter({
        capabilities: ['outbound'],
        operations: ['recall', 'edit', 'reaction', 'typing'],
        create: () => ({
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

  it('forwards structured conversations alongside legacy targets', async () => {
    const root = rootPluginId();
    let received: unknown;
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['outbound'],
        create: () => ({ send: async (request) => { received = request; } }),
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
      target: 'group:room-1',
      conversation,
      payload: 'hello',
    });
    expect(received).toEqual({ target: 'group:room-1', conversation, payload: 'hello' });
    await index.stop();
  });

  it('brands definitions and discovers nested TypeScript modules', async () => {
    const definition = defineAdapter({
      capabilities: ['inbound', 'outbound'],
      create: () => ({}),
    });
    expect(parseAdapterDefinition(definition)).toBe(definition);
    expect(() => defineAdapter({ capabilities: [], create: () => ({}) })).toThrow(
      'capabilities',
    );

    const source = '/project/adapters/discord/bot.ts';
    const host = new MemoryDiscoveryHost({
      '/project/adapters': [{ name: 'discord', kind: 'directory' }],
      '/project/adapters/discord': [{ name: 'bot.ts', kind: 'file' }],
    }, new Map([[source, { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(adapterFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['discord/bot']);
  });

  it('injects Endpoint identity and owns start/open/close/stop exactly once', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'memory',
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['outbound'],
        create(context) {
          events.push(`create:${context.name}:${context.id}`);
          return {
            start() { events.push('start'); },
            open() { events.push('open'); },
            close() { events.push('close'); },
            stop() { events.push('stop'); },
            send({ target, payload }) {
              events.push(`send:${target}:${String(payload)}`);
              return 'sent';
            },
          };
        },
      }),
    });
    const value = snapshot([slot]);
    const index = await createAdapterIndex([slot], value);
    expect(isAdapterIndex(index)).toBe(true);
    expect(isAdapterIndex({ $projection: 'zhin.adapter-index/1' })).toBe(true);

    await index.start();
    index.open();
    await expect(index.send(slot.id, { target: 'room', payload: 'hello' })).resolves.toBe('sent');
    await index.close();
    index.open();
    await index.stop();
    await index.stop();

    expect(events).toEqual([
      `create:memory:${slot.id}`,
      'start',
      'open',
      'send:room:hello',
      'close',
      'open',
      'close',
      'stop',
    ]);
  });

  it('fails Endpoint creation closed and disposes already-created candidates', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const good = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'a-good',
      source: '/adapters/a-good.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
          start: () => { events.push('start-good'); },
          stop: () => { events.push('stop-good'); },
        }),
      }),
    });
    const broken = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'z-broken',
      source: '/adapters/z-broken.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => { throw new Error('create failed'); },
      }),
    });

    await expect(createAdapterIndex([broken, good], snapshot([good, broken])))
      .rejects.toThrow('create failed');
    expect(events).toEqual(['stop-good']);
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
      source: '/adapters/slow.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          async start() {
            events.push('start-begin');
            await started;
            events.push('start-done');
          },
          open() { events.push('open'); },
          stop() { events.push('stop'); },
        }),
      }),
    });
    const index = await createAdapterIndex([slot], snapshot([slot]));
    const activation = index.activate(new AbortController().signal);
    await Promise.resolve();
    expect(events).toEqual(['start-begin']);
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
      source: '/adapters/a-healthy.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
          start: () => { events.push('healthy:start'); },
          stop: () => { events.push('healthy:stop'); },
        }),
      }),
    });
    const broken = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'z-broken',
      source: '/adapters/z-broken.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
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
      source: '/adapters/broken-cleanup.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
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
      source: '/adapters/waiting.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
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
      source: '/adapters/broken.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => { throw new TypeError('icqq requires uin'); },
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
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
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
      source: '/adapters/memory.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create(context) {
          receive = context.use(ingressToken).receive;
          return {};
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

  it('describes endpoint status and resolves Console adapter/endpoint pairs', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'sandbox',
      source: '/adapters/sandbox.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
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

  it('resolves Console pairs by live EndpointInstance.name (bot uin)', async () => {
    const root = rootPluginId();
    const slotA = createCapabilitySlot({
      owner: childPluginId(root, 'icqq'),
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq-a.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          name: '111111',
          send: async () => 'a',
        }),
      }),
    });
    const slotB = createCapabilitySlot({
      owner: childPluginId(root, 'icqq-2'),
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq-b.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: () => ({
          name: '222222',
          send: async () => 'b',
        }),
      }),
    });
    const index = await createAdapterIndex([slotA, slotB], snapshot([slotA, slotB]));
    expect(index.resolve('icqq', '111111')).toBe(slotA.id);
    expect(index.resolve('icqq', '222222')).toBe(slotB.id);
    expect(index.resolve('icqq', '999999')).toBeUndefined();
    expect(index.instance('icqq', '222222')).toMatchObject({ name: '222222' });
  });

  it('expands an endpoints array into one record per entry with merged config', async () => {
    const root = rootPluginId();
    const seen: Array<{ id: string; config: Record<string, unknown> }> = [];
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'icqq',
      source: '/adapters/icqq.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create(context) {
          seen.push({ id: String(context.id), config: context.config as Record<string, unknown> });
          return { start() {}, stop() {} };
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
      source: '/adapters/memory.ts',
      definition: defineAdapter({ capabilities: ['inbound'], create: () => ({}) }),
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
      source: '/adapters/icqq.ts',
      definition: defineAdapter({
        capabilities: ['inbound', 'outbound'],
        create: (context) => ({
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
    expect(index.instance('icqq~8596238', '8596238')).toMatchObject({ name: '8596238' });
  });
});

describe('defineAdapter segments policy', () => {
  const create = () => ({});

  it('defaults segments to undefined（未声明 = 未迁移，宽松）', () => {
    const definition = defineAdapter({ capabilities: ['outbound'], create });
    expect(definition.segments).toBeUndefined();
    expect(parseAdapterDefinition(definition).segments).toBeUndefined();
  });

  it('accepts outboundMedia / interactive declarations, deduped and frozen', () => {
    const definition = defineAdapter({
      capabilities: ['outbound'],
      segments: { outboundMedia: ['url', 'base64', 'url'], interactive: 'text' },
      create,
    });
    expect(definition.segments).toEqual({
      outboundMedia: ['url', 'base64'],
      interactive: 'text',
    });
    expect(Object.isFrozen(definition.segments)).toBe(true);
    expect(Object.isFrozen(definition.segments?.outboundMedia)).toBe(true);
    expect(parseAdapterDefinition(definition)).toBe(definition);
  });

  it('rejects invalid segments shapes', () => {
    const defineWithSegments = (segments: unknown) => () => defineAdapter({
      capabilities: ['outbound'],
      segments: segments as AdapterSegmentPolicy,
      create,
    });
    expect(defineWithSegments('native')).toThrow('segments');
    expect(defineWithSegments({ outboundMedia: [] })).toThrow('outboundMedia');
    expect(defineWithSegments({ outboundMedia: 'base64' })).toThrow('outboundMedia');
    expect(defineWithSegments({ outboundMedia: ['ftp'] })).toThrow('outboundMedia');
    expect(defineWithSegments({ interactive: 'button' })).toThrow('interactive');
  });

  it('parseAdapterDefinition rejects invalid segments on hand-built definitions', () => {
    const definition = defineAdapter({ capabilities: ['outbound'], create });
    expect(() => parseAdapterDefinition({
      ...definition,
      segments: { outboundMedia: ['url', 'cdn'] },
    })).toThrow('outboundMedia');
    expect(() => parseAdapterDefinition({
      ...definition,
      segments: { interactive: 'fancy' },
    })).toThrow('interactive');
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
  rootResources: ReadonlyMap<string, unknown> = new Map(),
): RuntimeSnapshot {
  const root = rootPluginId();
  const tree = new Map<string, {
    id: typeof root;
    instanceKey: string;
    packageName: string;
    packageRoot: string;
    children: string[];
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
    tree: tree as RuntimeSnapshot['tree'],
    config: new Map([[root, configs?.get(root) ?? {}], ...slots.map((slot) => [slot.owner, configs?.get(slot.owner as ReturnType<typeof rootPluginId>) ?? {}] as const)]),
    resources: new Map([[root, rootResources], ...slots.filter((slot) => slot.owner !== root).map((slot) => [slot.owner, new Map()] as const)]),
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
