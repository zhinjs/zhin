import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { createEndpointRuntimeState } from '@zhin.js/adapter';
import listCommand from '../commands/endpoint/list.js';
import addCommand from '../commands/endpoint/add/[[name]].js';
import removeCommand from '../commands/endpoint/remove/[name].js';
import { icqqRuntimeStateToken } from '../src/icqq-runtime-state.js';

/**
 * commands/ 下的命令定义冒烟 + add（bindFlow 引导式登记）/ remove 基本行为
 * （通用套件逻辑见 packages/im/adapter/tests/endpoint-commands.test.ts）。
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'icqq-cmd-'));
  fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');
  process.env.ZHIN_PROJECT_ROOT = root;
});

afterEach(() => {
  delete process.env.ZHIN_PROJECT_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function fakeContext(overrides: Record<string, unknown> = {}) {
  const state = createEndpointRuntimeState();
  return {
    state,
    use: (token: unknown) => {
      if (token === icqqRuntimeStateToken) return state;
      throw new Error(`unexpected token: ${String(token)}`);
    },
    params: Object.freeze({}),
    args: Object.freeze([]),
    input: undefined,
    config: undefined,
    ...overrides,
  } as never;
}

describe('icqq.endpoint command definitions', () => {
  it('三个命令模块均为合法 defineCommand', () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add 无 name 时回复用法与 icqq login 引导', () => {
    const text = addCommand.execute(fakeContext()) as string;
    expect(text).toContain('用法：icqq.endpoint add <uin>');
    expect(text).toContain('icqq login');
  });

  it('add 非数字 name 拒绝', () => {
    expect(addCommand.execute(fakeContext({ params: { name: 'my-bot' } })))
      .toContain('纯数字');
  });

  it('add 合法 uin：写入 { name } 配置项并引导 icqq login + 重启', () => {
    const text = addCommand.execute(fakeContext({ params: { name: '8596238' } })) as string;

    expect(text).toContain('✅');
    expect(text).toContain('icqq login 8596238');
    expect(text).toContain('重启');
    const config = fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8');
    expect(config).toContain('name: "8596238"');
  });

  it('add 重名时报添加失败', () => {
    addCommand.execute(fakeContext({ params: { name: '8596238' } }));
    expect(addCommand.execute(fakeContext({ params: { name: '8596238' } })))
      .toContain('已存在');
  });

  it('list 显示运行中 + 配置中的 endpoints', () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('8596238', { name: '8596238', mode: 'ipc' });
    addCommand.execute(fakeContext({ params: { name: '10001' } }));

    const text = listCommand.execute(context) as string;

    expect(text).toContain('8596238（ipc）');
    expect(text).toContain('10001（ipc（本地守护进程））');
  });

  it('remove 从配置移除并提示重启', () => {
    addCommand.execute(fakeContext({ params: { name: '8596238' } }));

    const text = removeCommand.execute(fakeContext({ params: { name: '8596238' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8')).not.toContain('8596238');
  });

  it('配置 master 后非 master 拒绝 add/remove', () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: 'bob' },
      params: { name: '8596238' },
    });

    expect(addCommand.execute(denied)).toBe('仅 master 可执行 ICQQ endpoint 管理命令');
    expect(removeCommand.execute(denied)).toBe('仅 master 可执行 ICQQ endpoint 管理命令');
  });
});
