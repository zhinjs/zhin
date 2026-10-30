import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  createToken,
  rootPluginId,
  projectLocaleToken,
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

interface ToolTestClient {
  readonly id: string;
}

declare class RegisteredTestAdapter {
  readonly adapterEvents: Record<string, unknown>;
  getEndpoint(instanceId: string): ToolTestClient | undefined;
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'tool-test': RegisteredTestAdapter; }
}

describe('Tool Feature', () => {
  it('reads synchronous availability from the same owner definition without invoking the tool', () => {
    const root = rootPluginId();
    let executions = 0;
    const definition = defineAgentTool({ description: 'Sticker',
      isAvailable: ({ sessionKey }) => sessionKey === 'bot-b:scene',
      execute: () => { executions++; },
    });
    const slot = createCapabilitySlot({ owner: root, feature: toolFeatureId, localName: 'sticker',
      source: '/tools/sticker/index.ts', definition });
    const index = new ToolIndex([slot], createSnapshot([slot], createToken('unused').id));
    expect(index.isAvailable(root, 'sticker', { sessionKey: 'bot-a:scene', origin: invocation().origin })).toBe(false);
    expect(index.isAvailable(root, 'sticker', { sessionKey: 'bot-b:scene', origin: invocation().origin })).toBe(true);
    expect(executions).toBe(0);
    expect(() => index.isAvailable(root, 'unknown', { sessionKey: 'bot-a:scene', origin: invocation().origin })).toThrow('Unknown Agent Tool');
  });

  it('rejects malformed availability declarations and asynchronous predicate results', () => {
    const valid = defineAgentTool({ description: 'Sticker', execute() {} });
    expect(() => defineAgentTool({ ...valid, isAvailable: true as never })).toThrow('isAvailable');
    expect(() => parseAgentToolDefinition({ ...valid, isAvailable: 'yes' })).toThrow();
    const root = rootPluginId();
    const invalid = { ...valid, isAvailable: () => Promise.resolve(true) } as never;
    const slot = createCapabilitySlot({ owner: root, feature: toolFeatureId, localName: 'sticker',
      source: '/tools/sticker/index.ts', definition: invalid });
    const index = new ToolIndex([slot], createSnapshot([slot], createToken('unused').id));
    expect(() => index.isAvailable(root, 'sticker', { sessionKey: 'scene', origin: invocation().origin })).toThrow('must return a boolean');
  });

  it('uses the trusted turn language or project language, never a model argument', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({ owner: root, feature: toolFeatureId, localName: 'locale',
      source: '/project/tools/locale/index.ts', definition: defineAgentTool({ description: 'Read language',
        execute: (_input, context) => context.locale }) });
    const base = createSnapshot([slot], createToken('unused').id);
    const snapshot: RuntimeSnapshot = { ...base, resources: new Map([
      [root, new Map([[projectLocaleToken.id, 'en']])],
    ]) };
    const index = new ToolIndex([slot], snapshot);
    expect(await index.execute(root, 'locale', { locale: 'zh-CN' }, invocation())).toBe('en');
    const results = await Promise.all([
      index.execute(root, 'locale', { locale: 'en' }, { ...invocation(), locale: 'zh-CN' }),
      index.execute(root, 'locale', {}, { ...invocation(), locale: 'en' }),
    ]);
    expect(results).toEqual(['zh-CN', 'en']);
  });
  it('brands definitions and discovers flat tools/<name>/index.ts', async () => {
    const definition = defineAgentTool({
      description: 'Get weather',
      execute: (input: { city: string }) => input.city,
    });
    expect(definition.requiresApproval).toBe('on-risk');
    expect(parseAgentToolDefinition(definition)).toBe(definition);
    const host = new MemoryHost({
      '/project/tools': [
        { name: 'weather', kind: 'directory' },
      ],
      '/project/tools/weather': [
        { name: 'index.ts', kind: 'file' },
        { name: 'client.ts', kind: 'file' },
      ],
    }, new Map([['/project/tools/weather/index.ts', { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(toolFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual(['weather']);
  });

  it('defineAgentTool.withConfig<Config>() validates and brands like the direct form', () => {
    const define = defineAgentTool.withConfig<{ apiKey: string }>();
    const tool = define<{ city: string }>({ description: 'Weather', execute: ({ city }, { config }) => `${config.apiKey}:${city}` });
    expect(parseAgentToolDefinition(tool)).toBe(tool);
    expect(tool.requiresApproval).toBe('on-risk');
    expect(() => define({ description: '  ', execute() {} })).toThrow('Agent Tool description cannot be empty');
  });

  it('ignores removed package-root tools directories', async () => {
    const definition = defineAgentTool({
      description: '给用户点赞',
      execute: () => 'ok',
    });
    const host = new MemoryHost({
      '/project/agent/tools': [
        { name: '$send_user_like.ts', kind: 'file' },
      ],
    }, new Map([['/project/tools/$send_user_like.ts', { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(toolFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots).toEqual([]);
  });

  it('discovers plugin AI tools from tools with the same owner context', async () => {
    const definition = defineAgentTool({
      description: 'Get current news',
      tags: ['news'],
      keywords: ['today'],
      execute: () => 'ok',
    });
    const host = new MemoryHost({
      '/project/tools': [
        { name: 'news', kind: 'directory' },
      ],
      '/project/tools/news': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([['/project/tools/news/index.ts', { default: definition }]]));
    const slots = await new FeatureDiscovery(host).discover(toolFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);
    const [descriptor] = new ToolIndex(slots, createSnapshot(slots, createToken('unused').id)).list();

    expect(descriptor).toMatchObject({
      name: 'news',
      tags: ['news'],
      keywords: ['today'],
    });
  });

  it('derives stable identities for Agent and Skill private tools', async () => {
    const definition = defineAgentTool({ description: 'Private', execute: () => 'ok' });
    const host = new MemoryHost({
      '/project/agents': [{ name: 'reviewer', kind: 'directory' }],
      '/project/agents/reviewer/tools': [{ name: 'inspect', kind: 'directory' }],
      '/project/agents/reviewer/tools/inspect': [{ name: 'index.ts', kind: 'file' }],
      '/project/agents/reviewer/skills': [{ name: 'audit', kind: 'directory' }],
      '/project/agents/reviewer/skills/audit/tools': [{ name: 'report', kind: 'directory' }],
      '/project/agents/reviewer/skills/audit/tools/report': [{ name: 'index.ts', kind: 'file' }],
      '/project/skills': [{ name: 'research', kind: 'directory' }],
      '/project/skills/research/tools': [{ name: 'search', kind: 'directory' }],
      '/project/skills/research/tools/search': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([
      ['/project/agents/reviewer/tools/inspect/index.ts', { default: definition }],
      ['/project/agents/reviewer/skills/audit/tools/report/index.ts', { default: definition }],
      ['/project/skills/research/tools/search/index.ts', { default: definition }],
    ]));
    const slots = await new FeatureDiscovery(host).discover(toolFeature, [{
      owner: rootPluginId(), packageRoot: '/project',
    }]);

    expect(slots.map((slot) => slot.localName)).toEqual([
      'agent/reviewer/inspect',
      'skill/research/search',
      'agent/reviewer/skill/audit/report',
    ]);
    expect(slots.map((slot) => slot.definition.placement)).toEqual([
      { kind: 'agent', agent: 'reviewer' },
      { kind: 'skill', skill: 'research' },
      { kind: 'agent-skill', agent: 'reviewer', skill: 'audit' },
    ]);
    expect(slots.every((slot) => slot.definition.hidden === true)).toBe(true);
  });

  it('keeps immutable visibility, permit, and approval metadata in the Tool index', () => {
    const root = rootPluginId();
    const definition = defineAgentTool({
      description: 'Moderate a QQ group',
      platforms: ['qq'],
      scopes: ['group'],
      currentConversationBotRoles: ['owner', 'admin'],
      permissions: ['platform(qq,scene_admin)'],
      tags: ['moderation'],
      keywords: ['admin'],
      hidden: true,
      requiresApproval: 'always',
      execute: () => 'ok',
    });
    const slot = createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName: 'moderate',
      source: '/tools/moderate/index.ts',
      definition,
    });
    const snapshot = createSnapshot([slot], createToken('unused').id);
    const [descriptor] = new ToolIndex([slot], snapshot).visible(root);

    expect(descriptor).toMatchObject({
      platforms: ['qq'],
      scopes: ['group'],
      currentConversationBotRoles: ['owner', 'admin'],
      permissions: ['platform(qq,scene_admin)'],
      tags: ['moderation'],
      keywords: ['admin'],
      hidden: true,
      requiresApproval: 'always',
    });
    expect(Object.isFrozen(definition.permissions)).toBe(true);
    expect(Object.isFrozen(definition.currentConversationBotRoles)).toBe(true);
  });

  it('validates current-conversation Bot roles at authoring and discovery boundaries', () => {
    const valid = defineAgentTool({ description: 'Moderate', currentConversationBotRoles: ['admin'], execute() {} });
    expect(parseAgentToolDefinition(valid).currentConversationBotRoles).toEqual(['admin']);
    expect(() => defineAgentTool({ description: 'Invalid', currentConversationBotRoles: [1] as never, execute() {} }))
      .toThrow('currentConversationBotRoles');
    expect(() => parseAgentToolDefinition({ ...valid, currentConversationBotRoles: 'admin' }))
      .toThrow();
  });

  it('keeps tools deferred unless alwaysLoaded is explicitly true (#857)', () => {
    const root = rootPluginId();
    const slotFor = (localName: string, definition: ReturnType<typeof defineAgentTool>) => createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName,
      source: `/tools/${localName}/index.ts`,
      definition,
    });
    const plain = slotFor('plain', defineAgentTool({ description: 'Plain', execute: () => 'ok' }));
    const resident = slotFor('resident', defineAgentTool({ description: 'Resident', alwaysLoaded: true, execute: () => 'ok' }));
    const optOut = slotFor('opt_out', defineAgentTool({ description: 'Opt out', alwaysLoaded: false, execute: () => 'ok' }));
    const snapshot = createSnapshot([plain, resident, optOut], createToken('unused').id);
    const byName = new Map(new ToolIndex([plain, resident, optOut], snapshot).visible(root)
      .map((descriptor) => [descriptor.name, descriptor]));

    expect('alwaysLoaded' in byName.get('plain')!).toBe(false);
    expect(byName.get('resident')?.alwaysLoaded).toBe(true);
    expect('alwaysLoaded' in byName.get('opt_out')!).toBe(false);
  });

  it('copies readOnly onto the descriptor only when explicitly true (ADR 0038 §5)', () => {
    const root = rootPluginId();
    const slotFor = (localName: string, definition: ReturnType<typeof defineAgentTool>) => createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName,
      source: `/tools/${localName}/index.ts`,
      definition,
    });
    const plain = slotFor('plain', defineAgentTool({ description: 'Plain', execute: () => 'ok' }));
    const reader = slotFor('reader', defineAgentTool({ description: 'Reader', readOnly: true, execute: () => 'ok' }));
    const writer = slotFor('writer', defineAgentTool({ description: 'Writer', readOnly: false, execute: () => 'ok' }));
    const snapshot = createSnapshot([plain, reader, writer], createToken('unused').id);
    const byName = new Map(new ToolIndex([plain, reader, writer], snapshot).visible(root)
      .map((descriptor) => [descriptor.name, descriptor]));

    expect('readOnly' in byName.get('plain')!).toBe(false);
    expect(byName.get('reader')?.readOnly).toBe(true);
    expect('readOnly' in byName.get('writer')!).toBe(false);
    expect(() => defineAgentTool({ description: 'Bad', readOnly: 'yes' as unknown as boolean, execute: () => 'ok' }))
      .toThrow('Agent Tool readOnly must be a boolean');
    expect(() => parseAgentToolDefinition({ ...defineAgentTool({ description: 'Valid', execute: () => 'ok' }), readOnly: 1 }))
      .toThrow('Tool module must default-export defineAgentTool(...)');
  });

  it('rejects a non-boolean alwaysLoaded flag', () => {
    expect(() => defineAgentTool({
      description: 'Bad flag',
      alwaysLoaded: 'yes' as unknown as boolean,
      execute: () => 'ok',
    })).toThrow('Agent Tool alwaysLoaded must be a boolean');
    const valid = defineAgentTool({ description: 'Valid', execute: () => 'ok' });
    expect(() => parseAgentToolDefinition({ ...valid, alwaysLoaded: 1 }))
      .toThrow('Tool module must default-export defineAgentTool(...)');
    expect(parseAgentToolDefinition({ ...valid, alwaysLoaded: true }).alwaysLoaded).toBe(true);
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
      source: `/${owner}/tools/lookup/index.ts`,
      definition: defineAgentTool<{ query: string }>({
        description: `Lookup ${value}`,
        requiresApproval: 'never',
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

  it('resolves a reused Tool against the operation owner graph without changing the retained snapshot', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const slot = createCapabilitySlot({
      owner: root, feature: toolFeatureId, localName: 'inherited', source: '/tools/inherited/index.ts',
      definition: defineAgentTool({ description: 'Inherited tool', requiresApproval: 'never', execute: (_input, context) => context.generation }),
    });
    const previous = createSnapshot([slot], createToken('unused').id);
    const index = new ToolIndex([slot], previous);
    const current: RuntimeSnapshot = {
      ...previous, generation: 2,
      tree: new Map([...previous.tree].map(([id, node]) => [id, id === child ? { ...node, parent: undefined } : node])),
    };
    await expect(index.execute(child, 'inherited', {}, invocation(), current)).rejects.toThrow('Unknown Agent Tool');
    await expect(index.execute(root, 'inherited', {}, invocation(), current)).resolves.toBe(2);
    await expect(index.execute(child, 'inherited', {}, invocation())).resolves.toBe(1);
  });

  it('passes immutable invocation policy into the Tool execution context', async () => {
    const root = rootPluginId();
    const slot = createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName: 'network-policy',
      source: '/tools/network-policy/index.ts',
      definition: defineAgentTool({
        description: 'Inspect execution policy',
        requiresApproval: 'never',
        execute: (_input, context) => context.policy,
      }),
    });
    const snapshot = createSnapshot([slot], createToken('unused').id);
    const index = new ToolIndex([slot], snapshot);

    await expect(index.execute(root, 'network-policy', {}, invocation())).resolves.toEqual({
      permissions: ['user'],
      unattended: false,
      network: { enabled: false, httpsOnly: undefined, allowedDomains: [] },
    });
  });

  it('injects the current adapter Client lazily and rejects mismatched turns', async () => {
    const root = rootPluginId();
    const client: ToolTestClient = { id: 'client-1' };
    let reads = 0;
    const slot = createCapabilitySlot({
      owner: root,
      feature: toolFeatureId,
      localName: 'client-id',
      source: '/tools/client-id/index.ts',
      definition: defineAgentTool<Record<string, never>>({
        adapter: 'tool-test',
        description: 'Read the native client',
        execute: (_input, context) => context.$client.id,
      }),
    });
    const index = new ToolIndex([slot], createSnapshot([slot], createToken('unused').id));

    await expect(index.execute(root, 'client-id', {}, {
      ...invocation(),
      client: { adapter: 'other', get: () => client },
    })).rejects.toThrow('requires adapter tool-test');
    expect(reads).toBe(0);

    await expect(index.execute(root, 'client-id', {}, {
      ...invocation(),
      client: { adapter: 'tool-test', get: () => { reads += 1; return client; } },
    })).resolves.toBe('client-1');
    expect(reads).toBe(1);
  });

  it('publishes every plugin-owned Tool under one collision-free qualified identity', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const slot = createCapabilitySlot({
      owner: child,
      feature: toolFeatureId,
      localName: 'history',
      source: '/plugins/lottery/tools/history/index.ts',
      definition: defineAgentTool<{ game: string }>({
        description: 'Lottery history',
        requiresApproval: 'never',
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
      source: '/tools/save/index.ts',
      definition: defineAgentTool<{ value: string }>({
        description: 'Save value',
        requiresApproval: 'never',
        inputSchema: {
          toJSONSchema: () => ({
            type: 'object',
            properties: { value: { type: 'string', minLength: 1 } },
            required: ['value'],
          }),
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
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
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
