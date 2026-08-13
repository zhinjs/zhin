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

  it('rejects non-array scopes instead of throwing a bare TypeError', () => {
    // defineAgentTool: 对象 / 字符串形式的 scopes 走统一校验错误
    expect(() => defineAgentTool({
      description: 'Bad scopes object',
      scopes: {} as unknown as ['group'],
      execute: () => 'ok',
    })).toThrow('Agent Tool scopes must be an array');
    expect(() => defineAgentTool({
      description: 'Bad scopes string',
      scopes: 'group' as unknown as ['group'],
      execute: () => 'ok',
    })).toThrow('Agent Tool scopes must be an array');

    // parseAgentToolDefinition: 非数组 scopes 走统一 invalidTool
    const valid = defineAgentTool({ description: 'Valid', execute: () => 'ok' });
    expect(() => parseAgentToolDefinition({ ...valid, scopes: {} }))
      .toThrow('Tool module must default-export defineAgentTool(...)');
    expect(() => parseAgentToolDefinition({ ...valid, scopes: 'group' }))
      .toThrow('Tool module must default-export defineAgentTool(...)');

    // 数组但取值非法仍然拒绝
    expect(() => defineAgentTool({
      description: 'Bad scope value',
      scopes: ['dm'] as unknown as ['group'],
      execute: () => 'ok',
    })).toThrow('Agent Tool scopes must be private, group, or channel');
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
          return `${value}:${input.query}:${context.origin.kind}:${(context.config as { scope: string }).scope}:${context.use(secret)}`;
        },
      }),
    });
    const rootSlot = slot(root, 'root');
    const childSlot = slot(child, 'child');
    const snapshot = createSnapshot([rootSlot, childSlot], secret.id);
    const index = new ToolIndex([rootSlot, childSlot], snapshot);

    await expect(index.execute(child, 'lookup', { query: 'q' }, invocation()))
      .resolves.toBe('child:q:http:child:child-secret');
    await expect(index.execute(root, 'lookup', { query: 'q' }, invocation()))
      .resolves.toBe('root:q:http:root:root-secret');
    expect(index.visible(child).map((tool) => tool.qualifiedName)).toEqual(['child__lookup']);
  });

  it('publishes every plugin-owned Tool under one collision-free qualified identity', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const slot = createCapabilitySlot({
      owner: child,
      feature: toolFeatureId,
      localName: 'history',
      source: '/plugins/lottery/tools/history.ts',
      definition: defineAgentTool<{ game: string }>({
        description: 'Lottery history',
        approval: 'never',
        execute: ({ game }) => `history:${game}`,
      }),
    });
    const snapshot = createSnapshot([slot], createToken('unused').id);
    const index = new ToolIndex([slot], snapshot);

    expect(index.list().map((tool) => tool.qualifiedName)).toEqual(['child__history']);
    await expect(index.execute(child, 'history', { game: 'ssq' }, invocation()))
      .resolves.toBe('history:ssq');
  });

  it('fails closed at the Tool execution boundary when an executable input schema rejects', async () => {
    const root = rootPluginId();
    const executed: string[] = [];
    const slot = createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName: 'save',
      source: '/tools/save.ts',
      definition: defineAgentTool<{ value: string }>({
        description: 'Save value',
        approval: 'never',
        inputSchema: {
          safeParse: (input: unknown) => {
            const value = (input as { value?: unknown })?.value;
            return typeof value === 'string' && value.length > 0
              ? { success: true as const, data: { value } }
              : { success: false as const, error: { issues: [{ path: ['value'], message: 'too small' }] } };
          },
        },
        execute: ({ value }) => { executed.push(value); return value; },
      }),
    });
    const snapshot = createSnapshot([slot], createToken('unused').id);
    const index = new ToolIndex([slot], snapshot);

    await expect(index.execute(root, 'save', { value: '' }, invocation()))
      .rejects.toThrow('Invalid Agent Tool input for save');
    expect(executed).toEqual([]);
  });
});

function invocation() {
  return {
    signal: new AbortController().signal,
    traceId: 'trace-1',
    turnId: 'turn-1',
    sessionKey: 'session-1',
    origin: { kind: 'http', sessionId: 'session-1' },
    principal: { subjectId: 'user-1', roles: ['user'] },
  } as const;
}

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
