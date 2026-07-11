/**
 * glob 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createGlobTool, GlobBuiltinTool, type GlobExecAsync } from '../../src/builtin/glob-tool.js';

import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

describe('GlobBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-glob-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createGlobTool();
    expect(tool.name).toBe('glob');
    expect(tool.parameters.required).toContain('pattern');
    expect(tool.source).toBe('builtin:agent');
  });

  it('run 使用注入 exec 返回匹配文件列表', async () => {
    const mockExec: GlobExecAsync = async (command, options) => {
      expect(command).toContain('find . -path');
      expect(options?.cwd).toBe(tmpDir);
      return { stdout: './a.ts\n./b.ts\n', stderr: '' };
    };
    const inst = new GlobBuiltinTool(mockExec);
    const out = String(await inst.run({ pattern: '*.ts', cwd: tmpDir }));
    expect(out).toContain('Found 2 files');
    expect(out).toContain('./a.ts');
  });

  it('run 无匹配时提示', async () => {
    const mockExec: GlobExecAsync = async () => ({ stdout: '', stderr: '' });
    const inst = new GlobBuiltinTool(mockExec);
    const out = String(await inst.run({ pattern: '*.nomatch', cwd: tmpDir }));
    expect(out).toContain('No files matching');
  });

  it('run 拒绝空 pattern', async () => {
    const inst = new GlobBuiltinTool(async () => ({ stdout: '', stderr: '' }));
    const out = String(await inst.run({ pattern: '   ' }));
    expect(out).toMatch(/required|pattern/i);
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const mockExec: GlobExecAsync = async () => ({ stdout: './x.ts\n', stderr: '' });
    const tool = new GlobBuiltinTool(mockExec).toTool();
    const ctx = mockCommMessage({ adapter: 'test' });
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ pattern: '*.ts', cwd: tmpDir });
    expect(String(result)).toContain('Found 1 files');
  });
});
