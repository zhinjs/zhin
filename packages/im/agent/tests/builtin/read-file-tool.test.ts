/**
 * read_file 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createReadFileTool, ReadFileBuiltinTool } from '../../src/builtin/read-file-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('ReadFileBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-read-file-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createReadFileTool();
    expect(tool.name).toBe('read_file');
    expect(tool.description).toContain('读取');
    expect(tool.parameters.required).toContain('file_path');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.tags).toContain('file');
  });

  it('run 读取文本并带行号', async () => {
    const fp = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(fp, 'line1\nline2\n', 'utf-8');
    const inst = new ReadFileBuiltinTool();
    const out = String(await inst.run({ file_path: fp }));
    expect(out).toContain('line1');
    expect(out).toContain('1 | line1');
    expect(out).toContain('2 | line2');
  });

  it('run 拒绝空 file_path', async () => {
    const inst = new ReadFileBuiltinTool();
    const out = String(await inst.run({ file_path: '' }));
    expect(out).toMatch(/Error|required|file_path/i);
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const tool = createReadFileTool();
    const fp = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fp, 'ok', 'utf-8');
    const ctx = { platform: 'test' } as ToolContext;
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ file_path: fp });
    expect(String(result)).toContain('ok');
  });
});
