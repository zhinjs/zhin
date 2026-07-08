/**
 * list_dir 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createListDirTool, ListDirBuiltinTool } from '../../src/builtin/list-dir-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

describe('ListDirBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-list-dir-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createListDirTool();
    expect(tool.name).toBe('list_dir');
    expect(tool.description).toContain('List');
    expect(tool.parameters.required).toContain('path');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.tags).toContain('file');
  });

  it('run 列出文件与目录并排序', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'z.txt'), '', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '', 'utf-8');
    const inst = new ListDirBuiltinTool();
    const out = String(await inst.run({ path: tmpDir }));
    expect(out).toContain('[DIR]  sub');
    expect(out).toContain('a.txt');
    expect(out).toContain('z.txt');
    expect(out.indexOf('a.txt')).toBeLessThan(out.indexOf('z.txt'));
  });

  it('run 空目录提示', async () => {
    const inst = new ListDirBuiltinTool();
    const out = String(await inst.run({ path: tmpDir }));
    expect(out).toContain('empty');
  });

  it('run 拒绝非目录', async () => {
    const fp = path.join(tmpDir, 'f');
    fs.writeFileSync(fp, 'x', 'utf-8');
    const inst = new ListDirBuiltinTool();
    const out = String(await inst.run({ path: fp }));
    expect(out).toMatch(/Not a directory/i);
  });

  it('run 拒绝空 path', async () => {
    const inst = new ListDirBuiltinTool();
    const out = String(await inst.run({ path: '' }));
    expect(out).toMatch(/required|path/i);
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const tool = createListDirTool();
    const ctx = mockCommMessage({ adapter: 'test' });
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ path: tmpDir });
    expect(String(result)).toContain('empty');
  });
});
