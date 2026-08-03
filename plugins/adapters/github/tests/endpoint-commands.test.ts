import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { createEndpointRuntimeState } from '@zhin.js/adapter';
import listCommand from '../commands/endpoint/list.js';
import addCommand from '../commands/endpoint/add/[name:string].js';
import removeCommand from '../commands/endpoint/remove/[name:string].js';
import { githubRuntimeStateToken } from '../src/github-runtime-state.js';

/**
 * commands/ 下的命令定义冒烟 + kv add / remove 基本行为（通用套件逻辑见
 * packages/im/adapter/tests/endpoint-commands.test.ts）。
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-cmd-'));
  fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');
  process.env.ZHIN_PROJECT_ROOT = root;
});

afterEach(() => {
  delete process.env.ZHIN_PROJECT_ROOT;
  delete process.env.GITHUB_BOT1_APP_ID;
  delete process.env.GITHUB_BOT1_WEBHOOK_SECRET;
  fs.rmSync(root, { recursive: true, force: true });
});

function fakeContext(overrides: Record<string, unknown> = {}) {
  const state = createEndpointRuntimeState();
  return {
    state,
    use: (token: unknown) => {
      if (token === githubRuntimeStateToken) return state;
      throw new Error(`unexpected token: ${String(token)}`);
    },
    params: Object.freeze({}),
    args: Object.freeze([]),
    input: undefined,
    config: undefined,
    ...overrides,
  } as never;
}

describe('github.endpoint command definitions', () => {
  it('三个命令模块均为合法 defineCommand', () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add：app_id/webhook_secret 写 .env，private_key 内联为文件路径', () => {
    const text = addCommand.execute(fakeContext({
      params: { name: 'bot1' },
      args: ['app_id=123456', 'private_key=./data/bot1.pem', 'webhook_secret=sec-1'],
    })) as string;

    expect(text).toContain('✅');
    const envContent = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    expect(envContent).toContain('GITHUB_BOT1_APP_ID=123456');
    expect(envContent).toContain('GITHUB_BOT1_WEBHOOK_SECRET=sec-1');
    const config = fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8');
    expect(config).toContain('name: bot1');
    expect(config).toContain('${GITHUB_BOT1_APP_ID}');
    expect(config).toContain('${GITHUB_BOT1_WEBHOOK_SECRET}');
    // private_key 走内联路径（gh-client resolvePrivateKey 支持 PEM 内容或路径）
    expect(config).toContain('private_key: ./data/bot1.pem');
  });

  it('add 缺少必填字段时报错', () => {
    expect(addCommand.execute(fakeContext({ params: { name: 'bot1' } })))
      .toContain('缺少必填字段：app_id、private_key');
  });

  it('list 显示运行中 + 配置中的 endpoints', () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('bot1', { name: 'bot1', mode: 'webhook' });
    addCommand.execute(fakeContext({
      params: { name: 'conf-bot' },
      args: ['app_id=1', 'private_key=./k.pem'],
    }));

    const text = listCommand.execute(context) as string;

    expect(text).toContain('bot1（webhook）');
    expect(text).toContain('conf-bot（app_id: ${GITHUB_CONF_BOT_APP_ID}）');
  });

  it('remove 从配置移除并提示重启', () => {
    addCommand.execute(fakeContext({
      params: { name: 'bot1' },
      args: ['app_id=1', 'private_key=./k.pem'],
    }));

    const text = removeCommand.execute(fakeContext({ params: { name: 'bot1' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8')).not.toContain('name: bot1');
  });

  it('配置 master 后非 master 拒绝 add/remove', () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: 'bob' },
      params: { name: 'bot1' },
      args: ['app_id=1', 'private_key=./k.pem'],
    });

    expect(addCommand.execute(denied)).toBe('仅 master 可执行 GitHub endpoint 管理命令');
    expect(removeCommand.execute(denied)).toBe('仅 master 可执行 GitHub endpoint 管理命令');
  });
});
