import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  featureId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import middlewareFeature, {
  MiddlewareIndex,
  defineMiddleware,
  isMiddlewareIndex,
  middlewareFeatureId,
  parseMiddlewareDefinition,
} from '../src/index.js';

interface MiddlewareTestClient {
  readonly id: string;
}

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly 'middleware-test': {
      readonly client: MiddlewareTestClient;
      readonly events: Record<string, unknown>;
    };
  }
}

describe('Middleware Feature', () => {
  it('binds a reused projection to each operation snapshot while an old chain drains', async () => {
    const root = rootPluginId();
    const probe = featureId('test.operation-projection');
    const observations: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slot = createCapabilitySlot({
      owner: root, feature: middlewareFeatureId, localName: 'probe',
      source: '/middlewares/probe/index.ts',
      definition: defineMiddleware<{ delayed: boolean }>({
        async handle(context, next) {
          if (context.input.delayed) await gate;
          observations.push([context.generation, context.project(probe)]);
          await next();
        },
      }),
    });
    const old = { ...snapshot(root, undefined, [slot]), projections: new Map([[probe, 'old']]) };
    const current = { ...old, generation: 2, projections: new Map([[probe, 'current']]) };
    const index = new MiddlewareIndex([slot], old);
    const draining = index.run({ delayed: true }, undefined, 'inbound', old);
    await index.run({ delayed: false }, undefined, 'inbound', current);
    expect(observations).toEqual([[2, 'current']]);
    release();
    await draining;
    expect(observations).toEqual([[2, 'current'], [1, 'old']]);
  });

  it('brands definitions and validates normalized phase/order metadata', () => {
    const middleware = defineMiddleware({ handle: (_context, next) => next() });
    expect(middleware.phase).toBe('before-dispatch');
    expect(middleware.order).toBe(0);
    expect(parseMiddlewareDefinition(middleware)).toBe(middleware);
    expect(() => parseMiddlewareDefinition({ handle() {} })).toThrow('defineMiddleware');
    expect(() => defineMiddleware({ order: 1.5, handle() {} })).toThrow('safe integer');
  });

  it('discovers named middleware modules and ignores helpers', async () => {
    const definition = defineMiddleware({ handle: (_context, next) => next() });
    const source = '/project/middlewares/auth/index.ts';
    const host = new MemoryDiscoveryHost({
      '/project/middlewares': [
        { name: 'auth', kind: 'directory' },
        { name: 'ignored.tsx', kind: 'file' },
      ],
      '/project/middlewares/auth': [
        { name: 'index.ts', kind: 'file' },
        { name: 'helper.ts', kind: 'file' },
      ],
    }, new Map([[source, { default: definition }]]));

    const slots = await new FeatureDiscovery(host).discover(middlewareFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['auth']);
  });

  it('composes deterministic phase/order/topology execution and unwinds after next', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const events: string[] = [];
    const slot = (
      owner: typeof root,
      localName: string,
      phase: 'before-dispatch' | 'after-dispatch',
      order: number,
    ) => createCapabilitySlot({
      owner,
      feature: middlewareFeatureId,
      localName,
      source: `/middlewares/${localName}/index.ts`,
      definition: defineMiddleware<{ value: string }>({
        phase,
        order,
        async handle({ input }, next) {
          events.push(`${localName}:enter:${input.value}`);
          await next();
          events.push(`${localName}:exit`);
        },
      }),
    });
    const slots = [
      slot(root, 'root', 'before-dispatch', 10),
      slot(child, 'child', 'before-dispatch', -1),
      slot(root, 'after', 'after-dispatch', -100),
    ];
    const index = new MiddlewareIndex(slots, snapshot(root, child, slots));
    expect(isMiddlewareIndex(index)).toBe(true);
    expect(isMiddlewareIndex({ $projection: 'zhin.middleware-index/1' })).toBe(true);

    await index.run({ value: 'message' }, async () => { events.push('terminal'); });

    expect(index.list().map((item) => item.name)).toEqual(['child', 'root', 'after']);
    expect(events).toEqual([
      'child:enter:message',
      'root:enter:message',
      'after:enter:message',
      'terminal',
      'after:exit',
      'root:exit',
      'child:exit',
    ]);
  });

  it('rejects calling next more than once', async () => {
    const root = rootPluginId();
    const definition = defineMiddleware({
      async handle(_context, next) {
        await next();
        await next();
      },
    });
    const slot = createCapabilitySlot({
      owner: root,
      feature: middlewareFeatureId,
      localName: 'broken',
      source: '/middlewares/broken/index.ts',
      definition,
    });
    const index = new MiddlewareIndex([slot], snapshot(root, undefined, [slot]));

    await expect(index.run({})).rejects.toThrow('next() called more than once');
  });

  it('isolates concurrent chains and preserves an async terminal failure through unwind', async () => {
    const root = rootPluginId();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const failure = new Error('terminal failed');
    const slot = createCapabilitySlot({
      owner: root, feature: middlewareFeatureId, localName: 'async', source: '/middlewares/async/index.ts',
      definition: defineMiddleware<{ id: string }>({
        async handle({ input }, next) {
          try { await next(); } finally { events.push(`unwind:${input.id}`); }
        },
      }),
    });
    const index = new MiddlewareIndex([slot], snapshot(root, undefined, [slot]));
    const failed = index.run({ id: 'failed' }, async () => { await gate; throw failure; });
    const rejection = expect(failed).rejects.toBe(failure);
    await index.run({ id: 'healthy' }, async () => { events.push('healthy'); });
    expect(events).toEqual(['healthy', 'unwind:healthy']);
    release();
    await rejection;
    expect(events).toEqual(['healthy', 'unwind:healthy', 'unwind:failed']);
  });

  it('filters by adapter before lazily resolving $client', async () => {
    const root = rootPluginId();
    const client: MiddlewareTestClient = { id: 'client-1' };
    let reads = 0;
    const definition = defineMiddleware({
      adapter: 'middleware-test',
      handle(context) {
        expect(context.$client).toBe(client);
      },
    });
    const slot = createCapabilitySlot({
      owner: root,
      feature: middlewareFeatureId,
      localName: 'native-client',
      source: '/middlewares/native-client/index.ts',
      definition,
    });
    const index = new MiddlewareIndex([slot], snapshot(root, undefined, [slot]));

    await index.run({
      clientAdapter: 'other',
      get $client() { reads += 1; return client; },
    });
    expect(reads).toBe(0);

    await index.run({
      clientAdapter: 'middleware-test',
      get $client() { reads += 1; return client; },
    });
    expect(reads).toBe(1);
  });
});

function snapshot(
  root: ReturnType<typeof rootPluginId>,
  child: ReturnType<typeof childPluginId> | undefined,
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
): RuntimeSnapshot {
  const tree = new Map([[root, {
    id: root,
    instanceKey: 'root',
    packageName: '@test/root',
    packageRoot: '/project',
    children: child ? [child] : [],
  }]]);
  if (child) tree.set(child, {
    id: child,
    instanceKey: 'child',
    packageName: '@test/child',
    packageRoot: '/project/plugins/child',
    parent: root,
    children: [],
  });
  return {
    generation: 1,
    root,
    tree,
    config: new Map([...tree.keys()].map((owner) => [owner, {}])),
    resources: new Map([...tree.keys()].map((owner) => [owner, new Map()])),
    capabilities: new Map(slots.map((item) => [item.id, item])),
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
