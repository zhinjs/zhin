import { describe, expect, it, vi } from 'vitest';
import {
  endpointConfigurationStoreToken,
} from 'zhin.js/adapter';
import { parseCommandDefinition } from 'zhin.js/command';
import listCommand from '../commands/qq/endpoint/list/index.js';
import addCommand from '../commands/qq/endpoint/add/[[id]]/index.js';
import cancelCommand from '../commands/qq/endpoint/cancel/index.js';
import removeCommand from '../commands/qq/endpoint/remove/[id]/index.js';
import { createQqRuntimeState, qqRuntimeStateToken } from '../src/qq-runtime-state.js';
import { MemoryEndpointConfigurationStore } from '../../test-utils/endpoint-configuration.js';

/**
 * commands/ 下的命令定义冒烟：模块可加载、defineCommand 形态合法、
 * execute 能用最小 CommandContext 跑通（bind flow 的完整路径见 qq-endpoint-commands.test.ts）。
 */

const emptyStore = new MemoryEndpointConfigurationStore();

function fakeContext(state = createQqRuntimeState()) {
  return {
    use: (token: unknown) => {
      if (token === qqRuntimeStateToken) return state;
      if (token === endpointConfigurationStoreToken) return emptyStore;
      throw new Error(`unexpected token: ${String(token)}`);
    },
    params: Object.freeze({}),
    args: Object.freeze([]),
    input: undefined,
  } as never;
}

describe('qq endpoint command definitions', () => {
  it('四个命令模块均为合法 defineCommand', () => {
    for (const definition of [listCommand, addCommand, cancelCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('list execute 返回运行中 + 配置清单', async () => {
    const state = createQqRuntimeState();
    state.endpoints.set('bot-1', { id: 'bot-1', mode: 'websocket' });

    const text = await listCommand.execute(fakeContext(state)) as string;

    expect(text).toContain('bot-1');
  });

  it('list execute 在有进行中绑定时提示 qq endpoint cancel', async () => {
    const state = createQqRuntimeState();
    state.bindFlow = { id: 'a', stop: vi.fn() };

    const text = await listCommand.execute(fakeContext(state)) as string;

    expect(text).toContain('qq endpoint cancel');
  });

  it('cancel execute 在无流程时提示', () => {
    expect(cancelCommand.execute(fakeContext())).toContain('没有进行中');
  });

  it('remove execute 通过根级配置 Store 处理空 id', async () => {
    await expect(removeCommand.execute(fakeContext())).resolves.toContain('用法');
  });
});
