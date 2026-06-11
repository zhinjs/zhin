/**
 * bash 内置工具（BuiltinBaseTool）单测 — 注入 exec，避免在 CI 中执行真实 shell
 */
import { describe, it, expect, vi } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import * as core from '@zhin.js/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BashExecAsync } from '../../src/builtin/bash-tool.js';
import { createBashTool, BashBuiltinTool } from '../../src/builtin/bash-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

describe('BashBuiltinTool', () => {
  it('toTool 元数据与 schema 完整', () => {
    const tool = createBashTool();
    expect(tool.name).toBe('bash');
    expect(tool.parameters.required).toContain('command');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.kind).toBe('shell');
  });

  it('run 拦截危险命令（环境导出）并返回 Error 文案', async () => {
    const mockExec: BashExecAsync = async () => {
      throw new Error('exec should not run');
    };
    const inst = new BashBuiltinTool(mockExec, { useSandbox: false });
    const out = String(await inst.run({ command: 'env' }));
    expect(out.startsWith('Error:')).toBe(true);
    expect(out).toContain('禁止执行环境变量导出命令');
  });

  it('run 允许的路径返回 STDOUT（mock exec）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-bash-'));
    try {
      let sawCmd = '';
      let sawOpts: { cwd?: string; timeout?: number; maxBuffer?: number } | undefined;
      const mockExec: BashExecAsync = async (cmd, opts) => {
        sawCmd = cmd;
        sawOpts = opts;
        return { stdout: 'hello-out\n', stderr: '' };
      };
      const inst = new BashBuiltinTool(mockExec, { useSandbox: false });
      const out = String(await inst.run({ command: 'echo ok', cwd: tmp, timeout: 5000 }));
      expect(sawCmd).toBe('echo ok');
      expect(sawOpts?.cwd).toBe(tmp);
      expect(sawOpts?.timeout).toBe(5000);
      expect(sawOpts?.maxBuffer).toBe(1024 * 1024);
      expect(out).toContain('[只读]');
      expect(out).toContain('STDOUT:');
      expect(out).toContain('hello-out');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('run 在 exec 抛错时返回 exit 信息与 stdout/stderr 片段', async () => {
    const mockExec: BashExecAsync = async () => {
      const err = new Error('failed') as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      err.code = 2;
      err.stdout = 'partial-out';
      err.stderr = 'partial-err';
      throw err;
    };
    const inst = new BashBuiltinTool(mockExec, { useSandbox: false });
    const out = String(await inst.run({ command: 'echo x' }));
    expect(out).toContain('Error (exit 2)');
    expect(out).toContain('partial-out');
    expect(out).toContain('partial-err');
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    vi.spyOn(core, 'getPlugin').mockReturnValue({ root: { inject: () => undefined } } as ReturnType<typeof core.getPlugin>);
    const mockExec: BashExecAsync = async () => ({ stdout: 'via-tool\n', stderr: '' });
    const tool = new BashBuiltinTool(mockExec, { useSandbox: false }).toTool();
    const ctx = mockCommMessage({
      adapter: 'process',
      senderId: '1',
      scope: 'private',
    });
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ command: 'echo hi' });
    expect(String(result)).toContain('via-tool');
  });
});
