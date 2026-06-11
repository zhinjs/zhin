/**
 * grep 内置工具（BuiltinBaseTool）单测（注入 exec，避免依赖本机 rg/grep）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GrepExecAsync } from '../../src/builtin/grep-tool.js';
import { createGrepTool, GrepBuiltinTool } from '../../src/builtin/grep-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

describe('GrepBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-grep-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createGrepTool();
    expect(tool.name).toBe('grep');
    expect(tool.parameters.required).toContain('pattern');
    expect(tool.source).toBe('builtin:agent');
  });

  it('run 在 ripgrep 分支返回标注与匹配行', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'hello world\n', 'utf-8');
    const mockExec: GrepExecAsync = async (cmd) => {
      if (cmd.startsWith('rg --version')) {
        return { stdout: 'ripgrep 0.0\n', stderr: '' };
      }
      expect(cmd.startsWith('rg ')).toBe(true);
      return { stdout: 'a.ts:1:hello world\n', stderr: '' };
    };
    const inst = new GrepBuiltinTool(mockExec);
    const out = String(await inst.run({ pattern: 'hello', path: tmpDir, limit: 10 }));
    expect(out).toContain('(ripgrep)');
    expect(out).toContain('hello world');
  });

  it('run 在 grep 回退分支工作', async () => {
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'needle\n', 'utf-8');
    const mockExec: GrepExecAsync = async (cmd) => {
      if (cmd.startsWith('rg --version')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      expect(cmd.startsWith('grep ')).toBe(true);
      return { stdout: './b.txt:needle\n', stderr: '' };
    };
    const inst = new GrepBuiltinTool(mockExec);
    const out = String(await inst.run({ pattern: 'needle', path: tmpDir }));
    expect(out).toContain('(grep)');
    expect(out).toContain('needle');
  });

  it('run 无 stdout 时返回 No matches', async () => {
    const mockExec: GrepExecAsync = async (cmd) => {
      if (cmd.startsWith('rg --version')) {
        return { stdout: 'x', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const inst = new GrepBuiltinTool(mockExec);
    const out = String(await inst.run({ pattern: 'nomatch', path: tmpDir }));
    expect(out).toContain('No matches');
    expect(out).toContain('(ripgrep)');
  });

  it('run 主命令 exit 1 时返回 No matches', async () => {
    const mockExec: GrepExecAsync = async (cmd) => {
      if (cmd.startsWith('rg --version')) {
        return { stdout: 'x', stderr: '' };
      }
      const err = new Error('exit 1') as NodeJS.ErrnoException & { stdout?: string };
      err.code = '1';
      throw err;
    };
    const inst = new GrepBuiltinTool(mockExec);
    const out = String(await inst.run({ pattern: 'x', path: tmpDir }));
    expect(out).toContain("No matches for 'x'");
  });

  it('run 拒绝空 pattern', async () => {
    const inst = new GrepBuiltinTool(async () => ({ stdout: '', stderr: '' }));
    const out = String(await inst.run({ pattern: '' }));
    expect(out).toMatch(/required|pattern/i);
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    fs.writeFileSync(path.join(tmpDir, 'c.ts'), 'foo\n', 'utf-8');
    const mockExec: GrepExecAsync = async (cmd) => {
      if (cmd.startsWith('rg --version')) return { stdout: 'ok', stderr: '' };
      return { stdout: 'c.ts:1:foo\n', stderr: '' };
    };
    const tool = new GrepBuiltinTool(mockExec).toTool();
    const ctx = mockCommMessage({ adapter: 'test' });
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ pattern: 'foo', path: tmpDir });
    expect(String(result)).toContain('foo');
  });
});
