import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  CommandIndex,
  CommandPathSyntaxError,
  commandFeature,
  commandFeatureId,
  defineCommand,
  isCommandIndex,
  parseCommandDefinition,
  type CommandParameterDefinition,
} from '../src/index.js';
import { createPermissionHost, permissionHostToken } from '@zhin.js/permission';
import {
  FeatureDiscovery,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';

type TestPluginId = ReturnType<typeof rootPluginId>;

interface CommandTestClient {
  readonly id: string;
}

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly 'command-test': {
      readonly client: CommandTestClient;
      readonly events: Record<string, unknown>;
    };
  }
}

function slotFor(owner: TestPluginId, localName: string, result = 'ok') {
  return createCapabilitySlot({
    owner,
    feature: commandFeatureId,
    localName,
    source: `/commands/${localName}.ts`,
    definition: defineCommand({ execute: () => result }),
  });
}

/** 含 root + 指定 owner 节点的完整快照（dispatch 时 createCapabilityContext 需要 tree 节点）。 */
function snapshotWithOwners(
  owners: readonly TestPluginId[],
  slots: readonly ReturnType<typeof slotFor>[],
): RuntimeSnapshot {
  const root = rootPluginId();
  return {
    generation: 1,
    root,
    tree: new Map([
      [root, {
        id: root,
        instanceKey: 'root',
        packageName: '@test/root',
        packageRoot: '/project',
        children: [],
      }],
      ...owners.filter((owner) => owner !== root).map((owner) => [owner, {
        id: owner,
        instanceKey: String(owner).split('/').pop()!,
        packageName: `@test/${String(owner).split('/').pop()}`,
        packageRoot: `/project/plugins/${String(owner).split('/').pop()}`,
        parent: root,
        children: [],
      }] as const),
    ]),
    config: new Map([[root, {}], ...owners.map((owner) => [owner, {}] as const)]),
    resources: new Map([[root, new Map()], ...owners.map((owner) => [owner, new Map()] as const)]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

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

  it('exposes adapter/endpoint/scene/sender objects on CommandContext from message input', async () => {
    const owner = rootPluginId();
    let seen: {
      adapter?: string;
      endpoint?: string;
      scene?: { id: string; type: string; name?: string };
      sender?: { id: string; name?: string; role: readonly string[] };
    } | undefined;
    const command = defineCommand({
      execute: (context) => {
        seen = {
          adapter: context.adapter,
          endpoint: context.endpoint,
          scene: context.scene,
          sender: context.sender,
        };
        return 'ok';
      },
    });
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'who',
      source: '/commands/who.ts',
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

    await index.dispatch('who', {
      conversation: {
        endpoint: { id: 'root/icqq\0zhin.adapter/1\0icqq~1689919782', adapter: 'root/icqq' },
        kind: 'group',
        id: '12345',
      },
      content: 'who',
      sender: { id: '1659488338', name: '凉菜', roles: ['admin'] },
      metadata: {
        endpoint: '1689919782',
        channelType: 'group',
        channelName: '测试群',
        nickname: '凉菜',
        senderRole: 'admin',
      },
    });

    expect(seen).toEqual({
      adapter: 'root/icqq',
      endpoint: '1689919782',
      scene: { id: '12345', type: 'group', name: '测试群' },
      sender: { id: '1659488338', name: '凉菜', role: ['admin'] },
    });

    seen = undefined;
    await index.execute('who');
    expect(seen).toEqual({
      adapter: undefined,
      endpoint: undefined,
      scene: undefined,
      sender: undefined,
    });
  });

  it('filters adapter-bound commands and resolves $client only when read', async () => {
    const owner = rootPluginId();
    const client: CommandTestClient = { id: 'client-1' };
    let reads = 0;
    const definition = defineCommand({
      adapter: 'command-test',
      execute(context) {
        return context.$client.id;
      },
    });
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'client-id',
      source: '/commands/client-id.ts',
      definition,
    });
    const index = new CommandIndex([slot], snapshotWithOwners([owner], [slot]));

    await expect(index.dispatch('client-id', {
      clientAdapter: 'other',
      get $client() { reads += 1; return client; },
    })).resolves.toEqual({ matched: false });
    expect(reads).toBe(0);

    await expect(index.dispatch('client-id', {
      clientAdapter: 'command-test',
      get $client() { reads += 1; return client; },
    })).resolves.toMatchObject({ matched: true, value: 'client-1' });
    expect(reads).toBe(1);
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

  it('prefers compiled command files for installed npm packages', async () => {
    const owner = rootPluginId();
    const root = '/project/node_modules/@test/plugin';
    const source = `${root}/commands/gh/[issue].js`;
    const command = defineCommand({
      params: { issue: { type: 'number' } },
      execute: ({ params }) => params.issue,
    });
    const host = new MemoryDiscoveryHost({
      [`${root}/commands`]: [{ name: 'gh', kind: 'directory' }],
      [`${root}/commands/gh`]: [
        { name: '[issue].js', kind: 'file' },
        { name: '[issue].ts', kind: 'file' },
      ],
    }, new Map([[source, { default: command }]]));

    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: root,
    }]);

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      localName: 'gh/$issue',
      source,
    });
  });

  it('dispatches the longest command prefix with trailing args and source input', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/issue/list',
      source: '/commands/gh/issue/list.ts',
      definition: defineCommand<{}, string, { sender: string }>({
        execute: ({ args, input }) => `${input.sender?.id}:${args.join(',')}`,
      }),
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    await expect(index.dispatch('gh issue list open assigned', { sender: { id: 'alice' } }))
      .resolves.toEqual({
        matched: true,
        command: 'gh issue list',
        owner,
        value: 'alice:open,assigned',
      });
    await expect(index.dispatch('gh issue missing')).resolves.toEqual({ matched: false });
    await expect(index.dispatch('gh issue listing')).resolves.toEqual({ matched: false });
  });

  it('compiles optional filename parameters and applies defaults from params', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/pr/[[title]].ts';
    const command = defineCommand({
      params: { title: { type: 'string', default: 'defaultTitle' } },
      execute: ({ params }) => `${typeof params.title}:${params.title}`,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'pr', kind: 'directory' }],
      '/project/commands/gh/pr': [{
        name: '[[title]].ts',
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
        optional: true,
        rest: false,
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
      source: '/commands/gh/issue/[issue].ts',
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
      source: '/commands/gh/pr/[title].ts',
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
      source: `/commands/gh/pr/[${name}].ts`,
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
    )).toThrow(/Duplicate Command route/);
  });

  it('replaces all local static segments via alias and keeps owner namespace', async () => {
    const root = rootPluginId();
    const qq = childPluginId(root, 'qq');
    const slot = createCapabilitySlot({
      owner: qq,
      feature: commandFeatureId,
      localName: 'endpoint/list',
      source: '/commands/endpoint/list.ts',
      definition: defineCommand({
        alias: ['ep', 'e l'],
        execute: ({ args }) => `list:${args.join(',')}`,
      }),
    });
    const index = new CommandIndex([slot], snapshotWithOwners([qq], [slot]));

    expect(index.list()[0]).toMatchObject({
      name: 'qq.endpoint list',
      alias: ['ep', 'e l'],
    });
    await expect(index.dispatch('qq.ep')).resolves.toMatchObject({
      matched: true,
      command: 'qq.endpoint list',
      value: 'list:',
    });
    await expect(index.dispatch('qq.e l open')).resolves.toMatchObject({
      matched: true,
      value: 'list:open',
    });
    await expect(index.dispatch('ep')).resolves.toEqual({ matched: false });
  });

  it('matches multi-word alias with trailing dynamic params', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'bugs/$id',
      source: '/commands/bugs/[id].ts',
      definition: {
        ...defineCommand({
          alias: ['gh issue'],
          params: { id: { type: 'number' } },
          execute: ({ params }) => `bug:${params.id}`,
        }),
        $parameter: { name: 'id', type: 'number' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    await expect(index.dispatch('gh issue 42')).resolves.toMatchObject({
      matched: true,
      value: 'bug:42',
    });
    await expect(index.dispatch('bugs 7')).resolves.toMatchObject({ value: 'bug:7' });
  });

  it('allows b and b list as distinct alias sequences', async () => {
    const owner = rootPluginId();
    const short = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'alpha',
      source: '/commands/alpha.ts',
      definition: defineCommand({ alias: ['b'], execute: () => 'short' }),
    });
    const longer = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'beta',
      source: '/commands/beta.ts',
      definition: defineCommand({ alias: ['b list'], execute: () => 'long' }),
    });
    const index = new CommandIndex([short, longer], snapshotFor(owner, [short, longer]));

    await expect(index.dispatch('b')).resolves.toMatchObject({ value: 'short' });
    await expect(index.dispatch('b list')).resolves.toMatchObject({ value: 'long' });
  });

  it('dispatches global shortcut with prefilled params and rejects trailing text', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'bugs/$id',
      source: '/commands/bugs/[id].ts',
      definition: {
        ...defineCommand({
          shortcut: { '开虫': { id: 9 } },
          params: { id: { type: 'number' } },
          execute: ({ params }) => `bug:${params.id}`,
        }),
        $parameter: { name: 'id', type: 'number' } as const,
      },
    });
    const child = childPluginId(owner, 'remind');
    const namespaced = createCapabilitySlot({
      owner: child,
      feature: commandFeatureId,
      localName: 'ping',
      source: '/remind/commands/ping.ts',
      definition: defineCommand({
        shortcut: { '叮': {} },
        execute: () => 'pong',
      }),
    });
    const index = new CommandIndex(
      [slot, namespaced],
      snapshotWithOwners([owner, child], [slot, namespaced]),
    );

    await expect(index.dispatch('开虫')).resolves.toMatchObject({
      matched: true,
      value: 'bug:9',
    });
    await expect(index.dispatch('开虫 1')).resolves.toEqual({ matched: false });
    await expect(index.dispatch('叮')).resolves.toMatchObject({
      matched: true,
      value: 'pong',
      command: 'remind.ping',
    });
  });

  it('resolves dynamic shortcut values from CommandSession at dispatch time', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'profile',
      source: '/commands/profile.ts',
      definition: defineCommand({
        shortcut: {
          '查看我的信息': {
            user_id: (session) => session.sender?.id ?? 'unknown',
          },
        },
        params: { user_id: { type: 'string' } },
        execute: ({ params }) => `profile:${params.user_id}`,
      }),
    });
    const index = new CommandIndex(
      [slot],
      snapshotWithOwners([owner], [slot]),
    );

    const fakeMessage = {
      content: '查看我的信息',
      conversation: {
        endpoint: { id: 'ep1', adapter: 'icqq' },
        kind: 'private' as const,
        id: 'conv1',
      },
      sender: { id: '12345', name: 'Alice' },
    };

    const result = await index.dispatch('查看我的信息', fakeMessage);
    expect(result).toMatchObject({
      matched: true,
      value: 'profile:12345',
    });

    const noSender = await index.dispatch('查看我的信息');
    expect(noSender).toMatchObject({
      matched: true,
      value: 'profile:unknown',
    });
  });

  it('reads enriched sender.roles including master/trusted from upstream', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'whoami',
      source: '/commands/whoami.ts',
      definition: defineCommand({
        shortcut: {
          '我是谁': {
            identity: (session) => session.sender?.role?.join(',') ?? 'none',
          },
        },
        params: { identity: { type: 'string' } },
        execute: ({ params }) => params.identity,
      }),
    });
    const index = new CommandIndex(
      [slot],
      snapshotWithOwners([owner], [slot]),
    );

    const masterMessage = {
      content: '我是谁',
      conversation: {
        endpoint: { id: 'ep1', adapter: 'icqq' },
        kind: 'group' as const,
        id: 'g1',
      },
      sender: { id: '100', name: 'Admin', roles: ['master', 'owner'] },
    };
    const masterResult = await index.dispatch('我是谁', masterMessage);
    expect(masterResult).toMatchObject({ matched: true, value: 'master,owner' });

    const trustedMessage = {
      content: '我是谁',
      conversation: {
        endpoint: { id: 'ep1', adapter: 'icqq' },
        kind: 'group' as const,
        id: 'g1',
      },
      sender: { id: '200', roles: ['trusted'] },
    };
    const trustedResult = await index.dispatch('我是谁', trustedMessage);
    expect(trustedResult).toMatchObject({ matched: true, value: 'trusted' });

    const plainMessage = {
      content: '我是谁',
      conversation: {
        endpoint: { id: 'ep1', adapter: 'icqq' },
        kind: 'group' as const,
        id: 'g1',
      },
      sender: { id: '300', roles: ['admin'] },
    };
    const plainResult = await index.dispatch('我是谁', plainMessage);
    expect(plainResult).toMatchObject({ matched: true, value: 'admin' });
  });

  it('treats permit failure as silent miss and skips permit on execute', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'secret',
      source: '/commands/secret.ts',
      definition: defineCommand({
        permit: ['adapter(icqq)', 'role(master)'],
        execute: () => 'ok',
      }),
    });
    const snapshot = snapshotFor(owner, [slot]);
    snapshot.resources.get(owner)!.set(permissionHostToken.id, createPermissionHost());
    const index = new CommandIndex([slot], snapshot);

    await expect(index.dispatch('secret', {
      conversation: {
        endpoint: { id: 'root/discord\0x', adapter: 'root/discord' },
        kind: 'private',
        id: '1',
      },
      content: 'secret',
      sender: { id: '1' },
      metadata: { isMaster: true },
    })).resolves.toEqual({ matched: false });

    await expect(index.dispatch('secret', {
      conversation: {
        endpoint: { id: 'root/icqq\0x', adapter: 'root/icqq' },
        kind: 'private',
        id: '1',
      },
      content: 'secret',
      sender: { id: '1' },
      metadata: { isMaster: true },
    })).resolves.toMatchObject({ matched: true, value: 'ok' });

    await expect(index.execute('secret')).resolves.toBe('ok');
  });

  it('rejects conflicting routes and invalid permit/shortcut at build time', () => {
    const owner = rootPluginId();
    expect(() => defineCommand({
      permit: ['unknownDsl(foo)'],
      execute: () => 'x',
    })).toThrow(/Unknown permit/);

    expect(() => defineCommand({
      alias: ['  '],
      execute: () => 'x',
    })).toThrow(/at least one token/);

    const primary = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'zan',
      source: '/commands/zan.ts',
      definition: defineCommand({ execute: () => 'a' }),
    });
    const aliasClash = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'other',
      source: '/commands/other.ts',
      definition: defineCommand({ alias: ['zan'], execute: () => 'b' }),
    });
    expect(() => new CommandIndex(
      [primary, aliasClash],
      snapshotFor(owner, [primary, aliasClash]),
    )).toThrow(/Duplicate Command route "zan"/);

    const shortcutClash = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'hello',
      source: '/commands/hello.ts',
      definition: defineCommand({
        shortcut: { zan: {} },
        execute: () => 'c',
      }),
    });
    expect(() => new CommandIndex(
      [primary, shortcutClash],
      snapshotFor(owner, [primary, shortcutClash]),
    )).toThrow(/Duplicate Command route "zan"/);

    expect(() => {
      const bad = createCapabilitySlot({
        owner,
        feature: commandFeatureId,
        localName: 'bugs/$id',
        source: '/commands/bugs/[id].ts',
        definition: {
          ...defineCommand({
            shortcut: { go: { nope: 1 } },
            params: { id: { type: 'number' } },
            execute: () => 'x',
          }),
          $parameter: { name: 'id', type: 'number' } as const,
        },
      });
      return new CommandIndex([bad], snapshotFor(owner, [bad]));
    }).toThrow(/unknown key "nope"/);
  });

  it('rejects legacy typed filenames during discovery', async () => {
    const owner = rootPluginId();
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: '[count:number].ts', kind: 'file' }],
    }, new Map());

    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow(CommandPathSyntaxError);
    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('Invalid Command path [count:number].ts');
  });

  it('discovers structured parameter files via params declarations', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/upload/[asset].ts';
    const command = defineCommand({
      params: { asset: { type: 'image' } },
      execute: ({ params }) => params.asset,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'upload', kind: 'directory' }],
      '/project/commands/upload': [{ name: '[asset].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots[0]?.definition.$parameter).toEqual({
      name: 'asset',
      type: 'image',
      optional: false,
      rest: false,
    });
  });

  it('isolates owner dot-prefix namespace from root directory namespace', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const rootSlot = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'child/status',
      source: '/commands/child/status.ts',
      definition: defineCommand({ execute: () => 'root' }),
    });
    const childSlot = createCapabilitySlot({
      owner: child,
      feature: commandFeatureId,
      localName: 'status',
      source: '/plugins/child/commands/status.ts',
      definition: defineCommand({ execute: () => 'child' }),
    });
    const snapshot = snapshotWithOwners([child], [rootSlot, childSlot]);

    // 点号前缀下二者不再冲突：root 目录段 `child status` vs owner 前缀 `child.status`
    const index = new CommandIndex([rootSlot, childSlot], snapshot);
    await expect(index.dispatch('child status')).resolves.toMatchObject({
      matched: true,
      owner: root,
      value: 'root',
    });
    await expect(index.dispatch('child.status')).resolves.toMatchObject({
      matched: true,
      owner: child,
      value: 'child',
    });
  });

  it('dispatches Unicode command names (e.g. Chinese 赞我)', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: '赞我',
      source: '/commands/赞我.ts',
      definition: defineCommand({ execute: ({ args }) => `liked:${args[0] ?? 'self'}` }),
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));
    await expect(index.dispatch('赞我')).resolves.toMatchObject({
      matched: true,
      command: '赞我',
      value: 'liked:self',
    });
    await expect(index.dispatch('赞我 10')).resolves.toMatchObject({
      matched: true,
      value: 'liked:10',
    });
  });

  it('treats typed parameter rejection as no match during dispatch', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: '$delay',
      source: '/commands/[delay].ts',
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
      source: '/commands/gh/pr/[[title]].ts',
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
      source: '/commands/foo/[value].ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `generic:${params.value}` }),
        $parameter: { name: 'value', type: 'string' } as const,
      },
    });
    const specific = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'foo/bar/$value',
      source: '/commands/foo/bar/[[value]].ts',
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
      source: '/commands/upload/[asset].ts',
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

  it('matches required catch-all [...slug] as string[] and ignores zero-segment input', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/files/[...slug].ts';
    const command = defineCommand({
      params: { slug: { type: 'text' } },
      execute: ({ params }) => params.slug,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'files', kind: 'directory' }],
      '/project/commands/files': [{ name: '[...slug].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots.map((slot) => slot.localName)).toEqual(['files/$slug']);
    expect(slots[0]?.definition.$parameter).toEqual({
      name: 'slug',
      type: 'text',
      optional: false,
      rest: true,
    });

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    expect(index.list()[0]?.name).toBe('files <...slug>');
    // 纯文本输入整体是一个 text 段；结构化多段输入逐段收集为 string[]
    await expect(index.execute('files a b c')).resolves.toEqual(['a b c']);
    await expect(index.dispatch([
      { type: 'text', data: { text: 'files a' } },
      { type: 'text', data: { text: 'b' } },
      { type: 'text', data: { text: 'c' } },
    ])).resolves.toMatchObject({ matched: true, value: ['a', 'b', 'c'] });
    // 必需捕获所有：零段输入视为不匹配该命令
    expect(index.has('files')).toBe(false);
    await expect(index.dispatch('files')).resolves.toEqual({ matched: false });
  });

  it('matches optional catch-all [[...slug]] with zero segments as an empty array', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/files/[[...slug]].ts';
    const command = defineCommand({
      params: { slug: { type: 'text', default: [] } },
      execute: ({ params }) => params.slug,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'files', kind: 'directory' }],
      '/project/commands/files': [{ name: '[[...slug]].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots.map((slot) => slot.localName)).toEqual(['files/$slug']);
    expect(slots[0]?.definition.$parameter).toEqual({
      name: 'slug',
      type: 'text',
      defaultValue: [],
      optional: true,
      rest: true,
    });

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    expect(index.list()[0]?.name).toBe('files [...slug]');
    await expect(index.execute('files')).resolves.toEqual([]);
    await expect(index.dispatch([
      { type: 'text', data: { text: 'files a' } },
      { type: 'text', data: { text: 'b' } },
    ])).resolves.toMatchObject({ matched: true, value: ['a', 'b'] });
  });

  it('splits word-typed catch-all [...slug] per word', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/files/[...slug].ts';
    const command = defineCommand({
      params: { slug: { type: 'word' } },
      execute: ({ params }) => params.slug,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'files', kind: 'directory' }],
      '/project/commands/files': [{ name: '[...slug].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    // word 类型逐词切分（与 text 的逐消息段相对）
    await expect(index.execute('files a b c')).resolves.toEqual(['a', 'b', 'c']);
    await expect(index.execute('files  a   b ')).resolves.toEqual(['a', 'b']);
    expect(index.has('files')).toBe(false);
  });

  it('casts number-typed catch-all per word and rejects non-numeric input', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/sum/[...nums].ts';
    const command = defineCommand({
      params: { nums: { type: 'number' } },
      execute: ({ params }) => params.nums,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'sum', kind: 'directory' }],
      '/project/commands/sum': [{ name: '[...nums].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    await expect(index.execute('sum 1 2 3.5')).resolves.toEqual([1, 2, 3.5]);
    // 任一词无法转换为 number 即整体不匹配
    expect(index.has('sum 1 x')).toBe(false);
    await expect(index.dispatch('sum 1 x')).resolves.toEqual({ matched: false });
  });

  it('matches optional [[name]] without default as undefined when omitted', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/pr/[[title]].ts';
    const command = defineCommand({
      params: { title: { type: 'text' } },
      execute: ({ params }) => `title:${String(params.title)}`,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'pr', kind: 'directory' }],
      '/project/commands/gh/pr': [{ name: '[[title]].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots[0]?.definition.$parameter).toEqual({
      name: 'title',
      type: 'text',
      optional: true,
      rest: false,
    });

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    expect(index.list()[0]?.name).toBe('gh pr [title]');
    await expect(index.execute('gh pr')).resolves.toBe('title:undefined');
    await expect(index.execute('gh pr hello')).resolves.toBe('title:hello');
  });

  it('renders displayName for all four dynamic segment forms', () => {
    const owner = rootPluginId();
    const dynamicSlot = (
      localName: string,
      parameter: CommandParameterDefinition,
    ) => createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName,
      source: `/commands/${localName.replace('$', '')}.ts`,
      definition: {
        ...defineCommand({ execute: () => 'ok' }),
        $parameter: parameter,
      },
    });
    const slots = [
      dynamicSlot('a/$name', { name: 'name', type: 'text' }),
      dynamicSlot('b/$name', { name: 'name', type: 'text', optional: true }),
      dynamicSlot('c/$slug', { name: 'slug', type: 'text', rest: true }),
      dynamicSlot('d/$slug', { name: 'slug', type: 'text', optional: true, rest: true }),
    ];
    const index = new CommandIndex(slots, snapshotFor(owner, slots));

    expect(index.list().map((command) => command.name).sort()).toEqual([
      'a <name>',
      'b [name]',
      'c <...slug>',
      'd [...slug]',
    ]);
  });

  it('rejects dynamic filenames missing a matching params declaration', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/search/[query].ts';
    const command = defineCommand({ execute: () => 'ok' });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'search', kind: 'directory' }],
      '/project/commands/search': [{ name: '[query].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow(CommandPathSyntaxError);
    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('missing params.query declaration');
  });

  it('rejects a required filename whose params entry declares a default', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/search/[query].ts';
    const command = defineCommand({
      params: { query: { type: 'text', default: 'all' } },
      execute: () => 'ok',
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'search', kind: 'directory' }],
      '/project/commands/search': [{ name: '[query].ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow(CommandPathSyntaxError);
    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('has a default but the file is required');
  });
});

describe('命令名点号前缀（插件树路径段 + 命令段）', () => {
  const root = rootPluginId();
  const qq = childPluginId(root, 'qq');
  const nested = childPluginId(childPluginId(root, 'b'), 'a');

  it('单级挂载：root/qq + endpoint/list → qq.endpoint list', async () => {
    const slot = slotFor(qq, 'endpoint/list', 'listed');
    const index = new CommandIndex([slot], snapshotWithOwners([qq], [slot]));

    expect(index.list()[0]!.name).toBe('qq.endpoint list');
    await expect(index.dispatch('qq.endpoint list')).resolves.toMatchObject({
      matched: true,
      command: 'qq.endpoint list',
      owner: qq,
      value: 'listed',
    });
    // 旧空格风格不再命中（breaking）
    await expect(index.dispatch('qq endpoint list')).resolves.toEqual({ matched: false });
  });

  it('多级挂载：root/b/a + foo → b.a.foo', async () => {
    const slot = slotFor(nested, 'foo', 'nested-ok');
    const index = new CommandIndex([slot], snapshotWithOwners([nested], [slot]));

    expect(index.list()[0]!.name).toBe('b.a.foo');
    await expect(index.execute('b.a.foo')).resolves.toBe('nested-ok');
    await expect(index.dispatch('b.a.foo')).resolves.toMatchObject({ matched: true });
    await expect(index.dispatch('b a foo')).resolves.toEqual({ matched: false });
  });

  it('root 插件命令无前缀（不变）', async () => {
    const slot = slotFor(root, 'foo');
    const index = new CommandIndex([slot], snapshotWithOwners([], [slot]));

    expect(index.list()[0]!.name).toBe('foo');
    await expect(index.dispatch('foo')).resolves.toMatchObject({ matched: true });
  });

  it('点号前缀边界：b.foobar 不误命中 b.foo', async () => {
    const b = childPluginId(root, 'b');
    const slot = slotFor(b, 'foo');
    const index = new CommandIndex([slot], snapshotWithOwners([b], [slot]));

    await expect(index.dispatch('b.foobar')).resolves.toEqual({ matched: false });
    await expect(index.dispatch('b.foo extra args')).resolves.toMatchObject({
      matched: true,
      command: 'b.foo',
    });
  });

  it('子插件动态首段：报错含约束说明与修正提示', () => {
    const remind = childPluginId(root, 'remind');
    const slot = createCapabilitySlot({
      owner: remind,
      feature: commandFeatureId,
      localName: '$note',
      source: 'plugins/remind/commands/[note].ts',
      definition: {
        ...defineCommand({ execute: () => 'x' }),
        $parameter: { name: 'note', type: 'string' } as const,
      },
    });
    expect(() => new CommandIndex([slot], snapshotWithOwners([remind], [slot])))
      .toThrow(/Invalid Command path for plugins\/remind\/commands\/\[note\]\.ts/);
    expect(() => new CommandIndex([slot], snapshotWithOwners([remind], [slot])))
      .toThrow(/must be the only dynamic segment and come after a static segment/);
    expect(() => new CommandIndex([slot], snapshotWithOwners([remind], [slot])))
      .toThrow(/Hint: move the file under a static directory/);
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

describe('内置菜单命令', () => {
  function menuSnapshot() {
    const root = rootPluginId();
    const qq = childPluginId(root, 'qq');
    const qqGroup = childPluginId(qq, 'group');
    const slots = [
      slotFor(root, 'echo'),
      createCapabilitySlot({
        owner: root,
        feature: commandFeatureId,
        localName: 'ping',
        source: '/commands/ping.ts',
        definition: defineCommand({ description: '测试连通性', execute: () => 'pong' }),
      }),
      createCapabilitySlot({
        owner: qq,
        feature: commandFeatureId,
        localName: 'status',
        source: '/commands/status.ts',
        definition: defineCommand({ description: 'QQ 状态', execute: () => 'ok' }),
      }),
    ];
    const snapshot: RuntimeSnapshot = {
      generation: 1,
      root,
      tree: new Map([
        [root, {
          id: root, instanceKey: 'root',
          packageName: '@test/root', packageRoot: '/project',
          children: [qq],
        }],
        [qq, {
          id: qq, instanceKey: 'qq',
          packageName: '@test/qq', packageRoot: '/project/plugins/qq',
          parent: root, children: [qqGroup],
          metadata: { displayName: 'QQ 适配器' },
        }],
        [qqGroup, {
          id: qqGroup, instanceKey: 'group',
          packageName: '@test/qq-group', packageRoot: '/project/plugins/qq-group',
          parent: qq, children: [],
        }],
      ]),
      config: new Map([[root, {}], [qq, {}], [qqGroup, {}]]),
      resources: new Map([[root, new Map()], [qq, new Map()], [qqGroup, new Map()]]),
      capabilities: new Map(slots.map((s) => [s.id, s])),
      projections: new Map(),
    };
    return { root, qq, qqGroup, slots, snapshot };
  }

  it('默认关键词「菜单」展示 root 的指令和子插件', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('菜单');
    expect(result.matched).toBe(true);
    expect(result.command).toBe('菜单');
    const text = result.value as string;
    expect(text).toContain('echo');
    expect(text).toContain('ping');
    expect(text).toContain('测试连通性');
    expect(text).toContain('qq');
    expect(text).toContain('QQ 适配器');
    expect(text).not.toContain('qq.status');
  });

  it('菜单列表自动加上 commandPrefix', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('菜单', undefined, undefined, '#');
    expect(result.matched).toBe(true);
    const text = result.value as string;
    expect(text).toContain('#echo');
    expect(text).toContain('#ping');
    expect(text).toContain('#菜单 <插件名>');
    expect(text).not.toContain('\n  echo\n');
  });

  it('无 commandPrefix 时菜单保持原命令名', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('菜单');
    const text = result.value as string;
    expect(text).toContain('\n  echo\n');
    expect(text).toContain('「菜单 <插件名>」');
  });

  it('「菜单 qq」展示 qq 插件的指令和子插件', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('菜单 qq');
    expect(result.matched).toBe(true);
    const text = result.value as string;
    expect(text).toContain('qq.status');
    expect(text).toContain('QQ 状态');
    expect(text).toContain('qq.group');
    expect(text).toContain('提示');
  });

  it('「菜单 qq.group」展示空子插件提示', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('菜单 qq.group');
    expect(result.matched).toBe(true);
    const text = result.value as string;
    expect(text).toContain('暂无指令和子插件');
  });

  it('不存在的插件 key 返回未找到', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('菜单 nope');
    expect(result.matched).toBe(true);
    expect(result.value).toContain('未找到插件');
  });

  it('自定义关键词生效', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: 'help' });
    const result = await index.dispatch('help');
    expect(result.matched).toBe(true);
    expect(result.value).toContain('echo');
  });

  it('未配置 menu 时不拦截', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot);
    const result = await index.dispatch('菜单');
    expect(result.matched).toBe(false);
  });

  it('菜单关键词不影响普通命令匹配', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch('echo');
    expect(result.matched).toBe(true);
    expect(result.command).toBe('echo');
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
