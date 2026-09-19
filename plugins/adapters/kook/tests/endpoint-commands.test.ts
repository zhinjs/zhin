import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { createEndpointRuntimeState, endpointConfigurationStoreToken } from 'zhin.js/adapter';
import { MemoryEndpointConfigurationStore } from '../../test-utils/endpoint-configuration.js';
import listCommand from '../commands/kook/endpoint/$list.js';
import addCommand from '../commands/kook/endpoint/add/$[id].js';
import removeCommand from '../commands/kook/endpoint/remove/$[id].js';
import { kookRuntimeStateToken } from '../src/kook-runtime-state.js';

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
      if (token === kookRuntimeStateToken) return state;
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

describe('kook endpoint command definitions', () => {
  it('三个命令模块均为合法 defineCommand', () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add 走 kv 参数：token 写 .env，yaml 存 ${REF}', () => {
    const text = addCommand.execute(fakeContext({
      params: { id: 'bot1' },
      args: ['token=tok-1'],
    })) as string;

    expect(text).toContain('✅');
    expect(store.environmentText()).toContain('KOOK_BOT1_TOKEN=tok-1');
    const config = store.configurationText('kook');
    expect(config).toContain('id: bot1');
    expect(config).toContain('${KOOK_BOT1_TOKEN}');
  });

  it('add 缺少必填 token 时报错', () => {
    expect(addCommand.execute(fakeContext({ params: { id: 'bot1' } })))
      .toContain('缺少必填字段：token');
  });

  it('list 显示运行中 + 配置中的 endpoints', () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('bot1', { id: 'bot1', mode: 'websocket' });
    addCommand.execute(fakeContext({ params: { id: 'conf-bot' }, args: ['token=t'] }));

    const text = listCommand.execute(context) as string;

    expect(text).toContain('bot1（websocket）');
    expect(text).toContain('conf-bot');
  });

  it('remove 从配置移除并提示重启', () => {
    addCommand.execute(fakeContext({ params: { id: 'bot1' }, args: ['token=t'] }));

    const text = removeCommand.execute(fakeContext({ params: { id: 'bot1' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(store.configurationText('kook')).not.toContain('id: bot1');
  });

  it('配置 master 后非 master 拒绝 add/remove', () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'bob' } },
      params: { id: 'bot1' },
      args: ['token=t'],
    });

    expect(addCommand.execute(denied)).toBe('仅 master 可执行 KOOK endpoint 管理命令');
    expect(removeCommand.execute(denied)).toBe('仅 master 可执行 KOOK endpoint 管理命令');
  });
});
