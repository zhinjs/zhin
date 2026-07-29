import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  CommandIndex,
  commandFeature,
  commandFeatureId,
  defineCommand,
  isCommandIndex,
  parseCommandDefinition,
} from '../src/index.js';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';

describe('Command Feature', () => {
  it('brands definitions without module-level registration', () => {
    const command = defineCommand({ execute: ({ args }) => args.join(' ') });
    expect(parseCommandDefinition(command)).toBe(command);
    expect(() => parseCommandDefinition({ execute() {} })).toThrow('defineCommand');
  });

  it('projects owner-bound slots into an executable index', async () => {
    const owner = rootPluginId();
    const command = defineCommand({ execute: ({ args }) => `hello ${args[0]}` });
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'hello',
      source: '/commands/hello.ts',
      definition: command,
    });
    const snapshot = {
      generation: 1,
      root: owner,
      tree: new Map([[owner, {
        id: owner,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/test',
        children: [],
      }]]),
      config: new Map([[owner, {}]]),
      resources: new Map([[owner, new Map()]]),
      capabilities: new Map([[slot.id, slot]]),
      projections: new Map(),
    } satisfies RuntimeSnapshot;
    const index = new CommandIndex([slot], snapshot);
    expect(isCommandIndex(index)).toBe(true);
    expect(isCommandIndex({ $projection: 'zhin.command-index/1' })).toBe(true);

    await expect(index.execute('hello', ['world'])).resolves.toBe('hello world');
    await expect(index.execute('missing')).rejects.toThrow('Unknown Command');
  });

  it('discovers nested files as hierarchical command words', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/issue/list.ts';
    const command = defineCommand({ execute: ({ args }) => `issues:${args.join(',')}` });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'issue', kind: 'directory' }],
      '/project/commands/gh/issue': [{ name: 'list.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots.map((slot) => slot.localName)).toEqual(['gh/issue/list']);

    const snapshot = {
      generation: 1,
      root: owner,
      tree: new Map([[owner, {
        id: owner,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/project',
        children: [],
      }]]),
      config: new Map([[owner, {}]]),
      resources: new Map([[owner, new Map()]]),
      capabilities: new Map(slots.map((slot) => [slot.id, slot])),
      projections: new Map(),
    } satisfies RuntimeSnapshot;
    const index = new CommandIndex(slots, snapshot);

    expect(index.list()).toEqual([{
      name: 'gh issue list',
      description: undefined,
      source,
      parameters: [],
    }]);
    await expect(index.execute('gh issue list', ['open', 'closed']))
      .resolves.toBe('issues:open,closed');
  });

  it('dispatches the longest command prefix with trailing args and source input', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/issue/list',
      source: '/commands/gh/issue/list.ts',
      definition: defineCommand<{}, string, { sender: string }>({
        execute: ({ args, input }) => `${input.sender}:${args.join(',')}`,
      }),
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    await expect(index.dispatch('gh issue list open assigned', { sender: 'alice' }))
      .resolves.toEqual({
        matched: true,
        command: 'gh issue list',
        owner,
        value: 'alice:open,assigned',
      });
    await expect(index.dispatch('gh issue missing')).resolves.toEqual({ matched: false });
    await expect(index.dispatch('gh issue listing')).resolves.toEqual({ matched: false });
  });

  it('compiles typed filename parameters and applies defaults', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/pr/[title:string=defaultTitle].ts';
    const command = defineCommand({
      execute: ({ params }) => `${typeof params.title}:${params.title}`,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'pr', kind: 'directory' }],
      '/project/commands/gh/pr': [{
        name: '[title:string=defaultTitle].ts',
        kind: 'file',
      }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots.map((slot) => slot.localName)).toEqual(['gh/pr/$title']);

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    expect(index.list()).toEqual([{
      name: 'gh pr [title]',
      description: undefined,
      source,
      parameters: [{
        name: 'title',
        type: 'string',
        defaultValue: 'defaultTitle',
        required: false,
      }],
    }]);
    await expect(index.execute('gh pr release')).resolves.toBe('string:release');
    await expect(index.execute('gh pr')).resolves.toBe('string:defaultTitle');
  });

  it('converts required typed parameters and diagnoses invalid values', async () => {
    const owner = rootPluginId();
    const definition = defineCommand({
      execute: ({ params }) => `${typeof params.issue}:${params.issue}`,
    });
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/issue/$issue',
      source: '/commands/gh/issue/[issue:number].ts',
      definition: {
        ...definition,
        $parameter: { name: 'issue', type: 'number' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    expect(index.list()[0]?.name).toBe('gh issue <issue>');
    await expect(index.execute('gh issue 42')).resolves.toBe('number:42');
    await expect(index.execute('gh issue nope')).rejects.toThrow(
      'Invalid value for Command parameter issue:number: nope',
    );
    await expect(index.execute('gh issue')).rejects.toThrow('Unknown Command');
  });

  it('prefers literal commands over a matching dynamic route', async () => {
    const owner = rootPluginId();
    const literal = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/pr/list',
      source: '/commands/gh/pr/list.ts',
      definition: defineCommand({ execute: () => 'literal' }),
    });
    const dynamic = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/pr/$title',
      source: '/commands/gh/pr/[title:string].ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `dynamic:${params.title}` }),
        $parameter: { name: 'title', type: 'string' } as const,
      },
    });
    const index = new CommandIndex([dynamic, literal], snapshotFor(owner, [dynamic, literal]));

    await expect(index.execute('gh pr list')).resolves.toBe('literal');
    await expect(index.execute('gh pr next')).resolves.toBe('dynamic:next');
  });

  it('rejects dynamic routes that differ only by parameter metadata', () => {
    const owner = rootPluginId();
    const dynamicSlot = (name: string, type: 'string' | 'number') => createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: `gh/pr/$${name}`,
      source: `/commands/gh/pr/[${name}:${type}].ts`,
      definition: {
        ...defineCommand({ execute() {} }),
        $parameter: { name, type },
      },
    });
    const title = dynamicSlot('title', 'string');
    const number = dynamicSlot('number', 'number');

    expect(() => new CommandIndex(
      [title, number],
      snapshotFor(owner, [title, number]),
    )).toThrow('Duplicate runtime Command');
  });

  it('rejects malformed dynamic command filenames during discovery', async () => {
    const owner = rootPluginId();
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: '[count:number=nope].ts', kind: 'file' }],
    }, new Map());

    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('default for count:number is invalid');
  });

  it('discovers structured parameter files and rejects structured defaults', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/upload/[asset:image].ts';
    const command = defineCommand({ execute: ({ params }) => params.asset });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'upload', kind: 'directory' }],
      '/project/commands/upload': [{ name: '[asset:image].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots[0]?.definition.$parameter).toEqual({
      name: 'asset',
      type: 'image',
    });

    const invalidHost = new MemoryDiscoveryHost({
      '/project/commands': [{ name: '[asset:image=true].ts', kind: 'file' }],
    }, new Map());
    await expect(new FeatureDiscovery(invalidHost).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('default for structured parameter asset:image is not supported');
  });

  it('rejects command-word collisions across owner and directory namespaces', () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const definition = defineCommand({ execute() {} });
    const rootSlot = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'child/status',
      source: '/commands/child/status.ts',
      definition,
    });
    const childSlot = createCapabilitySlot({
      owner: child,
      feature: commandFeatureId,
      localName: 'status',
      source: '/plugins/child/commands/status.ts',
      definition,
    });
    const snapshot = {
      generation: 1,
      root,
      tree: new Map(),
      config: new Map(),
      resources: new Map(),
      capabilities: new Map(),
      projections: new Map(),
    } satisfies RuntimeSnapshot;

    expect(() => new CommandIndex([rootSlot, childSlot], snapshot)).toThrow(
      'Duplicate runtime Command: child status',
    );
  });

  it('treats typed parameter rejection as no match during dispatch', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: '$delay',
      source: '/commands/[delay:number].ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `wait:${params.delay}` }),
        $parameter: { name: 'delay', type: 'number' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    // 普通文本命中数字参数路由时不得抛出，应视为未命中。
    await expect(index.dispatch('hello')).resolves.toEqual({ matched: false });
    await expect(index.dispatch('30')).resolves.toMatchObject({
      matched: true,
      value: 'wait:30',
    });
  });

  it('does not match empty input against optional-parameter commands', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/pr/$title',
      source: '/commands/gh/pr/[title:string=defaultTitle].ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `pr:${params.title}` }),
        $parameter: { name: 'title', type: 'string', defaultValue: 'defaultTitle' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    await expect(index.dispatch('')).resolves.toEqual({ matched: false });
    expect(index.has('')).toBe(false);
    await expect(index.execute('gh pr')).resolves.toBe('pr:defaultTitle');
  });

  it('prefers the dynamic route with more static segments', async () => {
    const owner = rootPluginId();
    const generic = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'foo/$value',
      source: '/commands/foo/[value:string].ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `generic:${params.value}` }),
        $parameter: { name: 'value', type: 'string' } as const,
      },
    });
    const specific = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'foo/bar/$value',
      source: '/commands/foo/bar/[value:string=fallback].ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `specific:${params.value}` }),
        $parameter: { name: 'value', type: 'string', defaultValue: 'fallback' } as const,
      },
    });
    // generic 先注册，若按插入顺序遍历会遮蔽 specific。
    const index = new CommandIndex([generic, specific], snapshotFor(owner, [generic, specific]));

    await expect(index.execute('foo bar')).resolves.toBe('specific:fallback');
    await expect(index.execute('foo bar baz')).resolves.toBe('specific:baz');
    await expect(index.execute('foo other')).resolves.toBe('generic:other');
  });

  it('matches canonical structured parameters and preserves remaining segments', async () => {
    const owner = rootPluginId();
    const image = Object.freeze({
      kind: 'url',
      value: 'https://example.com/avatar.png',
    });
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'upload/$asset',
      source: '/commands/upload/[asset:image].ts',
      definition: {
        ...defineCommand({
          execute: ({ params, args, segments }) => ({
            asset: params.asset,
            args,
            segments,
          }),
        }),
        $parameter: { name: 'asset', type: 'image' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));
    const segments = [
      { type: 'text', data: { text: 'upload ' } },
      { type: 'image', data: { media: image } },
      { type: 'text', data: { text: ' caption words ' } },
      { type: 'mention', data: { target: '10001' } },
    ] as const;

    await expect(index.dispatch(segments)).resolves.toMatchObject({
      matched: true,
      command: 'upload <asset>',
      value: {
        asset: image,
        args: ['caption', 'words'],
        segments: [
          { type: 'text', data: { text: 'caption words ' } },
          { type: 'mention', data: { target: '10001' } },
        ],
      },
    });
  });
});

function snapshotFor(
  owner: ReturnType<typeof rootPluginId>,
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
): RuntimeSnapshot {
  return {
    generation: 1,
    root: owner,
    tree: new Map([[owner, {
      id: owner,
      instanceKey: 'root',
      packageName: '@test/root',
      packageRoot: '/project',
      children: [],
    }]]),
    config: new Map([[owner, {}]]),
    resources: new Map([[owner, new Map()]]),
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
    if (!this.modules.has(source)) throw new Error(`Missing module: ${source}`);
    return this.modules.get(source) as T;
  }

  async readText(): Promise<string> {
    throw new Error('Not implemented');
  }
}
