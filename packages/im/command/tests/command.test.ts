import { describe, expect, it, vi } from 'vitest';
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
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import {
  FeatureDiscovery,
  operationSession,
  type OperationSession,
  type DirectoryEntry,
  type DiscoveryHost,
} from '@zhin.js/feature-kit';

type TestPluginId = ReturnType<typeof rootPluginId>;

interface CommandTestClient {
  readonly id: string;
}

declare class RegisteredTestAdapter {
  readonly adapterEvents: Record<string, unknown>;
  getEndpoint(instanceId: string): CommandTestClient | undefined;
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'command-test': RegisteredTestAdapter; }
}

function slotFor(owner: TestPluginId, localName: string, result = 'ok') {
  return createCapabilitySlot({
    owner,
    feature: commandFeatureId,
    localName,
    source: `/commands/${localName}/index.ts`,
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

  it('defineCommand.withConfig<Config>() validates and brands like the direct form', () => {
    const define = defineCommand.withConfig<{ prefix: string }>();
    const command = define({ params: { word: { type: 'string' } }, execute: ({ params, config }) => `${config.prefix}${params.word}` });
    expect(parseCommandDefinition(command)).toBe(command);
    expect(Object.isFrozen(command)).toBe(true);
    expect(() => define({ params: { word: { type: 'nope' as never } }, execute() {} })).toThrow('Command params.word requires a valid type');
  });

  it('projects owner-bound slots into an executable index', async () => {
    const owner = rootPluginId();
    const command = defineCommand({ execute: ({ args }) => `hello ${args[0]}` });
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'hello',
      source: '/commands/hello/index.ts',
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
      source: '/commands/who/index.ts',
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

    await index.dispatch({ input: 'who', source: {
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
    } });

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
      source: '/commands/client-id/index.ts',
      definition,
    });
    const index = new CommandIndex([slot], snapshotWithOwners([owner], [slot]));

    await expect(index.dispatch({ input: 'client-id', source: {
      clientAdapter: 'other',
      get $client() { reads += 1; return client; },
    } })).resolves.toEqual({ matched: false, status: 'unmatched' });
    expect(reads).toBe(0);

    await expect(index.dispatch({ input: 'client-id', source: {
      clientAdapter: 'command-test',
      get $client() { reads += 1; return client; },
    } })).resolves.toMatchObject({ matched: true, value: 'client-1' });
    expect(reads).toBe(1);
  });

  it('passes the same bound operation Session and preserves optional direct execution', async () => {
    const owner = rootPluginId();
    class NativeEvent { text() { return 'sdk'; } }
    const native = new NativeEvent();
    const client = { id: 'client-1' };
    const session: OperationSession<'command-test'> = {
      adapterName: 'command-test', adapter: {}, endpoint: client,
      scene: { endpoint: { adapter: 'adapter-owner', id: 'canonical' }, kind: 'group', id: 'room', name: 'canonical room' },
      sender: { id: 'speaker', platformRoles: ['admin'], authorizationRoles: ['trusted'] }, message: { text: 'original', receivedAt: 100 }, event: native,
      signal: new AbortController().signal, reply: async () => undefined,
    };
    const contexts: unknown[] = [];
    const definition = defineCommand({ adapter: 'command-test', execute(context) {
      contexts.push(context);
      if (!context.session) return 'direct';
      expect(context.session).toBe(session);
      expect(context.session.event).toBe(native);
      expect(context.$client).toBe(client);
      expect(context.scene).toEqual({ id: 'room', type: 'group', name: 'canonical room' });
      expect(context.sender).toEqual({ id: 'speaker', role: ['trusted', 'admin'] });
      expect(context.endpoint).toBe('account');
      expect(Reflect.set(context, 'session', undefined)).toBe(false);
      return context.session.message.text;
    } });
    const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'bound-session', source: '/commands/bound-session/index.ts', definition });
    const index = new CommandIndex([slot], snapshotWithOwners([owner], [slot]));
    const source = { clientAdapter: 'command-test', endpointId: 'account', metadata: { endpoint: 'wrong-account', group_name: 'wrong room', roles: ['master'] }, $client: client, [operationSession]: () => session };
    await expect(index.dispatch({ input: 'bound-session', source: source })).resolves.toMatchObject({ status: 'executed', value: 'original' });
    await expect(index.dispatch({ input: 'bound-session', source: { ...source, clientAdapter: 'other' } })).resolves.toMatchObject({ status: 'unmatched' });
    await expect(index.execute('bound-session')).resolves.toBe('direct');
    expect(contexts).toHaveLength(2);
  });

  it('discovers nested files as hierarchical command words', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/issue/list/index.ts';
    const command = defineCommand({ execute: ({ args }) => `issues:${args.join(',')}` });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'issue', kind: 'directory' }],
      '/project/commands/gh/issue': [
        { name: 'list', kind: 'directory' },
        { name: 'helper.ts', kind: 'file' },
      ],
      '/project/commands/gh/issue/list': [{ name: 'index.ts', kind: 'file' }],
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

    expect(index.list()).toMatchObject([{
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
    const source = `${root}/commands/gh/[issue]/index.js`;
    const command = defineCommand({
      params: { issue: { type: 'number' } },
      execute: ({ params }) => params.issue,
    });
    const host = new MemoryDiscoveryHost({
      [`${root}/commands`]: [{ name: 'gh', kind: 'directory' }],
      [`${root}/commands/gh`]: [{ name: '[issue]', kind: 'directory' }],
      [`${root}/commands/gh/[issue]`]: [
        { name: 'index.js', kind: 'file' },
        { name: 'index.ts', kind: 'file' },
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
      source: '/commands/gh/issue/list/index.ts',
      definition: defineCommand<{}, string, { sender: string }>({
        execute: ({ args, input }) => `${input.sender?.id}:${args.join(',')}`,
      }),
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    await expect(index.dispatch({ input: 'gh issue list open assigned', source: { sender: { id: 'alice' } } }))
      .resolves.toEqual({
        matched: true,
      status: 'executed',
        command: 'gh issue list',
        owner,
        value: 'alice:open,assigned',
      });
    await expect(index.dispatch({ input: 'gh issue missing' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    await expect(index.dispatch({ input: 'gh issue listing' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('compiles optional filename parameters and applies defaults from params', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/pr/[[title]]/index.ts';
    const command = defineCommand({
      params: { title: { type: 'string', default: 'defaultTitle' } },
      execute: ({ params }) => `${typeof params.title}:${params.title}`,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'pr', kind: 'directory' }],
      '/project/commands/gh/pr': [{ name: '[[title]]', kind: 'directory' }],
      '/project/commands/gh/pr/[[title]]': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    expect(slots.map((slot) => slot.localName)).toEqual(['gh/pr/$title']);

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    expect(index.list()).toMatchObject([{
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
      source: '/commands/gh/issue/[issue]/index.ts',
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
      source: '/commands/gh/pr/list/index.ts',
      definition: defineCommand({ execute: () => 'literal' }),
    });
    const dynamic = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/pr/$title',
      source: '/commands/gh/pr/[title]/index.ts',
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
      source: `/commands/gh/pr/[${name}]/index.ts`,
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

  it('replaces all local static segments via a global alias', async () => {
    const root = rootPluginId();
    const qq = childPluginId(root, 'qq');
    const slot = createCapabilitySlot({
      owner: qq,
      feature: commandFeatureId,
      localName: 'endpoint/list',
      source: '/commands/endpoint/list/index.ts',
      definition: defineCommand({
        alias: ['ep', 'e l'],
        execute: ({ args }) => `list:${args.join(',')}`,
      }),
    });
    const index = new CommandIndex([slot], snapshotWithOwners([qq], [slot]));

    expect(index.list()[0]).toMatchObject({
      name: 'endpoint list',
      alias: ['ep', 'e l'],
    });
    await expect(index.dispatch({ input: 'ep' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      command: 'endpoint list',
      value: 'list:',
    });
    await expect(index.dispatch({ input: 'e l open' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      value: 'list:open',
    });
    await expect(index.dispatch({ input: 'qq.ep' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('matches multi-word alias with trailing dynamic params', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'bugs/$id',
      source: '/commands/bugs/[id]/index.ts',
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

    await expect(index.dispatch({ input: 'gh issue 42' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      value: 'bug:42',
    });
    await expect(index.dispatch({ input: 'bugs 7' })).resolves.toMatchObject({ value: 'bug:7' });
  });

  it('allows b and b list as distinct alias sequences', async () => {
    const owner = rootPluginId();
    const short = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'alpha',
      source: '/commands/alpha/index.ts',
      definition: defineCommand({ alias: ['b'], execute: () => 'short' }),
    });
    const longer = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'beta',
      source: '/commands/beta/index.ts',
      definition: defineCommand({ alias: ['b list'], execute: () => 'long' }),
    });
    const index = new CommandIndex([short, longer], snapshotFor(owner, [short, longer]));

    await expect(index.dispatch({ input: 'b' })).resolves.toMatchObject({ value: 'short' });
    await expect(index.dispatch({ input: 'b list' })).resolves.toMatchObject({ value: 'long' });
  });

  it('dispatches global shortcut with prefilled params and rejects trailing text', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'bugs/$id',
      source: '/commands/bugs/[id]/index.ts',
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
      source: '/remind/commands/ping/index.ts',
      definition: defineCommand({
        shortcut: { '叮': {} },
        execute: () => 'pong',
      }),
    });
    const index = new CommandIndex(
      [slot, namespaced],
      snapshotWithOwners([owner, child], [slot, namespaced]),
    );

    await expect(index.dispatch({ input: '开虫' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      value: 'bug:9',
    });
    await expect(index.dispatch({ input: '开虫 1' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    await expect(index.dispatch({ input: '叮' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      value: 'pong',
      command: 'ping',
    });
  });

  it('resolves dynamic shortcut values from CommandSession at dispatch time', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'profile',
      source: '/commands/profile/index.ts',
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

    const result = await index.dispatch({ input: '查看我的信息', source: fakeMessage });
    expect(result).toMatchObject({
      matched: true,
      status: 'executed',
      value: 'profile:12345',
    });

    const noSender = await index.dispatch({ input: '查看我的信息' });
    expect(noSender).toMatchObject({
      matched: true,
      status: 'executed',
      value: 'profile:unknown',
    });
  });

  it('reads enriched sender.roles including master/trusted from upstream', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'whoami',
      source: '/commands/whoami/index.ts',
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
    const masterResult = await index.dispatch({ input: '我是谁', source: masterMessage });
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
    const trustedResult = await index.dispatch({ input: '我是谁', source: trustedMessage });
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
    const plainResult = await index.dispatch({ input: '我是谁', source: plainMessage });
    expect(plainResult).toMatchObject({ matched: true, value: 'admin' });
  });

  it('reports permit failure separately and skips permit on execute', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'secret',
      source: '/commands/secret/index.ts',
      definition: defineCommand({
        permit: ['adapter(icqq)', 'role(master)'],
        execute: () => 'ok',
      }),
    });
    const snapshot = snapshotFor(owner, [slot]);
    snapshot.resources.get(owner)!.set(permissionHostToken.id, new PermissionHost());
    const index = new CommandIndex([slot], snapshot);

    await expect(index.dispatch({ input: 'secret', source: {
      conversation: {
        endpoint: { id: 'root/discord\0x', adapter: 'root/discord' },
        kind: 'private',
        id: '1',
      },
      content: 'secret',
      sender: { id: '1' },
      metadata: { isMaster: true },
    } })).resolves.toMatchObject({ matched: true, status: 'denied' });

    await expect(index.dispatch({ input: 'secret', source: {
      conversation: {
        endpoint: { id: 'root/icqq\0x', adapter: 'root/icqq' },
        kind: 'private',
        id: '1',
      },
      content: 'secret',
      sender: { id: '1' },
      metadata: { isMaster: true },
    } })).resolves.toMatchObject({ matched: true, value: 'ok' });

    await expect(index.execute('secret')).rejects.toThrow('Permission denied');
  });

  it.each(['guarded', 'shortcut'])('uses operation permission resources for reused %s while an old check drains', async (input) => {
    const owner = rootPluginId();
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slot = createCapabilitySlot({
      owner, feature: commandFeatureId, localName: 'guarded', source: '/commands/guarded/index.ts',
      definition: defineCommand({ permit: ['role(admin)'], shortcut: { shortcut: {} }, execute: ({ generation }) => { executions++; return generation; } }),
    });
    const old = snapshotFor(owner, [slot]);
    const oldHost = new PermissionHost();
    oldHost.checkAll = async () => { await gate; return true; };
    old.resources.get(owner)!.set(permissionHostToken.id, oldHost);
    const newHost = new PermissionHost();
    let newChecks = 0;
    newHost.checkAll = async () => { newChecks++; return false; };
    const current = { ...old, generation: 2, resources: new Map([[owner, new Map([[permissionHostToken.id, newHost]])]]) };
    const index = new CommandIndex([slot], old);
    const source = { conversation: { endpoint: { id: 'ep', adapter: 'test' }, kind: 'private', id: 'room' }, sender: { id: 'actor' } };
    const draining = index.dispatch({ input: input, source: source, commandPrefix: '', snapshot: old });
    await expect(index.dispatch({ input: input, source: source, commandPrefix: '', snapshot: current })).resolves.toMatchObject({ matched: true, status: 'denied' });
    expect(newChecks).toBe(1);
    expect(executions).toBe(0);
    release();
    await expect(draining).resolves.toMatchObject({ matched: true, value: 1 });
    expect(executions).toBe(1);
  });

  it('fails closed on asynchronous permit errors without executing the command', async () => {
    const owner = rootPluginId();
    let executions = 0;
    const slot = createCapabilitySlot({
      owner, feature: commandFeatureId, localName: 'guarded', source: '/commands/guarded/index.ts',
      definition: defineCommand({ permit: ['role(admin)'], execute: () => { executions++; return 'ok'; } }),
    });
    const snapshot = snapshotFor(owner, [slot]);
    const host = new PermissionHost();
    const failure = new Error('permission backend unavailable');
    host.checkAll = async () => { await Promise.resolve(); throw failure; };
    snapshot.resources.get(owner)!.set(permissionHostToken.id, host);
    const index = new CommandIndex([slot], snapshot);
    const source = { conversation: { endpoint: { id: 'ep', adapter: 'test' }, kind: 'private', id: 'room' }, sender: { id: 'actor' } };
    await expect(index.dispatch({ input: 'guarded', source: source })).rejects.toBe(failure);
    expect(executions).toBe(0);
    host.checkAll = async () => false;
    await expect(index.dispatch({ input: 'guarded', source: source })).resolves.toMatchObject({ matched: true, status: 'denied' });
    expect(executions).toBe(0);
    host.checkAll = async () => true;
    await expect(index.dispatch({ input: 'guarded', source: source })).resolves.toMatchObject({ matched: true, value: 'ok' });
    expect(executions).toBe(1);
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
      source: '/commands/zan/index.ts',
      definition: defineCommand({ execute: () => 'a' }),
    });
    const aliasClash = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'other',
      source: '/commands/other/index.ts',
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
      source: '/commands/hello/index.ts',
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
        source: '/commands/bugs/[id]/index.ts',
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
      '/project/commands': [{ name: '[count:number]', kind: 'directory' }],
    }, new Map());

    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow(CommandPathSyntaxError);
    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('Invalid Command path [count:number]');
  });

  it('discovers structured parameter files via params declarations', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/upload/[asset]/index.ts';
    const command = defineCommand({
      params: { asset: { type: 'image' } },
      execute: ({ params }) => params.asset,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'upload', kind: 'directory' }],
      '/project/commands/upload': [{ name: '[asset]', kind: 'directory' }],
      '/project/commands/upload/[asset]': [{ name: 'index.ts', kind: 'file' }],
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

  it('keeps owner identity separate from the user route', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const rootSlot = createCapabilitySlot({
      owner: root,
      feature: commandFeatureId,
      localName: 'child/status',
      source: '/commands/child/status/index.ts',
      definition: defineCommand({ execute: () => 'root' }),
    });
    const childSlot = createCapabilitySlot({
      owner: child,
      feature: commandFeatureId,
      localName: 'status',
      source: '/plugins/child/commands/status/index.ts',
      definition: defineCommand({ execute: () => 'child' }),
    });
    const snapshot = snapshotWithOwners([child], [rootSlot, childSlot]);

    const index = new CommandIndex([rootSlot, childSlot], snapshot);
    await expect(index.dispatch({ input: 'child status' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      owner: root,
      value: 'root',
    });
    await expect(index.dispatch({ input: 'status' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      owner: child,
      value: 'child',
    });
    await expect(index.dispatch({ input: 'child.status' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('rejects the same user route published by different owners', () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const rootSlot = slotFor(root, 'status');
    const childSlot = slotFor(child, 'status');

    expect(() => new CommandIndex(
      [rootSlot, childSlot],
      snapshotWithOwners([child], [rootSlot, childSlot]),
    )).toThrow(/Duplicate Command route "status"/);
  });

  it('uses only an explicitly configured plugin commandNamespace', async () => {
    const root = rootPluginId();
    const child = childPluginId(root, 'child');
    const rootSlot = slotFor(root, 'status', 'root');
    const childSlot = createCapabilitySlot({
      owner: child,
      feature: commandFeatureId,
      localName: 'status',
      source: '/plugins/child/commands/status/index.ts',
      definition: defineCommand({
        alias: ['state'],
        shortcut: { '状态': {} },
        execute: () => 'child',
      }),
    });
    const base = snapshotWithOwners([child], [rootSlot, childSlot]);
    const snapshot: RuntimeSnapshot = {
      ...base,
      config: new Map([
        [root, {}],
        [child, { commandNamespace: 'child admin' }],
      ]),
    };
    const index = new CommandIndex([rootSlot, childSlot], snapshot);

    await expect(index.dispatch({ input: 'status' })).resolves.toMatchObject({ value: 'root' });
    await expect(index.dispatch({ input: 'child admin status' })).resolves.toMatchObject({ value: 'child' });
    await expect(index.dispatch({ input: 'child admin state' })).resolves.toMatchObject({ value: 'child' });
    await expect(index.dispatch({ input: 'child admin 状态' })).resolves.toMatchObject({ value: 'child' });
    await expect(index.dispatch({ input: 'child status' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('leaves commands listed in the instance disabledCommands out of routing', async () => {
    const owner = rootPluginId();
    const slot = (localName: string, value: string) => createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName,
      source: `/commands/${localName}/index.ts`,
      definition: defineCommand({ execute: () => value }),
    });
    const fanyi = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'fanyi/$text',
      source: '/commands/fanyi/[text]/index.ts',
      definition: defineCommand({ params: { text: { type: 'string' } }, execute: () => 'fanyi' }),
    });
    const slots = [slot('kfc', 'kfc'), fanyi, slot('netease/login', 'login'), slot('netease/status', 'status'), slot('news', 'news')];
    const base = snapshotFor(owner, slots);
    const index = new CommandIndex(slots, {
      ...base,
      config: new Map([[owner, { commandNamespace: 'daily', disabledCommands: ['fanyi', 'netease', 'missing'] }]]),
    });

    expect(index.list().map((command) => command.name)).toEqual(['daily kfc', 'daily news']);
    await expect(index.dispatch({ input: 'daily kfc' })).resolves.toMatchObject({ value: 'kfc' });
    await expect(index.dispatch({ input: 'daily fanyi hello' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    await expect(index.dispatch({ input: 'daily netease login' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    // A malformed value fails fast instead of silently enabling everything.
    expect(() => new CommandIndex(slots, { ...base, config: new Map([[owner, { disabledCommands: 'kfc' }]]) }))
      .toThrow(/Invalid disabledCommands/);
  });

  it('dispatches Unicode command names (e.g. Chinese 赞我)', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: '赞我',
      source: '/commands/赞我/index.ts',
      definition: defineCommand({ execute: ({ args }) => `liked:${args[0] ?? 'self'}` }),
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));
    await expect(index.dispatch({ input: '赞我' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      command: '赞我',
      value: 'liked:self',
    });
    await expect(index.dispatch({ input: '赞我 10' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      value: 'liked:10',
    });
  });

  it('leaves fuzzy text unmatched for a fully dynamic typed parameter route', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: '$delay',
      source: '/commands/[delay]/index.ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `wait:${params.delay}` }),
        $parameter: { name: 'delay', type: 'number' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    // 普通文本命中数字参数路由时不得抛出，应视为未命中。
    await expect(index.dispatch({ input: 'hello' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    await expect(index.dispatch({ input: '30' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      value: 'wait:30',
    });
  });

  it('does not match empty input against optional-parameter commands', async () => {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'gh/pr/$title',
      source: '/commands/gh/pr/[[title]]/index.ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `pr:${params.title}` }),
        $parameter: { name: 'title', type: 'string', defaultValue: 'defaultTitle' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotFor(owner, [slot]));

    await expect(index.dispatch({ input: '' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    expect(index.has('')).toBe(false);
    await expect(index.execute('gh pr')).resolves.toBe('pr:defaultTitle');
  });

  it('prefers the dynamic route with more static segments', async () => {
    const owner = rootPluginId();
    const generic = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'foo/$value',
      source: '/commands/foo/[value]/index.ts',
      definition: {
        ...defineCommand({ execute: ({ params }) => `generic:${params.value}` }),
        $parameter: { name: 'value', type: 'string' } as const,
      },
    });
    const specific = createCapabilitySlot({
      owner,
      feature: commandFeatureId,
      localName: 'foo/bar/$value',
      source: '/commands/foo/bar/[[value]]/index.ts',
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
      source: '/commands/upload/[asset]/index.ts',
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

    await expect(index.dispatch({ input: segments })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
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
    const source = '/project/commands/files/[...slug]/index.ts';
    const command = defineCommand({
      params: { slug: { type: 'text' } },
      execute: ({ params }) => params.slug,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'files', kind: 'directory' }],
      '/project/commands/files': [{ name: '[...slug]', kind: 'directory' }],
      '/project/commands/files/[...slug]': [{ name: 'index.ts', kind: 'file' }],
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
    await expect(index.dispatch({ input: [
      { type: 'text', data: { text: 'files a' } },
      { type: 'text', data: { text: 'b' } },
      { type: 'text', data: { text: 'c' } },
    ] })).resolves.toMatchObject({ matched: true, value: ['a', 'b', 'c'] });
    // 必需捕获所有：零段输入视为不匹配该命令
    expect(index.has('files')).toBe(false);
    await expect(index.dispatch({ input: 'files' })).resolves.toMatchObject({ matched: true, status: 'invalid' });
  });

  it('matches optional catch-all [[...slug]] with zero segments as an empty array', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/files/[[...slug]]/index.ts';
    const command = defineCommand({
      params: { slug: { type: 'text', rest: true, default: [] } },
      execute: ({ params }) => params.slug,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'files', kind: 'directory' }],
      '/project/commands/files': [{ name: '[[...slug]]', kind: 'directory' }],
      '/project/commands/files/[[...slug]]': [{ name: 'index.ts', kind: 'file' }],
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
    await expect(index.dispatch({ input: [
      { type: 'text', data: { text: 'files a' } },
      { type: 'text', data: { text: 'b' } },
    ] })).resolves.toMatchObject({ matched: true, value: ['a', 'b'] });
  });

  it('splits word-typed catch-all [...slug] per word', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/files/[...slug]/index.ts';
    const command = defineCommand({
      params: { slug: { type: 'word' } },
      execute: ({ params }) => params.slug,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'files', kind: 'directory' }],
      '/project/commands/files': [{ name: '[...slug]', kind: 'directory' }],
      '/project/commands/files/[...slug]': [{ name: 'index.ts', kind: 'file' }],
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
    const source = '/project/commands/sum/[...nums]/index.ts';
    const command = defineCommand({
      params: { nums: { type: 'number' } },
      execute: ({ params }) => params.nums,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'sum', kind: 'directory' }],
      '/project/commands/sum': [{ name: '[...nums]', kind: 'directory' }],
      '/project/commands/sum/[...nums]': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));
    const slots = await new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);

    const index = new CommandIndex(slots, snapshotFor(owner, slots));
    await expect(index.execute('sum 1 2 3.5')).resolves.toEqual([1, 2, 3.5]);
    // 任一词无法转换为 number 即整体不匹配
    expect(index.has('sum 1 x')).toBe(false);
    await expect(index.dispatch({ input: 'sum 1 x' })).resolves.toMatchObject({ matched: true, status: 'invalid' });
  });

  it('matches optional [[name]] without default as undefined when omitted', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/gh/pr/[[title]]/index.ts';
    const command = defineCommand({
      params: { title: { type: 'text' } },
      execute: ({ params }) => `title:${String(params.title)}`,
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'gh', kind: 'directory' }],
      '/project/commands/gh': [{ name: 'pr', kind: 'directory' }],
      '/project/commands/gh/pr': [{ name: '[[title]]', kind: 'directory' }],
      '/project/commands/gh/pr/[[title]]': [{ name: 'index.ts', kind: 'file' }],
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
      source: `/commands/${localName.replaceAll('$', '[param]')}/index.ts`,
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
    const source = '/project/commands/search/[query]/index.ts';
    const command = defineCommand({ execute: () => 'ok' });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'search', kind: 'directory' }],
      '/project/commands/search': [{ name: '[query]', kind: 'directory' }],
      '/project/commands/search/[query]': [{ name: 'index.ts', kind: 'file' }],
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

  it('explains the single trailing parameter directory rule for nested parameter directories', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/term/[word]/[...definition]/index.ts';
    const command = defineCommand({
      params: {
        word: { type: 'string' },
        definition: { type: 'text', rest: true },
      },
      execute: () => 'ok',
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'term', kind: 'directory' }],
      '/project/commands/term': [{ name: '[word]', kind: 'directory' }],
      '/project/commands/term/[word]': [{ name: '[...definition]', kind: 'directory' }],
      '/project/commands/term/[word]/[...definition]': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    const discovery = new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);
    const error = await discovery.then(() => undefined, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(CommandPathSyntaxError);
    const message = (error as Error).message;
    expect(message).toContain(source);
    expect(message).toContain('only the last directory of a command path may be a parameter directory');
    expect(message).toContain('found [word], [...definition] in commands/term/[word]/[...definition]/index.ts');
    expect(message).toContain('commands/term/[word]/index.ts');
    expect(message).toContain("word: { type: 'string' }, definition: { type: 'text', rest: true }");
    expect(message).not.toContain('must be the first parameter declaration');
  });

  it('rejects a parameter directory followed by a static directory with a corrected path', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/[name]/info/index.ts';
    const command = defineCommand({
      params: { name: { type: 'string' } },
      execute: () => 'ok',
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: '[name]', kind: 'directory' }],
      '/project/commands/[name]': [{ name: 'info', kind: 'directory' }],
      '/project/commands/[name]/info': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    const discovery = new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);

    await expect(discovery).rejects.toThrow(CommandPathSyntaxError);
    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('e.g. commands/info/[name]/index.ts');
  });

  it('explains how to reorder params when the directory parameter is not declared first', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/term/[word]/index.ts';
    const command = defineCommand({
      params: {
        language: { type: 'string' },
        word: { type: 'string' },
      },
      execute: () => 'ok',
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'term', kind: 'directory' }],
      '/project/commands/term': [{ name: '[word]', kind: 'directory' }],
      '/project/commands/term/[word]': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    const discovery = new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }]);

    await expect(discovery).rejects.toThrow(
      'Current order: { language, word }; reorder to { word, language }',
    );
  });

  it('rejects a required filename whose params entry declares a default', async () => {
    const owner = rootPluginId();
    const source = '/project/commands/search/[query]/index.ts';
    const command = defineCommand({
      params: { query: { type: 'text', default: 'all' } },
      execute: () => 'ok',
    });
    const host = new MemoryDiscoveryHost({
      '/project/commands': [{ name: 'search', kind: 'directory' }],
      '/project/commands/search': [{ name: '[query]', kind: 'directory' }],
      '/project/commands/search/[query]': [{ name: 'index.ts', kind: 'file' }],
    }, new Map([[source, { default: command }]]));

    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow(CommandPathSyntaxError);
    await expect(new FeatureDiscovery(host).discover(commandFeature, [{
      owner,
      packageRoot: '/project',
    }])).rejects.toThrow('has a default but the directory is required');
  });
});

describe('命令用户路由与 owner 身份分离', () => {
  const root = rootPluginId();
  const qq = childPluginId(root, 'qq');
  const nested = childPluginId(childPluginId(root, 'b'), 'a');

  it('单级挂载不把 owner 拼进用户路由', async () => {
    const slot = slotFor(qq, 'endpoint/list', 'listed');
    const index = new CommandIndex([slot], snapshotWithOwners([qq], [slot]));

    expect(index.list()[0]!.name).toBe('endpoint list');
    await expect(index.dispatch({ input: 'endpoint list' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      command: 'endpoint list',
      owner: qq,
      value: 'listed',
    });
    await expect(index.dispatch({ input: 'qq.endpoint list' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('多级 owner 仍只发布本地能力路径', async () => {
    const slot = slotFor(nested, 'foo', 'nested-ok');
    const index = new CommandIndex([slot], snapshotWithOwners([nested], [slot]));

    expect(index.list()[0]!.name).toBe('foo');
    await expect(index.execute('foo')).resolves.toBe('nested-ok');
    await expect(index.dispatch({ input: 'foo' })).resolves.toMatchObject({ matched: true });
    await expect(index.dispatch({ input: 'b.a.foo' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    await expect(index.dispatch({ input: 'b a foo' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('root 插件命令无前缀（不变）', async () => {
    const slot = slotFor(root, 'foo');
    const index = new CommandIndex([slot], snapshotWithOwners([], [slot]));

    expect(index.list()[0]!.name).toBe('foo');
    await expect(index.dispatch({ input: 'foo' })).resolves.toMatchObject({ matched: true });
  });

  it('owner 点号路径不再形成隐式命令', async () => {
    const b = childPluginId(root, 'b');
    const slot = slotFor(b, 'foo');
    const index = new CommandIndex([slot], snapshotWithOwners([b], [slot]));

    await expect(index.dispatch({ input: 'b.foobar' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    await expect(index.dispatch({ input: 'foo extra args' })).resolves.toMatchObject({
      matched: true,
      status: 'executed',
      command: 'foo',
    });
    await expect(index.dispatch({ input: 'b.foo' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('子插件可发布顶层动态首段', async () => {
    const remind = childPluginId(root, 'remind');
    const slot = createCapabilitySlot({
      owner: remind,
      feature: commandFeatureId,
      localName: '$note',
      source: 'plugins/remind/commands/[note]/index.ts',
      definition: {
        ...defineCommand({ execute: () => 'x' }),
        $parameter: { name: 'note', type: 'string' } as const,
      },
    });
    const index = new CommandIndex([slot], snapshotWithOwners([remind], [slot]));

    expect(index.list()[0]?.name).toBe('<note>');
    await expect(index.execute('hello')).resolves.toBe('x');
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
        source: '/commands/ping/index.ts',
        definition: defineCommand({ description: '测试连通性', execute: () => 'pong' }),
      }),
      createCapabilitySlot({
        owner: qq,
        feature: commandFeatureId,
        localName: 'status',
        source: '/commands/status/index.ts',
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
    const result = await index.dispatch({ input: '菜单' });
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
    const result = await index.dispatch({ input: '菜单', commandPrefix: '#' });
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
    const result = await index.dispatch({ input: '菜单' });
    const text = result.value as string;
    expect(text).toContain('\n  echo\n');
    expect(text).toContain('「菜单 <插件名>」');
  });

  it('「菜单 qq」展示 qq 插件的指令和子插件', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch({ input: '菜单 qq' });
    expect(result.matched).toBe(true);
    const text = result.value as string;
    expect(text).toContain('status');
    expect(text).toContain('QQ 状态');
    expect(text).toContain('qq.group');
    expect(text).toContain('提示');
  });

  it('「菜单 qq.group」展示空子插件提示', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch({ input: '菜单 qq.group' });
    expect(result.matched).toBe(true);
    const text = result.value as string;
    expect(text).toContain('暂无指令和子插件');
  });

  it('不存在的插件 key 返回未找到', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch({ input: '菜单 nope' });
    expect(result.matched).toBe(true);
    expect(result.value).toContain('未找到插件');
  });

  it('自定义关键词生效', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: 'help' });
    const result = await index.dispatch({ input: 'help' });
    expect(result.matched).toBe(true);
    expect(result.value).toContain('echo');
  });

  it('未配置 menu 时不拦截', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot);
    const result = await index.dispatch({ input: '菜单' });
    expect(result.matched).toBe(false);
  });

  it('菜单关键词不影响普通命令匹配', async () => {
    const { slots, snapshot } = menuSnapshot();
    const index = new CommandIndex(slots, snapshot, { keyword: '菜单' });
    const result = await index.dispatch({ input: 'echo' });
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

describe('central command argument declarations', () => {
  function indexFor(definition: ReturnType<typeof defineCommand>, localName = 'remind', parameter?: CommandParameterDefinition) {
    const owner = rootPluginId();
    const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName, source: '/commands/remind/index.ts', definition: parameter ? { ...definition, $parameter: parameter } : definition });
    return new CommandIndex([slot], snapshotFor(owner, [slot]));
  }

  it('parses multiple parameters, defaults, interleaved options and negative numbers', async () => {
    const index = indexFor(defineCommand({
      params: { minutes: { type: 'integer', min: -5 }, note: { type: 'text', default: 'take a break' } },
      options: { count: { type: 'integer', alias: 'c', default: 1, min: 1 }, quiet: { type: 'boolean', default: false } },
      execute: ({ params, options }) => ({ params, options }),
    }));
    await expect(index.dispatch({ input: 'remind -2 --count 3 --quiet hello world' })).resolves.toMatchObject({ status: 'executed', value: { params: { minutes: -2, note: 'hello world' }, options: { count: 3, quiet: true } } });
    await expect(index.dispatch({ input: 'remind 2' })).resolves.toMatchObject({ value: { params: { note: 'take a break' }, options: { count: 1, quiet: false } } });
    await expect(index.execute('remind 2', ['--count', '4', 'wake', 'up'])).resolves.toMatchObject({ params: { minutes: 2, note: 'wake up' }, options: { count: 4 } });
  });

  it('supports options before directory-bound parameters through the same index', async () => {
    const index = indexFor(defineCommand({ params: { id: { type: 'integer' }, count: { type: 'integer' } }, options: { quiet: { type: 'boolean' } }, execute: ({ params, options }) => ({ params, options }) }), 'foo/$id', { name: 'id', type: 'integer' });
    await expect(index.dispatch({ input: 'foo --quiet 7 2' })).resolves.toMatchObject({ status: 'executed', value: { params: { id: 7, count: 2 }, options: { quiet: true } } });
  });

  it('parses inline quoted option values without leaking their tokens into positional text', async () => {
    const index = indexFor(defineCommand({
      params: { body: { type: 'text' } },
      options: { note: { type: 'string', alias: 'n' } },
      execute: ({ params, options }) => ({ params, options }),
    }));
    await expect(index.dispatch({ input: 'remind --note="hello world" actual body' })).resolves.toMatchObject({
      status: 'executed', value: { params: { body: 'actual body' }, options: { note: 'hello world' } },
    });
    await expect(index.dispatch({ input: "remind -n='hello world' actual body" })).resolves.toMatchObject({
      status: 'executed', value: { params: { body: 'actual body' }, options: { note: 'hello world' } },
    });
    await expect(index.dispatch({ input: 'remind --note="say \\\"hi\\\"" actual body' })).resolves.toMatchObject({
      status: 'executed', value: { params: { body: 'actual body' }, options: { note: 'say "hi"' } },
    });
  });

  it('collects text catch-all values by message segment when options are declared', async () => {
    const index = indexFor(defineCommand({
      params: { slug: { type: 'text', rest: true } },
      options: { quiet: { type: 'boolean' } },
      execute: ({ params, options }) => ({ params, options }),
    }), 'files/$slug', { name: 'slug', type: 'text', rest: true });
    await expect(index.dispatch({ input: 'files hello world --quiet' })).resolves.toMatchObject({
      status: 'executed', value: { params: { slug: ['hello world'] }, options: { quiet: true } },
    });
    await expect(index.dispatch({ input: [
      { type: 'text', data: { text: 'files --quiet first item  ' } },
      { type: 'text', data: { text: '\n second "quoted"\n  line' } },
    ] })).resolves.toMatchObject({
      status: 'executed', value: { params: { slug: ['first item  ', '\n second "quoted"\n  line'] }, options: { quiet: true } },
    });
  });

  it('treats Object.prototype names as ordinary declared fields, including omitted options', async () => {
    const index = indexFor(defineCommand({
      params: { constructor: { type: 'string' }, toString: { type: 'string' } },
      options: { constructor: { type: 'string' }, toString: { type: 'string', default: 'default' }, valueOf: { type: 'string' } },
      execute: ({ params, options }) => ({ params, options, omitted: options.valueOf }),
    }));
    await expect(index.dispatch({ input: 'remind first second --constructor chosen' })).resolves.toMatchObject({
      status: 'executed', value: { params: { constructor: 'first', toString: 'second' }, options: { constructor: 'chosen', toString: 'default' }, omitted: undefined },
    });
    await expect(index.dispatch({ input: 'remind first second --constructor one --constructor two' })).resolves.toMatchObject({ status: 'invalid' });
  });

  it('preserves structured arguments and quoted option-like values', async () => {
    const index = indexFor(defineCommand({ params: { who: { type: 'mention' }, caption: { type: 'string' } }, options: { count: { type: 'integer', default: 1 } }, execute: ({ params, options }) => ({ params, options }) }), 'upload');
    await expect(index.dispatch({ input: [{ type: 'text', data: { text: 'upload --count 2 ' } }, { type: 'mention', data: { target: 'alice' } }, { type: 'text', data: { text: ' "--option-like text"' } }] })).resolves.toMatchObject({ status: 'executed', value: { params: { who: 'alice', caption: '--option-like text' }, options: { count: 2 } } });
  });

  it('retains code whitespace and quotes when parsing text', async () => {
    const index = indexFor(defineCommand({ params: { code: { type: 'text' } }, options: { timeout: { type: 'integer', default: 30 } }, execute: ({ params }) => params.code }), 'run');
    await expect(index.dispatch({ input: 'run --timeout 5 if True:\n  print("hello world")' })).resolves.toMatchObject({ value: 'if True:\n  print("hello world")' });
  });

  it.each(['remind', 'remind nope', 'remind 0', 'remind 3 --count nope', 'remind 3 --unknown', 'remind 3 --count 1 --count 2'])('reports invalid arguments without executing: %s', async (input) => {
    const execute = vi.fn();
    const index = indexFor(defineCommand({ params: { minutes: { type: 'integer', min: 1 } }, options: { count: { type: 'integer', default: 1 } }, execute }));
    const result = await index.dispatch({ input: input, commandPrefix: '#' });
    expect(result).toMatchObject({ matched: true, status: 'invalid', help: expect.stringContaining('#remind <minutes>') });
    expect(result.issues?.length).toBeGreaterThan(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('validates shortcut and session-dependent defaults with the same constraints', async () => {
    const index = indexFor(defineCommand({ params: { minutes: { type: 'integer', min: 1, default: () => 0 } }, shortcut: { later: { minutes: 0 } }, execute: () => 'should not run' }));
    await expect(index.dispatch({ input: 'later' })).resolves.toMatchObject({ status: 'invalid' });
    await expect(index.dispatch({ input: 'remind' })).resolves.toMatchObject({ status: 'invalid' });
    const rest = indexFor(defineCommand({ params: { values: { type: 'integer', rest: true, default: () => 1 } }, execute: () => 'should not run' }));
    await expect(rest.dispatch({ input: 'remind' })).resolves.toMatchObject({ status: 'invalid' });
  });

  it('does not replace invalid supplied parameters with defaults or treat them as omitted', async () => {
    const execute = vi.fn();
    const withDefault = indexFor(defineCommand({ params: { minutes: { type: 'integer', default: 1 } }, execute }));
    const optional = indexFor(defineCommand({ params: { minutes: { type: 'integer', optional: true } }, execute }));
    await expect(withDefault.dispatch({ input: 'remind nope' })).resolves.toMatchObject({ status: 'invalid', issues: [{ field: 'minutes', code: 'expectedType', message: 'minutes：应为 integer' }] });
    await expect(optional.dispatch({ input: 'remind nope' })).resolves.toMatchObject({ status: 'invalid' });
    await expect(withDefault.execute('remind', ['nope'])).rejects.toThrow('minutes：应为 integer');
    expect(execute).not.toHaveBeenCalled();
    await expect(withDefault.dispatch({ input: 'remind' })).resolves.toMatchObject({ status: 'executed' });
  });

  it('generates prefix and namespace aware help without executing', async () => {
    const owner = rootPluginId();
    const execute = vi.fn();
    const definition = defineCommand({ description: 'Reminder', params: { minutes: { type: 'integer', min: 1 } }, options: { count: { type: 'integer', default: 1 } }, execute });
    const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'remind', source: '/commands/remind/index.ts', definition });
    const snapshot = snapshotFor(owner, [slot]);
    const index = new CommandIndex([slot], { ...snapshot, config: new Map([[owner, { commandNamespace: 'daily' }]]) });
    const result = await index.dispatch({ input: 'daily remind --help', commandPrefix: '#' });
    expect(String(result.value)).toContain('#daily remind <minutes> [--count <integer>]');
    expect(String(result.value)).toContain('默认值：1');
    expect(execute).not.toHaveBeenCalled();
    expect(index.list()[0]?.usage).toBe('daily remind <minutes> [--count <integer>]');
  });

  it('leaves normal chat, token-prefix accidents and ambiguous dynamic input unmatched', async () => {
    const index = indexFor(defineCommand({ params: { value: { type: 'integer' } }, execute: () => 'ok' }), '$value', { name: 'value', type: 'integer' });
    await expect(index.dispatch({ input: 'hello everyone' })).resolves.toEqual({ matched: false, status: 'unmatched' });
    const staticIndex = indexFor(defineCommand({ params: { minutes: { type: 'integer' } }, execute: () => 'ok' }));
    await expect(staticIndex.dispatch({ input: 'reminder 3' })).resolves.toEqual({ matched: false, status: 'unmatched' });
  });

  it('requires an actual permission subject for restricted Host calls', async () => {
    const owner = rootPluginId();
    const execute = vi.fn().mockReturnValue('ok');
    const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'secret', source: '/commands/secret/index.ts', definition: defineCommand({ permit: ['role(master)'], execute }) });
    const snapshot = snapshotFor(owner, [slot]);
    const index = new CommandIndex([slot], { ...snapshot, resources: new Map([[owner, new Map([[permissionHostToken.id, new PermissionHost()]])]]) });
    await expect(index.dispatch({ input: 'secret' })).resolves.toMatchObject({ status: 'denied' });
    await expect(index.execute('secret')).rejects.toThrow('Permission denied');
    expect(execute).not.toHaveBeenCalled();
    await expect(index.dispatch({ input: 'secret', source: { sender: { id: 'operator', role: ['master'] } } })).resolves.toMatchObject({ status: 'executed', value: 'ok' });
  });

  it('rejects impossible declarations before startup', () => {
    expect(() => defineCommand({ params: { n: { type: 'integer', default: 'oops' } }, execute() {} })).toThrow('default');
    expect(() => defineCommand({ params: { n: { type: 'integer', default: [] } }, execute() {} })).toThrow('rest: true');
    expect(() => defineCommand({ params: { n: { type: 'integer', min: 5, max: 1 } }, execute() {} })).toThrow('bounds');
    expect(() => defineCommand({ params: { first: { type: 'string', optional: true }, last: { type: 'string' } }, execute() {} })).toThrow('optional');
    expect(() => defineCommand({ options: { help: { type: 'boolean' } }, execute() {} })).toThrow('reserved');
    expect(() => defineCommand({ options: { one: { type: 'boolean', alias: 'a' }, two: { type: 'boolean', alias: 'a' } }, execute() {} })).toThrow('alias');
  });

  it.each([
    { x: { type: 'string' as const }, y: { type: 'string' as const, optional: true } },
    { x: { type: 'string' as const }, y: { type: 'string' as const, default: 'fallback' } },
    { x: { type: 'string' as const }, rest: { type: 'word' as const, rest: true, optional: true } },
    { rest: { type: 'word' as const, rest: true } },
  ])('rejects declaration and directory route overlaps at every accepted arity: %j', (params) => {
    const owner = rootPluginId();
    const declared = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'foo', source: '/commands/foo/index.ts', definition: defineCommand({ params, execute() {} }) });
    const dynamic = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'foo/$id', source: '/commands/foo/[id]/index.ts', definition: { ...defineCommand({ params: { id: { type: 'string' } }, execute() {} }), $parameter: { name: 'id', type: 'string' } as const } });
    expect(() => new CommandIndex([declared, dynamic], snapshotFor(owner, [declared, dynamic]))).toThrow('Duplicate Command route');
  });

  it('rejects rest overlaps beyond the minimum arity', () => {
    const owner = rootPluginId();
    const rest = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'foo', source: '/commands/foo/index.ts', definition: defineCommand({ params: { values: { type: 'word', rest: true } }, execute() {} }) });
    const fixed = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'foo/$id', source: '/commands/foo/[id]/index.ts', definition: { ...defineCommand({ params: { id: { type: 'string' }, second: { type: 'string' }, third: { type: 'string' } }, execute() {} }), $parameter: { name: 'id', type: 'string' } as const } });
    expect(() => new CommandIndex([rest, fixed], snapshotFor(owner, [rest, fixed]))).toThrow('Duplicate Command route');
  });

  it('rejects undefined dynamic defaults before executing business code', async () => {
    const execute = vi.fn();
    const invalidDefault = (() => undefined) as unknown as () => string;
    for (const definition of [
      defineCommand({ params: { name: { type: 'string', default: invalidDefault } }, execute }),
      defineCommand({ options: { name: { type: 'string', default: invalidDefault } }, execute }),
      defineCommand({ params: { name: { type: 'string' } }, shortcut: { later: { name: invalidDefault } }, execute }),
    ]) {
      const index = indexFor(definition);
      await expect(index.dispatch({ input: definition.shortcut ? 'later' : 'remind' })).resolves.toMatchObject({ status: 'invalid' });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps omitted optional fields absent and treats undefined defaults as omission', async () => {
    const index = indexFor(defineCommand({ params: { name: { type: 'string', optional: true, default: undefined } }, options: { count: { type: 'integer', default: undefined } }, execute: ({ params, options }) => ({ paramPresent: Object.hasOwn(params, 'name'), optionPresent: Object.hasOwn(options, 'count') }) }));
    await expect(index.dispatch({ input: 'remind' })).resolves.toMatchObject({ status: 'executed', value: { paramPresent: false, optionPresent: false } });
  });

  it('retains path-only parameter metadata in the command manifest', () => {
    const index = indexFor(defineCommand({ execute() {} }), 'foo/$id', { name: 'id', type: 'integer' });
    expect(index.list()[0]?.parameters).toEqual([{ name: 'id', type: 'integer', required: true }]);
  });

  it.each([undefined, {}])('intercepts help in any argument position with options %j', async (options) => {
    const execute = vi.fn();
    const index = indexFor(defineCommand({ params: { url: { type: 'string' } }, options, execute }), 'scan/$url', { name: 'url', type: 'string' });
    for (const input of ['scan --help', 'scan --help https://example.org', 'scan https://example.org --help']) {
      await expect(index.dispatch({ input: input, commandPrefix: '#' })).resolves.toMatchObject({ status: 'executed', value: expect.stringContaining('#scan <url>') });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows quoted and terminated help tokens as literal positional values', async () => {
    const index = indexFor(defineCommand({ params: { value: { type: 'string' } }, execute: ({ params }) => params.value }));
    for (const input of ["remind '--help'", 'remind "--help"', 'remind -- --help']) {
      await expect(index.dispatch({ input: input })).resolves.toMatchObject({ status: 'executed', value: '--help' });
    }
  });

  it.each([undefined, {}])('preserves quoted and terminated help in declared directory parameters with options %j', async (options) => {
    const execute = vi.fn(({ params, args }) => ({ url: params.url, args }));
    const index = indexFor(defineCommand({ params: { url: { type: 'string' } }, options, execute }), 'scan/$url', { name: 'url', type: 'string' });
    for (const input of ['scan "--help"', "scan '--help'", 'scan -- --help', 'scan -- "--help"']) {
      await expect(index.dispatch({ input: input })).resolves.toMatchObject({ status: 'executed', value: { url: '--help', args: [] } });
    }
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('retains path-only directory argument capture without reinterpreting a consumed terminator', async () => {
    const execute = vi.fn(({ params, args }) => ({ url: params.url, args }));
    const index = indexFor(defineCommand({ execute }), 'scan/$url', { name: 'url', type: 'string' });
    await expect(index.dispatch({ input: 'scan -- --help' })).resolves.toMatchObject({ status: 'executed', value: { url: '--', args: ['--help'] } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}])('preserves undeclared typed directory fields before other declared parameters with options %j', async (options) => {
    const index = indexFor(defineCommand({ params: { note: { type: 'string', default: 'fallback' } }, options, execute: ({ params }) => params }), 'foo/$id', { name: 'id', type: 'integer' });
    await expect(index.dispatch({ input: 'foo 123' })).resolves.toMatchObject({ status: 'executed', value: { id: 123, note: 'fallback' } });
    await expect(index.dispatch({ input: 'foo 123 actual' })).resolves.toMatchObject({ status: 'executed', value: { id: 123, note: 'actual' } });
  });

  it.each([7, () => 8])('preserves static and dynamic undeclared directory defaults %j', async (defaultValue) => {
    const index = indexFor(defineCommand({ params: { note: { type: 'string', default: 'fallback' } }, execute: ({ params }) => params }), 'foo/$id', { name: 'id', type: 'integer', optional: true, defaultValue });
    await expect(index.dispatch({ input: 'foo' })).resolves.toMatchObject({ status: 'executed', value: { id: typeof defaultValue === 'function' ? 8 : 7, note: 'fallback' } });
  });

  it('preserves undeclared path values while parsing declared options and subsequent parameters', async () => {
    const index = indexFor(defineCommand({ params: { note: { type: 'string' } }, options: { quiet: { type: 'boolean' } }, execute: ({ params, options }) => ({ params, options }) }), 'foo/$id', { name: 'id', type: 'integer' });
    await expect(index.dispatch({ input: 'foo 123 --quiet actual' })).resolves.toMatchObject({ status: 'executed', value: { params: { id: 123, note: 'actual' }, options: { quiet: true } } });
  });

  it('rejects shortcuts that cannot supply a required option', () => {
    expect(() => indexFor(defineCommand({ options: { count: { type: 'integer', optional: false } }, shortcut: { later: {} }, execute() {} }))).toThrow('required option --count');
  });

  it('runs a shortcut with defaulted required options', async () => {
    const index = indexFor(defineCommand({ options: { count: { type: 'integer', optional: false, default: 2 } }, shortcut: { later: {} }, execute: ({ options }) => options.count }));
    await expect(index.dispatch({ input: 'later' })).resolves.toMatchObject({ status: 'executed', value: 2 });
  });

  it('leaves option-like tokens to commands without argument declarations', async () => {
    const index = indexFor(defineCommand({ execute: ({ args }) => args }));
    await expect(index.dispatch({ input: 'remind --bogus' })).resolves.toMatchObject({ status: 'executed', value: ['--bogus'] });
  });

  it('retains text whitespace before a structured positional argument', async () => {
    const index = indexFor(defineCommand({ params: { caption: { type: 'text' }, who: { type: 'mention' } }, execute: ({ params }) => params }));
    await expect(index.dispatch({ input: [{ type: 'text', data: { text: 'remind hello  \n' } }, { type: 'mention', data: { target: 'alice' } }] })).resolves.toMatchObject({ status: 'executed', value: { caption: 'hello  \n', who: 'alice' } });
  });

  it('distinguishes long option names from short aliases', async () => {
    const index = indexFor(defineCommand({ options: { c: { type: 'integer' }, count: { type: 'integer', alias: 'c' } }, execute: ({ options }) => options }));
    await expect(index.dispatch({ input: 'remind --c 2 -c 3' })).resolves.toMatchObject({ status: 'executed', value: { c: 2, count: 3 } });
  });
});


it('rejects identical user route shapes across declaration and dynamic directory styles', () => {
  const owner = rootPluginId();
  const first = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'foo', source: '/commands/foo/index.ts', definition: defineCommand({ params: { id: { type: 'integer' } }, execute() {} }) });
  const second = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'foo/$id', source: '/commands/foo/[id]/index.ts', definition: { ...defineCommand({ params: { id: { type: 'integer' } }, execute() {} }), $parameter: { name: 'id', type: 'integer' } as const } });
  expect(() => new CommandIndex([first, second], snapshotFor(owner, [first, second]))).toThrow('Duplicate Command route');
});


it('resolves directory-bound dynamic defaults from the actual session and validates them', async () => {
  const owner = rootPluginId();
  const defaultValue = (session: { sender?: { id: string } }) => session.sender?.id ?? 'anonymous';
  const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'profile/$name', source: '/commands/profile/[[name]]/index.ts', definition: { ...defineCommand({ params: { name: { type: 'string', default: defaultValue } }, execute: ({ params }) => params.name }), $parameter: { name: 'name', type: 'string', optional: true, defaultValue } as const } });
  const index = new CommandIndex([slot], snapshotFor(owner, [slot]));
  await expect(index.dispatch({ input: 'profile', source: { content: 'profile', sender: { id: 'alice' }, conversation: { endpoint: { adapter: 'test', id: 'ep' }, kind: 'private', id: 'room' } } })).resolves.toMatchObject({ status: 'executed', value: 'alice' });
  await expect(index.dispatch({ input: 'profile' })).resolves.toMatchObject({ status: 'executed', value: 'anonymous' });
});


it('accepts native numeric face ids and structured catch-all media values', async () => {
  const owner = rootPluginId();
  const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'native', source: '/commands/native/index.ts', definition: defineCommand({ params: { face: { type: 'face' }, images: { type: 'image', rest: true } }, execute: ({ params }) => params }) });
  const index = new CommandIndex([slot], snapshotFor(owner, [slot]));
  const result = await index.dispatch({ input: [{ type: 'text', data: { text: 'native ' } }, { type: 'face', data: { id: 1 } }, { type: 'image', data: { media: { kind: 'url', url: 'https://example.test/image.png' } } }] });
  expect(result).toMatchObject({ status: 'executed', value: { face: 1, images: [{ kind: 'url', url: 'https://example.test/image.png' }] } });
});
