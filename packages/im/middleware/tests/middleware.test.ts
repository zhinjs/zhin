import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  featureId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
  type PluginId,
  type PluginNodeSnapshot,
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
  type MiddlewareContinuation,
  type MiddlewareNext,
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
  it('preserves a descendant author through three continuation frames', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const slots = [
      middlewareSlot(root, 'outer', 0, async (_context, next) => next()),
      middlewareSlot(root, 'middle', 1, async (_context, next) => { await next(); }),
      middlewareSlot(child, 'leaf', 2, () => 'same content'),
    ];
    const index = new MiddlewareIndex(slots, snapshot(root, child, slots));
    await expect(index.run({})).resolves.toEqual({ owner: child, value: 'same content' });
  });

  it.each(['other-frame', 'other-operation'] as const)('rejects a continuation from %s', async (source) => {
    const root = rootPluginId();
    let saved: MiddlewareContinuation | undefined;
    let reuse = false;
    const slots = [
      middlewareSlot(root, 'outer', 0, async (_context, next) => {
        await next();
        if (source === 'other-frame' || reuse) return saved;
      }),
      middlewareSlot(root, 'inner', 1, async (_context, next) => {
        const result = await next();
        if (!reuse) saved = result;
        return result;
      }),
    ];
    const index = new MiddlewareIndex(slots, snapshot(root, undefined, slots));
    if (source === 'other-operation') { await index.run({}); reuse = true; }
    await expect(index.run({})).rejects.toThrow('another frame or operation');
  });

  it('expires a saved next even when the input short-circuited', async () => {
    const root = rootPluginId();
    let saved!: MiddlewareNext;
    const slots = [middlewareSlot(root, 'stop', 0, (_context, next) => { saved = next; return 'done'; })];
    const index = new MiddlewareIndex(slots, snapshot(root, undefined, slots));
    await index.run({});
    expect(() => saved()).toThrow('scope has ended');
  });

  it('propagates a child failure even when its parent catches next and returns replacement content', async () => {
    const root = rootPluginId();
    const slots = [middlewareSlot(root, 'catch', 0, async (_context, next) => {
      try { await next(); } catch { return 'must not hide failure'; }
    })];
    const index = new MiddlewareIndex(slots, snapshot(root, undefined, slots));
    await expect(index.run({}, async () => { throw new Error('failed child'); })).rejects.toThrow('failed child');
  });

  it('returns inbound content from the general runner rather than dropping it', async () => {
    const root = rootPluginId();
    const slots = [middlewareSlot(root, 'reply', 0, () => ({ meaningful: 'result' }))];
    const index = new MiddlewareIndex(slots, snapshot(root, undefined, slots));
    await expect(index.run({})).resolves.toEqual({ owner: root, value: { meaningful: 'result' } });
  });

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

  it.each([
    { packageRoot: '/project', files: ['index.tsx', 'helper.tsx'], expected: 'index.tsx' },
    { packageRoot: '/project', files: ['index.tsx', 'index.js', 'helper.tsx'], expected: 'index.tsx' },
    { packageRoot: '/node_modules/@test/plugin', files: ['index.tsx', 'index.js', 'helper.tsx'], expected: 'index.js' },
  ])('discovers a TSX middleware and selects $expected in $packageRoot', async ({ packageRoot, files, expected }) => {
    const definition = defineMiddleware({ handle: () => 'card result' });
    const directory = `${packageRoot}/middlewares/card`;
    const source = `${directory}/${expected}`;
    const host = new MemoryDiscoveryHost({
      [`${packageRoot}/middlewares`]: [{ name: 'card', kind: 'directory' }, { name: 'ignored.tsx', kind: 'file' }],
      [directory]: files.map((name) => ({ name, kind: 'file' })),
    }, new Map([[source, { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(middlewareFeature, [{ owner: rootPluginId(), packageRoot }]);
    expect(slots.map((slot) => ({ name: slot.localName, source: slot.source }))).toEqual([{ name: 'card', source }]);
    expect(slots[0]?.definition).toBe(definition);
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

function middlewareSlot(
  owner: ReturnType<typeof rootPluginId>, name: string, order: number,
  handle: (context: unknown, next: MiddlewareNext) => unknown,
) {
  return createCapabilitySlot({ owner, feature: middlewareFeatureId, localName: name,
    source: `/middlewares/${name}/index.ts`, definition: defineMiddleware({ order, handle }),
  });
}

function snapshot(
  root: ReturnType<typeof rootPluginId>,
  child: ReturnType<typeof childPluginId> | undefined,
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
): RuntimeSnapshot {
  const tree = new Map<PluginId, PluginNodeSnapshot>([[root, {
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
