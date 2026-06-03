/**
 * edit_file 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as core from '@zhin.js/core';
import { createEditFileTool, EditFileBuiltinTool } from '../../src/builtin/edit-file-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('EditFileBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-edit-file-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockPlugin(master = 'owner1', trusted: string[] = ['admin1'], execAllowlist: string[] = []) {
    const plugin = {
      inject: (name: string) => {
        if (name === 'icqq') {
          return { bots: new Map([['bot1', { $config: { master, trusted } }]]) };
        }
        if (name === 'ai') {
          return { getAgentConfig: () => ({ execAllowlist }) };
        }
        return undefined;
      },
    } as unknown as core.Plugin;
    (plugin as unknown as { root: core.Plugin }).root = plugin;
    vi.spyOn(core, 'getPlugin').mockReturnValue(plugin as never);
  }

  it('toTool 元数据与 schema 完整', () => {
    const tool = createEditFileTool();
    expect(tool.name).toBe('edit_file');
    expect(tool.description).toContain('替换');
    expect(tool.parameters.required).toContain('file_path');
    expect(tool.parameters.required).toContain('old_string');
    expect(tool.parameters.required).toContain('new_string');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.tags).toContain('file');
  });

  it('run 成功替换唯一片段', async () => {
    const fp = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(fp, 'alpha\nbeta\n', 'utf-8');
    const inst = new EditFileBuiltinTool();
    const out = String(
      await inst.run({ file_path: fp, old_string: 'beta', new_string: 'gamma' }),
    );
    expect(out).toContain('Edited');
    expect(fs.readFileSync(fp, 'utf-8')).toBe('alpha\ngamma\n');
  });

  it('run 当 old_string 不存在时返回错误', async () => {
    const fp = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fp, 'only', 'utf-8');
    const inst = new EditFileBuiltinTool();
    const out = String(
      await inst.run({ file_path: fp, old_string: 'missing', new_string: 'x' }),
    );
    expect(out).toMatch(/not found|old_string/i);
    expect(fs.readFileSync(fp, 'utf-8')).toBe('only');
  });

  it('run 当 old_string 出现多次时返回警告', async () => {
    const fp = path.join(tmpDir, 'dup.txt');
    fs.writeFileSync(fp, 'x x x', 'utf-8');
    const inst = new EditFileBuiltinTool();
    const out = String(await inst.run({ file_path: fp, old_string: 'x', new_string: 'y' }));
    expect(out).toMatch(/appears|Warning|unique/i);
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const tool = createEditFileTool();
    const fp = path.join(tmpDir, 'c.txt');
    fs.writeFileSync(fp, 'one two', 'utf-8');
    const ctx = { platform: 'test' } as ToolContext;
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({
      file_path: fp,
      old_string: 'two',
      new_string: 'three',
    });
    expect(String(result)).toContain('Edited');
    expect(fs.readFileSync(fp, 'utf-8')).toBe('one three');
  });

  it('admin 且 edit_file 不在 execAllowlist 时返回 ZHIN_NEEDS_OWNER', async () => {
    mockPlugin('owner1', ['admin1'], []);
    const fp = path.join(tmpDir, 'role-edit.txt');
    fs.writeFileSync(fp, 'before', 'utf-8');
    const inst = new EditFileBuiltinTool();
    const ctx = {
      platform: 'icqq',
      botId: 'bot1',
      senderId: 'admin1',
      roles: ['trusted'],
    } as ToolContext;
    const out = String(await inst.run({ file_path: fp, old_string: 'before', new_string: 'after' }, ctx));
    expect(out.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(fs.readFileSync(fp, 'utf-8')).toBe('before');
  });

  it('普通用户调用 edit_file 直接拒绝', async () => {
    mockPlugin('owner1', ['admin1'], []);
    const fp = path.join(tmpDir, 'role-edit-deny.txt');
    fs.writeFileSync(fp, 'before', 'utf-8');
    const inst = new EditFileBuiltinTool();
    const ctx = {
      platform: 'icqq',
      botId: 'bot1',
      senderId: 'user1',
      fileRole: 'user',
    } as ToolContext;
    const out = String(await inst.run({ file_path: fp, old_string: 'before', new_string: 'after' }, ctx));
    expect(out).toMatch(/^Error:/);
    expect(fs.readFileSync(fp, 'utf-8')).toBe('before');
  });
});
