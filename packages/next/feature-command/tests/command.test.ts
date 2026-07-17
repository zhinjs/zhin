import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import {
  CommandIndex,
  commandFeature,
  commandFeatureId,
  defineCommand,
  parseCommandDefinition,
} from '../src/index.js';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/next-feature-kit';

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
    }]);
    await expect(index.execute('gh issue list', ['open', 'closed']))
      .resolves.toBe('issues:open,closed');
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
});

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
