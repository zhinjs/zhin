import { describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/next-kernel';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/next-feature-kit';
import mcpFeature, {
  McpIndex,
  defineMcp,
  mcpFeatureId,
  parseMcpDefinition,
} from '../src/index.js';

describe('MCP Feature', () => {
  it('brands provider-neutral MCP client definitions', () => {
    const definition = defineMcp({
      description: 'Memory server',
      create: () => ({ listTools: () => [], callTool: () => undefined }),
    });
    expect(parseMcpDefinition(definition)).toBe(definition);
    expect(() => parseMcpDefinition({ create() {} })).toThrow('defineMcp');
  });

  it('discovers only flat mcp/*.ts client definitions', async () => {
    const definition = defineMcp({
      create: () => ({ listTools: () => [], callTool: () => undefined }),
    });
    const host = new MemoryHost({
      '/project/mcp': [
        { name: 'memory.ts', kind: 'file' },
        { name: 'nested', kind: 'directory' },
      ],
    }, new Map([['/project/mcp/memory.ts', { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(mcpFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['memory']);
  });

  it('starts clients before calls and stops each client exactly once', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: mcpFeatureId,
      localName: 'memory',
      source: '/mcp/memory.ts',
      definition: defineMcp({
        create: () => ({
          start() { events.push('start'); },
          stop() { events.push('stop'); },
          listTools: () => [{ name: 'search' }],
          callTool(name, input) {
            events.push(`call:${name}`);
            return input;
          },
        }),
      }),
    });
    const index = await McpIndex.create([slot], snapshot([slot]));
    await expect(index.listTools(root, 'memory')).rejects.toThrow('not active');
    await index.start();
    await expect(index.listTools(root, 'memory')).resolves.toEqual([{ name: 'search' }]);
    await expect(index.callTool(root, 'memory', 'search', { q: 'x' }))
      .resolves.toEqual({ q: 'x' });
    await index.stop();
    await index.stop();

    expect(events).toEqual(['start', 'call:search', 'stop']);
  });

  it('cleans up previously started clients when a sibling fails to start', async () => {
    const events: string[] = [];
    const root = rootPluginId();
    const slot = (name: string, fail: boolean) => createCapabilitySlot({
      owner: root,
      feature: mcpFeatureId,
      localName: name,
      source: `/mcp/${name}.ts`,
      definition: defineMcp({
        create: () => ({
          start() {
            events.push(`${name}:start`);
            if (fail) throw new Error('connect failed');
          },
          stop() { events.push(`${name}:stop`); },
          listTools: () => [],
          callTool: () => undefined,
        }),
      }),
    });
    const first = slot('a-first', false);
    const broken = slot('z-broken', true);
    const index = await McpIndex.create([broken, first], snapshot([first, broken]));

    await expect(index.start()).rejects.toThrow('connect failed');
    expect(events).toEqual([
      'a-first:start',
      'z-broken:start',
      'z-broken:stop',
      'a-first:stop',
    ]);
  });
});

function snapshot(slots: readonly ReturnType<typeof createCapabilitySlot>[]): RuntimeSnapshot {
  const root = rootPluginId();
  return {
    generation: 1,
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: '@test/root', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

class MemoryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly modules: ReadonlyMap<string, unknown>,
  ) {}
  async list(path: string): Promise<readonly DirectoryEntry[]> { return this.directories[path] ?? []; }
  async loadModule<T>(source: string): Promise<T> { return this.modules.get(source) as T; }
  async readText(): Promise<string> { throw new Error('Not implemented'); }
}
