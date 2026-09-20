import { describe, expect, it } from 'vitest';
import { defineCommand, parseCommandDefinition } from '@zhin.js/command';
import {
  addEndpointFromKeyValues,
  buildEndpointEnvKey,
  createDurableEndpointCommandReply,
  createEndpointCommands,
  createEndpointRuntimeState,
  defineEndpointRuntimeStateToken,
  endpointCommandForbidden,
  extractEndpointCommandReply,
  formatEndpointList,
  isEndpointOperator,
  removeEndpointById,
  type EndpointCommandUse,
  type EndpointCommandsSpec,
} from '../src/endpoint-commands.js';
import {
  endpointConfigurationStoreToken,
  type AddConfiguredEndpointRequest,
  type ConfiguredEndpointEntry,
  type EndpointConfigurationStore,
} from '../src/endpoint-configuration.js';
import { outboundHostToken } from '@zhin.js/plugin-runtime';

const demoSpec: EndpointCommandsSpec = {
  adapterKey: 'demo',
  adapterDisplayName: 'Demo',
  fields: [
    { key: 'token', required: true, env: true, description: 'bot token' },
    { key: 'baseUrl', description: 'API base URL' },
  ],
  describeEntry: (entry) => `token: ${String(entry.token)}`,
};

class MemoryEndpointConfigurationStore implements EndpointConfigurationStore {
  readonly entries = new Map<string, ConfiguredEndpointEntry[]>();
  readonly environment = new Map<string, string>();
  readonly filePath = '/project/zhin.config.yml';

  async list(adapterKey: string): Promise<readonly ConfiguredEndpointEntry[]> {
    return this.entries.get(adapterKey) ?? [];
  }

  async add(request: AddConfiguredEndpointRequest) {
    const entries = this.entries.get(request.adapterKey) ?? [];
    if (entries.some((entry) => entry.id === request.entry.id)) {
      throw new Error(`配置中已存在 ${request.adapterKey} endpoint「${request.entry.id}」`);
    }
    entries.push(request.entry);
    this.entries.set(request.adapterKey, entries);
    for (const [key, value] of Object.entries(request.environment)) {
      this.environment.set(key, value);
    }
    return { filePath: this.filePath };
  }

  async remove(adapterKey: string, endpointId: string) {
    const entries = this.entries.get(adapterKey) ?? [];
    const next = entries.filter((entry) => entry.id !== endpointId);
    this.entries.set(adapterKey, next);
    return { removed: next.length !== entries.length, filePath: this.filePath };
  }
}

describe('isEndpointOperator', () => {
  const message = (sender: string) => ({ sender: { id: sender } });

  it('未配置 master 时放行', () => {
    expect(isEndpointOperator({}, message('alice'))).toBe(true);
    expect(isEndpointOperator({ endpoints: [{ id: 'a' }] }, message('alice'))).toBe(true);
    expect(isEndpointOperator(undefined, undefined)).toBe(true);
  });

  it('顶层 master 命中放行，不命中拒绝', () => {
    const config = { master: '1659488338' };
    expect(isEndpointOperator(config, message('1659488338'))).toBe(true);
    expect(isEndpointOperator(config, message('8596238'))).toBe(false);
  });

  it('endpoints[i].master 逐项命中同样放行', () => {
    const config = { endpoints: [{ id: 'a', master: 8596238 }] };
    expect(isEndpointOperator(config, message('8596238'))).toBe(true);
    expect(isEndpointOperator(config, message('111'))).toBe(false);
  });

  it('sender 缺失时拒绝（已配置 master）', () => {
    expect(isEndpointOperator({ master: '1' }, {})).toBe(false);
    expect(isEndpointOperator({ master: '1' }, undefined)).toBe(false);
  });
});

describe('extractEndpointCommandReply', () => {
  it('从消息 input 提取 $reply；非消息输入降级 no-op', async () => {
    const calls: string[] = [];
    const message = { $reply: async (content: string) => void calls.push(content) };

    const reply = extractEndpointCommandReply(message);
    await reply('hello');
    expect(calls).toEqual(['hello']);

    await expect(extractEndpointCommandReply(undefined)('x')).resolves.toBeUndefined();
    await expect(extractEndpointCommandReply({})('x')).resolves.toBeUndefined();
  });
});

describe('createDurableEndpointCommandReply', () => {
  it('有 conversation 时优先走 OutboundHost，不调用已过期的 $reply', async () => {
    const sent: unknown[] = [];
    const outbound = {
      send: async (input: unknown) => {
        sent.push(input);
        return 'mid-1';
      },
    };
    const use = ((token: { id: string }) => {
      if (token === outboundHostToken || token.id === outboundHostToken.id) return outbound;
      throw new Error(`unexpected token ${token.id}`);
    }) as EndpointCommandUse;

    const reply = createDurableEndpointCommandReply({
      conversation: {
        endpoint: { id: 'cap-icqq', adapter: 'root/icqq' },
        kind: 'group',
        id: '129043431',
      },
      metadata: { endpoint: '210723495' },
      $reply: async () => {
        throw new Error('Message reply scope has ended');
      },
    }, use);

    await expect(reply('绑定成功')).resolves.toBeUndefined();
    expect(sent).toEqual([{
      adapter: 'root/icqq',
      endpointKey: '210723495',
      conversation: { kind: 'group', id: '129043431' },
      content: '绑定成功',
    }]);
  });

  it('无 OutboundHost 时回退 scoped $reply', async () => {
    const calls: string[] = [];
    const use = (() => {
      throw new Error('missing outbound');
    }) as EndpointCommandUse;
    const reply = createDurableEndpointCommandReply({
      conversation: {
        endpoint: { id: 'cap', adapter: 'root/icqq' },
        kind: 'private',
        id: 'u1',
      },
      $reply: async (content: string) => void calls.push(content),
    }, use);
    await reply('hi');
    expect(calls).toEqual(['hi']);
  });
});

describe('buildEndpointEnvKey', () => {
  it('ADAPTER_NAME_FIELD 大写化，非法字符转下划线', () => {
    expect(buildEndpointEnvKey('telegram', 'my-bot', 'token')).toBe('TELEGRAM_MY_BOT_TOKEN');
    expect(buildEndpointEnvKey('napcat', 'bot1', 'access_token')).toBe('NAPCAT_BOT1_ACCESS_TOKEN');
  });

  it('camelCase 字段转 snake', () => {
    expect(buildEndpointEnvKey('slack', 'bot', 'signingSecret')).toBe('SLACK_BOT_SIGNING_SECRET');
    expect(buildEndpointEnvKey('milky', 'bot', 'baseUrl')).toBe('MILKY_BOT_BASE_URL');
  });
});

describe('formatEndpointList', () => {
  it('运行中 + 配置中两段，空列表占位，footer 追加', () => {
    const text = formatEndpointList(demoSpec, {
      running: [{ id: 'run-bot', mode: 'ws' }, { id: 'no-mode' }],
      configured: [{ id: 'conf-bot', token: '${DEMO_CONF_BOT_TOKEN}' }],
      footer: '⚠️ 提示行',
    });

    expect(text).toContain('【运行中的 Demo endpoints】');
    expect(text).toContain('  - run-bot（ws）');
    expect(text).toContain('  - no-mode\n');
    expect(text).toContain('plugins.demo.endpoints');
    expect(text).toContain('  - conf-bot（token: ${DEMO_CONF_BOT_TOKEN}）');
    expect(text.endsWith('⚠️ 提示行')).toBe(true);
  });

  it('空列表占位提示', () => {
    const text = formatEndpointList(demoSpec, {
      running: [],
      configured: [],
    });
    expect(text.match(/（无）/g)).toHaveLength(2);
  });
});

describe('addEndpointFromKeyValues', () => {
  it('kv 解析：env 字段写 .env + ${REF}，其余内联', async () => {
    const store = new MemoryEndpointConfigurationStore();
    const text = await addEndpointFromKeyValues(
      demoSpec,
      'my-bot',
      ['token=tok-9', 'baseUrl=https://api.example.com'],
      store,
    );

    expect(text).toContain('✅');
    expect(text).toContain('重启');
    expect(store.environment.get('DEMO_MY_BOT_TOKEN')).toBe('tok-9');
    await expect(store.list('demo')).resolves.toEqual([
      { id: 'my-bot', token: '${DEMO_MY_BOT_TOKEN}', baseUrl: 'https://api.example.com' },
    ]);
  });

  it('缺少必填字段 / 未知字段 / 非 kv 参数 / 空值分别报错', async () => {
    const store = new MemoryEndpointConfigurationStore();
    await expect(addEndpointFromKeyValues(demoSpec, 'b', [], store)).resolves.toContain('缺少必填字段：token');
    await expect(addEndpointFromKeyValues(demoSpec, 'b', ['token=t', 'ghost=x'], store)).resolves.toContain('未知字段「ghost」');
    await expect(addEndpointFromKeyValues(demoSpec, 'b', ['token'], store)).resolves.toContain('不是 key=value 形式');
    await expect(addEndpointFromKeyValues(demoSpec, 'b', ['token='], store)).resolves.toContain('值不能为空');
  });

  it('重名时返回添加失败且不写 .env', async () => {
    const store = new MemoryEndpointConfigurationStore();
    store.entries.set('demo', [{ id: 'dup', token: 't' }]);

    const text = await addEndpointFromKeyValues(demoSpec, 'dup', ['token=x'], store);

    expect(text).toContain('添加失败');
    expect(text).toContain('已存在');
    expect(store.environment.size).toBe(0);
  });

  it('value 含 = 时按首个 = 切分', async () => {
    const store = new MemoryEndpointConfigurationStore();
    await addEndpointFromKeyValues(demoSpec, 'eq-bot', ['token=a=b=c'], store);
    expect(store.environment.get('DEMO_EQ_BOT_TOKEN')).toBe('a=b=c');
  });
});

describe('removeEndpointById', () => {
  it('空 id 提示用法；不存在提示未找到；存在则移除并提示重启', async () => {
    const store = new MemoryEndpointConfigurationStore();
    store.entries.set('demo', [{ id: 'a', token: '1' }]);

    await expect(removeEndpointById(demoSpec, '  ', store)).resolves.toContain('用法：demo endpoint remove <id>');
    await expect(removeEndpointById(demoSpec, 'ghost', store)).resolves.toContain('不存在');
    await expect(removeEndpointById(demoSpec, 'a', store)).resolves.toContain('重启');
    await expect(store.list('demo')).resolves.toEqual([]);
  });
});

describe('createEndpointCommands', () => {
  const stateToken = defineEndpointRuntimeStateToken('demo-cmd');

  function fakeContext(
    overrides: Record<string, unknown> = {},
    store = new MemoryEndpointConfigurationStore(),
  ) {
    return {
      use: (token: unknown) => {
        if (token === stateToken) return createEndpointRuntimeState();
        if (token === endpointConfigurationStoreToken) return store;
        throw new Error(`unexpected token: ${String(token)}`);
      },
      params: Object.freeze({}),
      args: Object.freeze([]),
      input: undefined,
      config: undefined,
      ...overrides,
    } as never;
  }

  it('产出合法 list/add/remove 命令定义', () => {
    const commands = createEndpointCommands({
      ...demoSpec,
      running: (use) => use(stateToken).endpoints.values(),
    }, defineCommand);
    for (const definition of [commands.list, commands.add, commands.remove]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('list execute 输出运行中 + 配置清单（不经权限）', async () => {
    const store = new MemoryEndpointConfigurationStore();
    store.entries.set('demo', [{ id: 'conf', token: 't' }]);
    const state = createEndpointRuntimeState();
    state.endpoints.set('running', { id: 'running', mode: 'ws' });
    const commands = createEndpointCommands({
      ...demoSpec,
      running: (use) => use(stateToken).endpoints.values(),
    }, defineCommand);
    const context = {
      use: (token: unknown) => {
        if (token === stateToken) return state;
        if (token === endpointConfigurationStoreToken) return store;
        throw new Error('unexpected token');
      },
    } as never;

    const text = await commands.list.execute(context) as string;

    expect(text).toContain('running（ws）');
    expect(text).toContain('conf');
  });

  it('add/remove 经 master 权限门禁', async () => {
    const store = new MemoryEndpointConfigurationStore();
    const commands = createEndpointCommands(demoSpec, defineCommand);
    const forbidden = endpointCommandForbidden('Demo');
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'bob' } },
      params: { id: 'x' },
    });

    await expect(commands.add.execute(denied)).resolves.toBe(forbidden);
    await expect(commands.remove.execute(denied)).resolves.toBe(forbidden);
    await expect(store.list('demo')).resolves.toEqual([]);

    const allowed = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'alice' } },
      params: { id: 'x' },
      args: ['token=t'],
    }, store);
    await expect(commands.add.execute(allowed)).resolves.toContain('✅');
    expect((await store.list('demo')).map((e) => e.id)).toEqual(['x']);
  });

  it('add 无 id 时返回用法', async () => {
    const commands = createEndpointCommands(demoSpec, defineCommand);
    await expect(commands.add.execute(fakeContext())).resolves.toContain('用法：demo endpoint add <id>');
  });

  it('bindFlow 钩子接管 add（忽略 kv）', async () => {
    const store = new MemoryEndpointConfigurationStore();
    const seen: unknown[] = [];
    const commands = createEndpointCommands({
      ...demoSpec,
      bindFlow: ({ id, reply }) => {
        seen.push(id, typeof reply);
        return 'custom-flow';
      },
    }, defineCommand);

    const result = await commands.add.execute(fakeContext({
      params: { id: 'bot' },
      args: ['token=should-be-ignored'],
    }, store));

    expect(result).toBe('custom-flow');
    expect(seen).toEqual(['bot', 'function']);
    await expect(store.list('demo')).resolves.toEqual([]);
  });
});

describe('endpoint runtime state', () => {
  it('createEndpointRuntimeState / defineEndpointRuntimeStateToken', () => {
    const state = createEndpointRuntimeState();
    state.endpoints.set('a', { id: 'a', mode: 'ws' });
    expect([...state.endpoints.values()]).toEqual([{ id: 'a', mode: 'ws' }]);

    const tokenA = defineEndpointRuntimeStateToken('aaa');
    const tokenB = defineEndpointRuntimeStateToken('bbb');
    expect(tokenA.id).not.toBe(tokenB.id);
  });
});
