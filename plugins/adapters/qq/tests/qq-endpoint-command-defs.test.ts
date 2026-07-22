import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import listCommand from '../commands/endpoint/list.js';
import addCommand from '../commands/endpoint/add/[name:string=].js';
import cancelCommand from '../commands/endpoint/cancel.js';
import removeCommand from '../commands/endpoint/remove/[name:string].js';
import { createQqRuntimeState, qqRuntimeStateToken } from '../src/qq-runtime-state.js';

/**
 * commands/ 下的命令定义冒烟：模块可加载、defineCommand 形态合法、
 * execute 能用最小 CommandContext 跑通（bind flow 的完整路径见 qq-endpoint-commands.test.ts）。
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-cmd-defs-'));
  fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');
  process.env.ZHIN_PROJECT_ROOT = root;
});

afterEach(() => {
  delete process.env.ZHIN_PROJECT_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

function fakeContext(state = createQqRuntimeState()) {
  return {
    use: (token: unknown) => {
      if (token === qqRuntimeStateToken) return state;
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

  it('list execute 返回运行中 + 配置清单', () => {
    const state = createQqRuntimeState();
    state.endpoints.set('bot-1', { name: 'bot-1', mode: 'websocket' });

    const text = listCommand.execute(fakeContext(state)) as string;

    expect(text).toContain('bot-1');
  });

  it('cancel execute 在无流程时提示', () => {
    expect(cancelCommand.execute(fakeContext())).toContain('没有进行中');
  });

  it('remove execute 读取 ZHIN_PROJECT_ROOT 下的配置', () => {
    expect(removeCommand.execute(fakeContext())).toContain('用法');
  });
});
