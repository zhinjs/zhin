import { describe, expect, it } from 'vitest';
import {
  childPluginId,
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
  middlewareFeatureId,
  parseMiddlewareDefinition,
} from '../src/index.js';

describe('Middleware Feature', () => {
  it('brands definitions and validates normalized phase/order metadata', () => {
    const middleware = defineMiddleware({ handle: (_context, next) => next() });
    expect(middleware.phase).toBe('before-dispatch');
    expect(middleware.order).toBe(0);
    expect(parseMiddlewareDefinition(middleware)).toBe(middleware);
    expect(() => parseMiddlewareDefinition({ handle() {} })).toThrow('defineMiddleware');
    expect(() => defineMiddleware({ order: 1.5, handle() {} })).toThrow('safe integer');
  });

  it('discovers nested TypeScript files and ignores TSX middleware modules', async () => {
    const definition = defineMiddleware({ handle: (_context, next) => next() });
    const source = '/project/middlewares/auth/guard.ts';
    const host = new MemoryDiscoveryHost({
      '/project/middlewares': [
        { name: 'auth', kind: 'directory' },
        { name: 'ignored.tsx', kind: 'file' },
      ],
      '/project/middlewares/auth': [{ name: 'guard.ts', kind: 'file' }],
    }, new Map([[source, { default: definition }]]));

    const slots = await new FeatureDiscovery(host).discover(middlewareFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['auth/guard']);
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
      source: `/middlewares/${localName}.ts`,
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
      source: '/middlewares/broken.ts',
      definition,
    });
    const index = new MiddlewareIndex([slot], snapshot(root, undefined, [slot]));

    await expect(index.run({})).rejects.toThrow('next() called more than once');
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
