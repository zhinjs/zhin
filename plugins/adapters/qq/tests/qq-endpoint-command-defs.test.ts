import { describe, expect, it, vi } from 'vitest';
import {
  endpointConfigurationStoreToken,
} from 'zhin.js/adapter';
import { CommandIndex, commandFeatureId, parseCommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, createSnapshotView, rootPluginId } from 'zhin.js/plugin-runtime';
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

const owner = rootPluginId();
const slots = [
  createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/list', source: '/commands/qq/endpoint/list/index.ts', definition: listCommand }),
  createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/cancel', source: '/commands/qq/endpoint/cancel/index.ts', definition: cancelCommand }),
  createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'qq/endpoint/remove/$id', source: '/commands/qq/endpoint/remove/[id]/index.ts', definition: { ...removeCommand, $parameter: { name: 'id', type: 'string' } as const } }),
];
const snapshot = createSnapshotView(0, {
  root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/qq', packageRoot: '/project', children: [] }]]),
  config: new Map([[owner, { commandNamespace: 'account' }]]), resources: new Map(),
  capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
});
const commands = new CommandIndex(slots, snapshot);
const knownCommand = (path: string) => commands.formatCommand(owner, path, '!', 'zh-CN');

function fakeContext(state = createQqRuntimeState(), knownEnvironment = true) {
  return {
    owner, generation: 0, config: {}, locale: 'zh-CN',
    formatCommand: knownEnvironment ? knownCommand : () => undefined,
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
    state.bindFlow = { id: 'a', stop: vi.fn(), locale: 'zh-CN', cancelCommand: knownCommand('qq endpoint cancel') };

    const text = await listCommand.execute(fakeContext(state)) as string;

    expect(text).toContain('!account qq endpoint cancel');
  });

  it('does not invent invocation paths when the active flow or command environment has none', async () => {
    const state = createQqRuntimeState();
    state.bindFlow = { id: 'unscoped', stop: vi.fn(), locale: 'zh-CN' };
    const list = await listCommand.execute(fakeContext(state, false)) as string;
    expect(list).toContain('进行中');
    expect(list).not.toContain('qq endpoint cancel');
    const remove = await removeCommand.execute(fakeContext(state, false)) as string;
    expect(remove).not.toContain('qq endpoint remove');
    expect(remove).toContain('命令');
    expect(knownCommand('qq endpoint unknown')).toBeUndefined();
  });

  it('cancel execute 在无流程时提示', () => {
    expect(cancelCommand.execute(fakeContext())).toContain('没有进行中');
  });

  it('remove execute 通过根级配置 Store 处理空 id', async () => {
    await expect(removeCommand.execute(fakeContext())).resolves.toContain('用法：!account qq endpoint remove');
  });
});
