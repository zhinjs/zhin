import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import {
  createEndpointRuntimeState,
  endpointConfigurationStoreToken,
} from 'zhin.js/adapter';
import listCommand from '../commands/icqq/endpoint/list/index.js';
import addCommand from '../commands/icqq/endpoint/add/[[id]]/index.js';
import removeCommand from '../commands/icqq/endpoint/remove/[id]/index.js';
import { icqqRuntimeStateToken } from '../src/icqq-runtime-state.js';
import { MemoryEndpointConfigurationStore } from '../../test-utils/endpoint-configuration.js';

/**
 * commands/ 下的命令定义冒烟 + add（bindFlow 引导式登记）/ remove 基本行为
 * （通用套件逻辑见 packages/im/adapter/tests/endpoint-commands.test.ts）。
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
      if (token === icqqRuntimeStateToken) return state;
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

describe('icqq endpoint command definitions', () => {
  it('三个命令模块均为合法 defineCommand', () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add 无 id 时回复用法', async () => {
    const text = await addCommand.execute(fakeContext()) as string;
    expect(text).toContain('用法：icqq endpoint add <uin>');
  });

  it('add 非数字 id 拒绝', async () => {
    expect(await addCommand.execute(fakeContext({ params: { id: 'my-bot' } })))
      .toContain('纯数字');
  });

  it('add 合法 uin：写入 { id } 配置项并引导重启', async () => {
    const text = await addCommand.execute(fakeContext({ params: { id: '8596238' } })) as string;

    expect(text).toContain('✅');
    expect(text).toContain('重启');
    await expect(store.list('icqq')).resolves.toEqual([{ id: '8596238' }]);
  });

  it('add 重名时报添加失败', async () => {
    await addCommand.execute(fakeContext({ params: { id: '8596238' } }));
    expect(await addCommand.execute(fakeContext({ params: { id: '8596238' } })))
      .toContain('已存在');
  });

  it('list 显示运行中 + 配置中的 endpoints', async () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('8596238', { id: '8596238', mode: 'direct' });
    await addCommand.execute(fakeContext({ params: { id: '10001' } }));

    const text = await listCommand.execute(context) as string;

    expect(text).toContain('8596238（direct）');
    expect(text).toContain('10001（direct（直连 @icqqjs/icqq））');
  });

  it('remove 从配置移除并提示重启', async () => {
    await addCommand.execute(fakeContext({ params: { id: '8596238' } }));

    const text = await removeCommand.execute(fakeContext({ params: { id: '8596238' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    await expect(store.list('icqq')).resolves.toEqual([]);
  });

  it('配置 master 后非 master 拒绝 add/remove', async () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'bob' } },
      params: { id: '8596238' },
    });

    await expect(addCommand.execute(denied)).resolves.toBe('仅 master 可执行 ICQQ endpoint 管理命令');
    await expect(removeCommand.execute(denied)).resolves.toBe('仅 master 可执行 ICQQ endpoint 管理命令');
  });
});
