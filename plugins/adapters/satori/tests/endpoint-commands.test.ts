import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import { createEndpointRuntimeState } from 'zhin.js/adapter';
import listCommand from '../commands/endpoint/list.js';
import addCommand from '../commands/endpoint/add/[id].js';
import removeCommand from '../commands/endpoint/remove/[id].js';
import { satoriRuntimeStateToken } from '../src/satori-runtime-state.js';

/**
 * commands/ 下的命令定义冒烟 + kv add / remove 基本行为（通用套件逻辑见
 * packages/im/adapter/tests/endpoint-commands.test.ts）。
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-cmd-'));
  fs.writeFileSync(path.join(root, 'zhin.config.yml'), 'plugins: {}\n');
  process.env.ZHIN_PROJECT_ROOT = root;
});

afterEach(() => {
  delete process.env.ZHIN_PROJECT_ROOT;
  delete process.env.SATORI_BOT1_TOKEN;
  fs.rmSync(root, { recursive: true, force: true });
});

function fakeContext(overrides: Record<string, unknown> = {}) {
  const state = createEndpointRuntimeState();
  return {
    state,
    use: (token: unknown) => {
      if (token === satoriRuntimeStateToken) return state;
      throw new Error(`unexpected token: ${String(token)}`);
    },
    params: Object.freeze({}),
    args: Object.freeze([]),
    input: undefined,
    config: undefined,
    ...overrides,
  } as never;
}

describe('satori.endpoint command definitions', () => {
  it('三个命令模块均为合法 defineCommand', () => {
    for (const definition of [listCommand, addCommand, removeCommand]) {
      expect(() => parseCommandDefinition(definition)).not.toThrow();
    }
  });

  it('add 走 kv 参数：凭据写 .env，yaml 存 ${REF}', () => {
    const text = addCommand.execute(fakeContext({
      params: { id: 'bot1' },
      args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'],
    })) as string;

    expect(text).toContain('✅');
    expect(fs.readFileSync(path.join(root, '.env'), 'utf-8')).toContain('SATORI_BOT1_TOKEN=tok-1');
    const config = fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8');
    expect(config).toContain('baseUrl: http://127.0.0.1:5140');
    expect(config).toContain('${SATORI_BOT1_TOKEN}');
  });

  it('add 缺少必填字段时报错', () => {
    expect(addCommand.execute(fakeContext({ params: { id: 'bot1' } })))
      .toContain('缺少必填字段：baseUrl');
  });

  it('list 显示运行中 + 配置中的 endpoints', () => {
    const context = fakeContext();
    (context as { state: ReturnType<typeof createEndpointRuntimeState> }).state
      .endpoints.set('bot1', { id: 'bot1', mode: 'ws' });
    addCommand.execute(fakeContext({ params: { id: 'conf-bot' }, args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'] }));

    const text = listCommand.execute(context) as string;

    expect(text).toContain('bot1（ws）');
    expect(text).toContain('conf-bot');
  });

  it('remove 从配置移除并提示重启', () => {
    addCommand.execute(fakeContext({ params: { id: 'bot1' }, args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'] }));

    const text = removeCommand.execute(fakeContext({ params: { id: 'bot1' } })) as string;

    expect(text).toContain('移除');
    expect(text).toContain('重启');
    expect(fs.readFileSync(path.join(root, 'zhin.config.yml'), 'utf-8')).not.toContain('id: bot1');
  });

  it('配置 master 后非 master 拒绝 add/remove', () => {
    const denied = fakeContext({
      config: { master: 'alice' },
      input: { sender: { id: 'bob' } },
      params: { id: 'bot1' },
      args: ['baseUrl=http://127.0.0.1:5140', 'token=tok-1'],
    });

    expect(addCommand.execute(denied)).toBe('仅 master 可执行 Satori endpoint 管理命令');
    expect(removeCommand.execute(denied)).toBe('仅 master 可执行 Satori endpoint 管理命令');
  });
});
