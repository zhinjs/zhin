import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { createEndpointRuntimeState, endpointConfigurationStoreToken } from 'zhin.js/adapter';
import { MemoryEndpointConfigurationStore } from '../../test-utils/endpoint-configuration.js';
import listCommand from '../commands/satori/endpoint/$list.js';
import addCommand from '../commands/satori/endpoint/add/$[id].js';
import removeCommand from '../commands/satori/endpoint/remove/$[id].js';
import { satoriRuntimeStateToken } from '../src/satori-runtime-state.js';

/**
 * commands/ 下的命令定义冒烟 + kv add / remove 基本行为（通用套件逻辑见
 * packages/im/adapter/tests/endpoint-commands.test.ts）。
 */

let store: MemoryEndpointConfigurationStore;

beforeEach(() => {
  store = new MemoryEndpointConfigurationStore();
});

function fakeContext(overrides: Record<string, unknown> = {}) {
  const state = createEndpointRuntimeState();
  return {
    state,
    use: (token: unknown) => {
      if (token === satoriRuntimeStateToken) return state;
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

describe('satori endpoint command definitions', async () => {
  it('三个命令模块均为合法 defineCommand', async () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add 走 kv 参数：凭据写 .env，yaml 存 ${REF}', async () => {
    const text = await addCommand.execute(fakeContext({
      params: { id: 'bot1' },
      args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'],
    })) as string;

    expect(text).toContain('✅');
    expect(store.environmentText()).toContain('SATORI_BOT1_TOKEN=tok-1');
    const config = store.configurationText('satori');
    expect(config).toContain('baseUrl: http://127.0.0.1:5140');
    expect(config).toContain('${SATORI_BOT1_TOKEN}');
  });

  it('add 缺少必填字段时报错', async () => {
    expect(await addCommand.execute(fakeContext({ params: { id: 'bot1' } })))
      .toContain('缺少必填字段：baseUrl');
  });

  it('list 显示运行中 + 配置中的 endpoints', async () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('bot1', { id: 'bot1', mode: 'ws' });
    await addCommand.execute(fakeContext({ params: { id: 'conf-bot' }, args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'] }));

    const text = await listCommand.execute(context) as string;

    expect(text).toContain('bot1（ws）');
    expect(text).toContain('conf-bot');
  });

  it('remove 从配置移除并提示重启', async () => {
    await addCommand.execute(fakeContext({ params: { id: 'bot1' }, args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'] }));

    const text = await removeCommand.execute(fakeContext({ params: { id: 'bot1' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(store.configurationText('satori')).not.toContain('id: bot1');
  });

  it('配置 master 后非 master 拒绝 add/remove', async () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'bob' } },
      params: { id: 'bot1' },
      args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'],
    });

    expect(await addCommand.execute(denied)).toBe('仅 master 可执行 Satori endpoint 管理命令');
    expect(await removeCommand.execute(denied)).toBe('仅 master 可执行 Satori endpoint 管理命令');
  });
});
