import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  childPluginId,
  rootPluginId,
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
  isAdapterIndex,
  parseAdapterDefinition,
  resolveEndpointManagement,
} from '../src/index.js';

describe('Adapter Feature', () => {
  it('exposes endpoint management only through the explicit semantic port', async () => {
    const listFriends = async () => [{ user_id: 1, nickname: 'Ada', remark: '' }];
    const management = resolveEndpointManagement({ management: { listFriends } });

    await expect(management?.listFriends?.()).resolves.toEqual([
      { user_id: 1, nickname: 'Ada', remark: '' },
    ]);
    expect(resolveEndpointManagement({ friends: new Map() })).toBeUndefined();
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
    const index = await AdapterIndex.create([slot], value);
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

  it('soft-fails Endpoint create and keeps other Endpoints', async () => {
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

    const index = await AdapterIndex.create([broken, good], snapshot([good, broken]));
    await index.start();
    expect(events).toEqual(['start-good']);
    await index.stop();
    expect(events).toEqual(['start-good', 'stop-good']);
  });

  it('defers slow Endpoint start instead of stop()-ing mid-connect', async () => {
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
    const index = await AdapterIndex.create([slot], snapshot([slot]), { startTimeoutMs: 20 });
    await index.start();
    expect(events).toEqual(['start-begin']);
    index.open();
    expect(events).toEqual(['start-begin']);
    resolveStart();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['start-begin', 'start-done', 'open']);
    await index.stop();
    expect(events.at(-1)).toBe('stop');
  });

  it('gives up on a never-settling deferred start and reports the failed phase', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'wedged',
      source: '/adapters/wedged.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({
          // Never settles — the deferred give-up budget must close it out.
          start: () => new Promise<void>(() => undefined),
          stop: () => undefined,
        }),
      }),
    });
    const index = await AdapterIndex.create([slot], snapshot([slot]), {
      startTimeoutMs: 20,
      deferredGiveUpMs: 60,
    });
    expect(index.describe()[0]).toMatchObject({ phase: 'pending', connected: false });

    await index.start();
    expect(index.describe()[0]).toMatchObject({ phase: 'starting', connected: false });

    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(index.describe()[0]).toMatchObject({
      phase: 'failed',
      connected: false,
      status: 'offline',
    });
    await index.stop();
  });

  it('reports the unconfigured phase for soft-failed Endpoint create', async () => {
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
    const index = await AdapterIndex.create([slot], snapshot([slot]));
    await index.start();
    expect(index.describe()[0]).toMatchObject({ phase: 'unconfigured', status: 'offline' });
    await index.stop();
  });

  it('hands admission from the previous projection to the candidate and can resume it', async () => {
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
    });
    await oldProjection.handoff?.activateNext?.();
    oldProjection.handoff?.openNext?.();
    const candidateSlot = endpointSlot('next');
    const candidate = await adapterFeature.runtime.project([candidateSlot], {
      snapshot: snapshot([candidateSlot]),
    });
    const previous = {
      ...snapshot([oldSlot]),
      projections: new Map([[adapterFeatureId, oldProjection.value]]),
    };

    await candidate.handoff?.quiescePrevious?.(previous);
    await candidate.handoff?.activateNext?.();
    await candidate.handoff?.deactivateNext?.();
    await candidate.handoff?.resumePrevious?.();
    await candidate.dispose?.();
    await oldProjection.dispose?.();

    expect(events).toEqual([
      'old:start',
      'old:open',
      'old:close',
      'next:start',
      'next:stop',
      'old:open',
      'old:close',
      'old:stop',
    ]);
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
    const index = await AdapterIndex.create([slot], snapshot([slot]));
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
    const index = await AdapterIndex.create([slotA, slotB], snapshot([slotA, slotB]));
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
    const index = await AdapterIndex.create([slot], snapshot([slot], new Map([[root, {
      master: '1659488338',
      endpoints: [
        { name: '111111' },
        { name: '222222', outboundMedia: 'base64' },
      ],
    }]])));

    expect(index.describe()).toHaveLength(2);
    expect(new Set(index.describe().map((summary) => summary.id)).size).toBe(2);
    expect(seen).toHaveLength(2);
    // 顶层字段共享，entry 逐项覆盖；endpoints 键不传给适配器
    expect(seen[0].config).toMatchObject({ name: '111111', master: '1659488338' });
    expect(seen[1].config).toMatchObject({ name: '222222', master: '1659488338', outboundMedia: 'base64' });
    expect(seen[0].config).not.toHaveProperty('endpoints');
    expect(seen[0].id).toContain('~111111');
    expect(seen[1].id).toContain('~222222');
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
          name: (context.config as { name?: string }).name,
          send: async () => 'ok',
        }),
      }),
    });
    const index = await AdapterIndex.create([slot], snapshot([slot], new Map([[root, {
      endpoints: [{ name: '8596238' }, { name: '1234567' }],
    }]])));

    expect(index.resolve('icqq~8596238', '8596238')).toBe(`${slot.id}~8596238`);
    expect(index.resolve('icqq~1234567', '1234567')).toBe(`${slot.id}~1234567`);
    // 错误的 adapter/endpoint 组合不得命中其它 record
    expect(index.resolve('icqq~8596238', '1234567')).toBeUndefined();
    expect(index.resolve('missing~8596238', '8596238')).toBeUndefined();
    expect(index.instance('icqq~8596238', '8596238')).toMatchObject({ name: '8596238' });
  });
});

function snapshot(
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
  configs?: ReadonlyMap<ReturnType<typeof rootPluginId>, Record<string, unknown>>,
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
    resources: new Map([[root, new Map()], ...slots.map((slot) => [slot.owner, new Map()] as const)]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
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
