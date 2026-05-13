/**
 * write_file 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWriteFileTool, WriteFileBuiltinTool } from '../../src/builtin/write-file-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('WriteFileBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-write-file-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createWriteFileTool();
    expect(tool.name).toBe('write_file');
    expect(tool.description).toContain('写入');
    expect(tool.parameters.required).toContain('file_path');
    expect(tool.parameters.required).toContain('content');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.tags).toContain('file');
  });

  it('run 写入并创建父目录', async () => {
    const fp = path.join(tmpDir, 'nested', 'out.txt');
    const inst = new WriteFileBuiltinTool();
    const out = String(await inst.run({ file_path: fp, content: 'hello' }));
    expect(out).toContain('Wrote');
    expect(out).toContain(fp);
    expect(fs.readFileSync(fp, 'utf-8')).toBe('hello');
  });

  it('run 拒绝空 file_path', async () => {
    const inst = new WriteFileBuiltinTool();
    const out = String(await inst.run({ file_path: '', content: 'x' }));
    expect(out).toMatch(/Error|required|file_path/i);
  });

  it('run 拒绝写入敏感文件名（策略路径返回 ZHIN_NEEDS_OWNER）', async () => {
    const fp = path.join(tmpDir, '.env');
    const inst = new WriteFileBuiltinTool();
    const out = String(await inst.run({ file_path: fp, content: 'secret' }));
    expect(out.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(out).toMatch(/拒绝|敏感/i);
    expect(fs.existsSync(fp)).toBe(false);
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const tool = createWriteFileTool();
    const fp = path.join(tmpDir, 'via-tool.txt');
    const ctx = { platform: 'test' } as ToolContext;
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ file_path: fp, content: 'ok' });
    expect(String(result)).toContain('Wrote');
    expect(fs.readFileSync(fp, 'utf-8')).toBe('ok');
  });
});
