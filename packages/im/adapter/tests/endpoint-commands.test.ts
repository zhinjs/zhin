import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand, parseCommandDefinition } from '@zhin.js/command';
import {
  addEndpointFromKeyValues,
  addEndpointToConfig,
  buildEndpointEnvKey,
  createEndpointCommands,
  createEndpointRuntimeState,
  defineEndpointRuntimeStateToken,
  endpointCommandForbidden,
  extractEndpointCommandReply,
  formatEndpointList,
  isEndpointOperator,
  listConfiguredEndpoints,
  persistEndpointEnvValues,
  removeEndpointByName,
  removeEndpointFromConfig,
  type EndpointCommandsSpec,
} from '../src/endpoint-commands.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'endpoint-commands-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.DEMO_MY_BOT_TOKEN;
  delete process.env.DEMO_MY_BOT_BASE_URL;
  delete process.env.ZHIN_PROJECT_ROOT;
});

const demoSpec: EndpointCommandsSpec = {
  adapterKey: 'demo',
  adapterDisplayName: 'Demo',
  fields: [
    { key: 'token', required: true, env: true, description: 'bot token' },
    { key: 'baseUrl', description: 'API base URL' },
  ],
  describeEntry: (entry) => `token: ${String(entry.token)}`,
};

function writeConfig(content: string): string {
  const filePath = path.join(root, 'zhin.config.yml');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('isEndpointOperator', () => {
  const message = (sender: string) => ({ sender });

  it('未配置 master 时放行', () => {
    expect(isEndpointOperator({}, message('alice'))).toBe(true);
    expect(isEndpointOperator({ endpoints: [{ name: 'a' }] }, message('alice'))).toBe(true);
    expect(isEndpointOperator(undefined, undefined)).toBe(true);
  });

  it('顶层 master 命中放行，不命中拒绝', () => {
    const config = { master: '1659488338' };
    expect(isEndpointOperator(config, message('1659488338'))).toBe(true);
    expect(isEndpointOperator(config, message('8596238'))).toBe(false);
  });

  it('endpoints[i].master 逐项命中同样放行', () => {
    const config = { endpoints: [{ name: 'a', master: 8596238 }] };
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

describe('persistEndpointEnvValues', () => {
  it('.env 不存在时创建并同步 process.env', () => {
    persistEndpointEnvValues({ DEMO_MY_BOT_TOKEN: 'tok-1' }, root);

    expect(fs.readFileSync(path.join(root, '.env'), 'utf-8')).toBe('DEMO_MY_BOT_TOKEN=tok-1\n');
    expect(process.env.DEMO_MY_BOT_TOKEN).toBe('tok-1');
  });

  it('已有键时更新而不是追加，保留其它行', () => {
    fs.writeFileSync(path.join(root, '.env'), 'OTHER=keep\nDEMO_MY_BOT_TOKEN=old\n');

    persistEndpointEnvValues({ DEMO_MY_BOT_TOKEN: 'new' }, root);

    expect(fs.readFileSync(path.join(root, '.env'), 'utf-8')).toBe('OTHER=keep\nDEMO_MY_BOT_TOKEN=new\n');
  });
});

describe('config yaml 读写', () => {
  it('配置文件不存在时新建并写入 plugins.<key>.endpoints', () => {
    const filePath = addEndpointToConfig('demo', { name: 'bot1', token: '${DEMO_BOT1_TOKEN}' }, root);

    expect(filePath).toBe(path.join(root, 'zhin.config.yml'));
    expect(listConfiguredEndpoints('demo', root)).toEqual([
      { name: 'bot1', token: '${DEMO_BOT1_TOKEN}' },
    ]);
  });

  it('保留已有注释与其它配置，仅追加 endpoints 项', () => {
    const filePath = writeConfig(
      [
        '# 顶层注释',
        'log_level: info',
        'plugins:',
        '  demo:',
        '    # demo 注释',
        '    endpoints:',
        '      - name: old-bot',
        '        token: "${DEMO_OLD_BOT_TOKEN}"',
        '',
      ].join('\n'),
    );

    addEndpointToConfig('demo', { name: 'new-bot', token: 't' }, root);

    const text = fs.readFileSync(filePath, 'utf-8');
    expect(text).toContain('# 顶层注释');
    expect(text).toContain('# demo 注释');
    expect(listConfiguredEndpoints('demo', root).map((e) => e.name)).toEqual(['old-bot', 'new-bot']);
  });

  it('name 重复时报错且不写文件', () => {
    const filePath = writeConfig('plugins:\n  demo:\n    endpoints:\n      - { name: dup, token: t }\n');
    const before = fs.readFileSync(filePath, 'utf-8');

    expect(() => addEndpointToConfig('demo', { name: 'dup', token: 'x' }, root)).toThrow(/已存在/);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('plugins 为 legacy 空数组时替换为 map；非空数组拒绝写入', () => {
    writeConfig('plugins: []\n');
    addEndpointToConfig('demo', { name: 'bot1', token: 't' }, root);
    expect(listConfiguredEndpoints('demo', root).map((e) => e.name)).toEqual(['bot1']);

    writeConfig('plugins:\n  - "@zhin.js/adapter-sandbox"\n');
    expect(() => addEndpointToConfig('demo', { name: 'bot1', token: 't' }, root)).toThrow(/数组形态/);
  });

  it('不同 adapterKey 互不干扰', () => {
    writeConfig('plugins:\n  demo:\n    endpoints:\n      - { name: a, token: t }\n');

    addEndpointToConfig('other', { name: 'b' }, root);

    expect(listConfiguredEndpoints('demo', root).map((e) => e.name)).toEqual(['a']);
    expect(listConfiguredEndpoints('other', root).map((e) => e.name)).toEqual(['b']);
  });

  it('removeEndpointFromConfig：按 name 移除；不存在 removed: false 且文件不变', () => {
    const filePath = writeConfig(
      'plugins:\n  demo:\n    endpoints:\n      - { name: a, token: "1" }\n      - { name: b, token: "2" }\n',
    );

    expect(removeEndpointFromConfig('demo', 'a', root).removed).toBe(true);
    expect(listConfiguredEndpoints('demo', root).map((e) => e.name)).toEqual(['b']);

    const before = fs.readFileSync(filePath, 'utf-8');
    expect(removeEndpointFromConfig('demo', 'missing', root).removed).toBe(false);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(before);
  });
});

describe('formatEndpointList', () => {
  it('运行中 + 配置中两段，空列表占位，footer 追加', () => {
    writeConfig('plugins:\n  demo:\n    endpoints:\n      - { name: conf-bot, token: "${DEMO_CONF_BOT_TOKEN}" }\n');

    const text = formatEndpointList(demoSpec, {
      running: [{ name: 'run-bot', mode: 'ws' }, { name: 'no-mode' }],
      configured: listConfiguredEndpoints('demo', root),
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
    writeConfig('plugins: {}\n');
    const text = formatEndpointList(demoSpec, {
      running: [],
      configured: listConfiguredEndpoints('demo', root),
    });
    expect(text.match(/（无）/g)).toHaveLength(2);
  });
});

describe('addEndpointFromKeyValues', () => {
  it('kv 解析：env 字段写 .env + ${REF}，其余内联', () => {
    const text = addEndpointFromKeyValues(
      demoSpec,
      'my-bot',
      ['token=tok-9', 'baseUrl=https://api.example.com'],
      root,
    );

    expect(text).toContain('✅');
    expect(text).toContain('重启');
    expect(fs.readFileSync(path.join(root, '.env'), 'utf-8')).toContain('DEMO_MY_BOT_TOKEN=tok-9');
    expect(listConfiguredEndpoints('demo', root)).toEqual([
      { name: 'my-bot', token: '${DEMO_MY_BOT_TOKEN}', baseUrl: 'https://api.example.com' },
    ]);
  });

  it('缺少必填字段 / 未知字段 / 非 kv 参数 / 空值分别报错', () => {
    expect(addEndpointFromKeyValues(demoSpec, 'b', [], root)).toContain('缺少必填字段：token');
    expect(addEndpointFromKeyValues(demoSpec, 'b', ['token=t', 'ghost=x'], root)).toContain('未知字段「ghost」');
    expect(addEndpointFromKeyValues(demoSpec, 'b', ['token'], root)).toContain('不是 key=value 形式');
    expect(addEndpointFromKeyValues(demoSpec, 'b', ['token='], root)).toContain('值不能为空');
  });

  it('重名时返回添加失败且不写 .env', () => {
    writeConfig('plugins:\n  demo:\n    endpoints:\n      - { name: dup, token: t }\n');

    const text = addEndpointFromKeyValues(demoSpec, 'dup', ['token=x'], root);

    expect(text).toContain('添加失败');
    expect(text).toContain('已存在');
    expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
  });

  it('value 含 = 时按首个 = 切分', () => {
    addEndpointFromKeyValues(demoSpec, 'eq-bot', ['token=a=b=c'], root);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf-8')).toContain('DEMO_EQ_BOT_TOKEN=a=b=c');
  });
});

describe('removeEndpointByName', () => {
  it('空名提示用法；不存在提示未找到；存在则移除并提示重启', () => {
    writeConfig('plugins:\n  demo:\n    endpoints:\n      - { name: a, token: "1" }\n');

    expect(removeEndpointByName(demoSpec, '  ', root)).toContain('用法：demo endpoint remove <name>');
    expect(removeEndpointByName(demoSpec, 'ghost', root)).toContain('不存在');
    expect(removeEndpointByName(demoSpec, 'a', root)).toContain('重启');
    expect(listConfiguredEndpoints('demo', root)).toEqual([]);
  });
});

describe('createEndpointCommands', () => {
  const stateToken = defineEndpointRuntimeStateToken('demo-cmd');

  function fakeContext(overrides: Record<string, unknown> = {}) {
    return {
      use: (token: unknown) => {
        if (token === stateToken) return createEndpointRuntimeState();
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

  it('list execute 输出运行中 + 配置清单（不经权限）', () => {
    process.env.ZHIN_PROJECT_ROOT = root;
    writeConfig('plugins:\n  demo:\n    endpoints:\n      - { name: conf, token: t }\n');
    const state = createEndpointRuntimeState();
    state.endpoints.set('running', { name: 'running', mode: 'ws' });
    const commands = createEndpointCommands({
      ...demoSpec,
      running: (use) => use(stateToken).endpoints.values(),
    }, defineCommand);
    const context = {
      use: (token: unknown) => {
        if (token === stateToken) return state;
        throw new Error('unexpected token');
      },
    } as never;

    const text = commands.list.execute(context) as string;

    expect(text).toContain('running（ws）');
    expect(text).toContain('conf');
  });

  it('add/remove 经 master 权限门禁', async () => {
    process.env.ZHIN_PROJECT_ROOT = root;
    writeConfig('plugins: {}\n');
    const commands = createEndpointCommands(demoSpec, defineCommand);
    const forbidden = endpointCommandForbidden('Demo');
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: 'bob' },
      params: { name: 'x' },
    });

    expect(commands.add.execute(denied)).toBe(forbidden);
    expect(commands.remove.execute(denied)).toBe(forbidden);
    expect(listConfiguredEndpoints('demo', root)).toEqual([]);

    const allowed = fakeContext({
      config: { master: 'alice' },
      input: { sender: 'alice' },
      params: { name: 'x' },
      args: ['token=t'],
    });
    expect(commands.add.execute(allowed)).toContain('✅');
    expect(listConfiguredEndpoints('demo', root).map((e) => e.name)).toEqual(['x']);
  });

  it('add 无 name 时返回用法', () => {
    const commands = createEndpointCommands(demoSpec, defineCommand);
    expect(commands.add.execute(fakeContext())).toContain('用法：demo endpoint add <name>');
  });

  it('bindFlow 钩子接管 add（忽略 kv）', async () => {
    process.env.ZHIN_PROJECT_ROOT = root;
    writeConfig('plugins: {}\n');
    const seen: unknown[] = [];
    const commands = createEndpointCommands({
      ...demoSpec,
      bindFlow: ({ name, reply }) => {
        seen.push(name, typeof reply);
        return 'custom-flow';
      },
    }, defineCommand);

    const result = await commands.add.execute(fakeContext({
      params: { name: 'bot' },
      args: ['token=should-be-ignored'],
    }));

    expect(result).toBe('custom-flow');
    expect(seen).toEqual(['bot', 'function']);
    expect(listConfiguredEndpoints('demo', root)).toEqual([]);
  });
});

describe('endpoint runtime state', () => {
  it('createEndpointRuntimeState / defineEndpointRuntimeStateToken', () => {
    const state = createEndpointRuntimeState();
    state.endpoints.set('a', { name: 'a', mode: 'ws' });
    expect([...state.endpoints.values()]).toEqual([{ name: 'a', mode: 'ws' }]);

    const tokenA = defineEndpointRuntimeStateToken('aaa');
    const tokenB = defineEndpointRuntimeStateToken('bbb');
    expect(tokenA.id).not.toBe(tokenB.id);
  });
});
