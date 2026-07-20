import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  createToken,
  rootPluginId,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';
import toolFeature, {
  ToolIndex,
  defineAgentTool,
  parseAgentToolDefinition,
  toolFeatureId,
} from '../src/index.js';

describe('Tool Feature', () => {
  it('brands definitions and discovers only flat tools/*.ts', async () => {
    const definition = defineAgentTool({
      description: 'Get weather',
      execute: (input: { city: string }) => input.city,
    });
    expect(definition.approval).toBe('on-risk');
    expect(parseAgentToolDefinition(definition)).toBe(definition);
    const host = new MemoryHost({
      '/project/tools': [
        { name: 'weather.ts', kind: 'file' },
        { name: 'nested', kind: 'directory' },
      ],
    }, new Map([['/project/tools/weather.ts', { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(toolFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['weather']);
  });

  it('keeps immutable visibility, permit, and approval metadata in the Tool index', () => {
    const root = rootPluginId();
    const definition = defineAgentTool({
      description: 'Moderate a QQ group',
      platforms: ['qq'],
      scopes: ['group'],
      permissions: ['platform(qq,scene_admin)'],
      hidden: true,
      approval: 'always',
      execute: () => 'ok',
    });
    const slot = createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName: 'moderate',
      source: '/tools/moderate.ts',
      definition,
    });
    const snapshot = createSnapshot([slot], createToken('unused').id);
    const [descriptor] = new ToolIndex([slot], snapshot).visible(root);

    expect(descriptor).toMatchObject({
      platforms: ['qq'],
      scopes: ['group'],
      permissions: ['platform(qq,scene_admin)'],
      hidden: true,
      approval: 'always',
    });
    expect(Object.isFrozen(definition.permissions)).toBe(true);
  });

  it('executes the nearest owner Tool with its own config and resources', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const secret = createToken<string>('test.tool-secret');
    const slot = (owner: PluginId, value: string) => createCapabilitySlot({
      owner,
      feature: toolFeatureId,
      localName: 'lookup',
      source: `/${owner}/tools/lookup.ts`,
      definition: defineAgentTool<{ query: string }>({
        description: `Lookup ${value}`,
        approval: 'never',
        execute(input, context) {
          return `${value}:${input.query}:${(context.config as { scope: string }).scope}:${context.use(secret)}`;
        },
      }),
    });
    const rootSlot = slot(root, 'root');
    const childSlot = slot(child, 'child');
    const snapshot = createSnapshot([rootSlot, childSlot], secret.id);
    const index = new ToolIndex([rootSlot, childSlot], snapshot);

    await expect(index.execute(child, 'lookup', { query: 'q' }))
      .resolves.toBe('child:q:child:child-secret');
    await expect(index.execute(root, 'lookup', { query: 'q' }))
      .resolves.toBe('root:q:root:root-secret');
    expect(index.visible(child).map((tool) => tool.qualifiedName)).toEqual(['child__lookup']);
  });
});

function createSnapshot(
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
  secretId: ReturnType<typeof createToken>['id'],
): RuntimeSnapshot {
  const root = rootPluginId();
  const child = childPluginId(root, 'child');
  return {
    generation: 1,
    root,
    tree: new Map([
      [root, {
        id: root,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/project',
        children: [child],
      }],
      [child, {
        id: child,
        instanceKey: 'child',
        packageName: '@test/child',
        packageRoot: '/project/plugins/child',
        parent: root,
        children: [],
      }],
    ]),
    config: new Map([[root, { scope: 'root' }], [child, { scope: 'child' }]]),
    resources: new Map([
      [root, new Map([[secretId, 'root-secret']])],
      [child, new Map([[secretId, 'child-secret']])],
    ]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

class MemoryHost implements DiscoveryHost {
  constructor(
    private readonly directories: Readonly<Record<string, readonly DirectoryEntry[]>>,
    private readonly modules: ReadonlyMap<string, unknown>,
  ) {}
  async list(path: string): Promise<readonly DirectoryEntry[]> {
    return this.directories[path] ?? [];
  }
  async loadModule<T>(source: string): Promise<T> {
    return this.modules.get(source) as T;
  }
  async readText(): Promise<string> { throw new Error('Not implemented'); }
}
