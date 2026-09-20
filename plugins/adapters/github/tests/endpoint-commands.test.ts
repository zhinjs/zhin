import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { createEndpointRuntimeState, endpointConfigurationStoreToken } from 'zhin.js/adapter';
import { MemoryEndpointConfigurationStore } from '../../test-utils/endpoint-configuration.js';
import listCommand from '../commands/github/endpoint/$list.js';
import addCommand from '../commands/github/endpoint/add/$[id].js';
import removeCommand from '../commands/github/endpoint/remove/$[id].js';
import { githubRuntimeStateToken } from '../src/github-runtime-state.js';

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
      if (token === githubRuntimeStateToken) return state;
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

describe('github endpoint command definitions', async () => {
  it('三个命令模块均为合法 defineCommand', async () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add：app_id/webhook_secret 写 .env，private_key 内联为文件路径', async () => {
    const text = await addCommand.execute(fakeContext({
      params: { id: 'bot1' },
      args: ['app_id=123456', 'private_key=./data/bot1.pem', 'webhook_secret=sec-1'],
    })) as string;

    expect(text).toContain('✅');
    const envContent = store.environmentText();
    expect(envContent).toContain('GITHUB_BOT1_APP_ID=123456');
    expect(envContent).toContain('GITHUB_BOT1_WEBHOOK_SECRET=sec-1');
    const config = store.configurationText('github');
    expect(config).toContain('id: bot1');
    expect(config).toContain('${GITHUB_BOT1_APP_ID}');
    expect(config).toContain('${GITHUB_BOT1_WEBHOOK_SECRET}');
    // private_key 走内联路径（gh-client resolvePrivateKey 支持 PEM 内容或路径）
    expect(config).toContain('private_key: ./data/bot1.pem');
  });

  it('add 缺少必填字段时报错', async () => {
    expect(await addCommand.execute(fakeContext({ params: { id: 'bot1' } })))
      .toContain('缺少必填字段：app_id、private_key');
  });

  it('list 显示运行中 + 配置中的 endpoints', async () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('bot1', { id: 'bot1', mode: 'webhook' });
    await addCommand.execute(fakeContext({
      params: { id: 'conf-bot' },
      args: ['app_id=1', 'private_key=./k.pem'],
    }));

    const text = await listCommand.execute(context) as string;

    expect(text).toContain('bot1（webhook）');
    expect(text).toContain('conf-bot（app_id: ${GITHUB_CONF_BOT_APP_ID}）');
  });

  it('remove 从配置移除并提示重启', async () => {
    await addCommand.execute(fakeContext({
      params: { id: 'bot1' },
      args: ['app_id=1', 'private_key=./k.pem'],
    }));

    const text = await removeCommand.execute(fakeContext({ params: { id: 'bot1' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(store.configurationText('github')).not.toContain('id: bot1');
  });

  it('配置 master 后非 master 拒绝 add/remove', async () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'bob' } },
      params: { id: 'bot1' },
      args: ['app_id=1', 'private_key=./k.pem'],
    });

    expect(await addCommand.execute(denied)).toBe('仅 master 可执行 GitHub endpoint 管理命令');
    expect(await removeCommand.execute(denied)).toBe('仅 master 可执行 GitHub endpoint 管理命令');
  });
});
