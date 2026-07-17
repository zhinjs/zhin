import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
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
  parseAdapterDefinition,
} from '../src/index.js';

describe('Adapter Feature', () => {
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

  it('compensates already-created Endpoints when candidate creation fails', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const good = createCapabilitySlot({
      owner: root,
      feature: adapterFeatureId,
      localName: 'a-good',
      source: '/adapters/a-good.ts',
      definition: defineAdapter({
        capabilities: ['inbound'],
        create: () => ({ stop: () => { events.push('stop-good'); } }),
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

    await expect(AdapterIndex.create([broken, good], snapshot([good, broken])))
      .rejects.toThrow('create failed');
    expect(events).toEqual(['stop-good']);
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
});

function snapshot(
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
): RuntimeSnapshot {
  const root = rootPluginId();
  return {
    generation: 1,
    root,
    tree: new Map([[root, {
      id: root,
      instanceKey: 'root',
      packageName: '@test/root',
      packageRoot: '/project',
      children: [],
    }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map()]]),
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
