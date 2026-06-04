/**
 * write_file 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as core from '@zhin.js/core';
import type { Plugin, ToolContext } from '@zhin.js/core';
import { createWriteFileTool, WriteFileBuiltinTool } from '../../src/builtin/write-file-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';

describe('WriteFileBuiltinTool', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-write-file-'));
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
          return { getAgentConfig: () => ({ execAllowlist: [...execAllowlist] }) };
        }
        return undefined;
      },
      dispatch: vi.fn(),
    } as unknown as Plugin;
    (plugin as unknown as { root: Plugin }).root = plugin;
    vi.spyOn(core, 'getPlugin').mockImplementation(() => plugin as never);
  }

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

  it('admin 且 write_file 不在 execAllowlist 时返回 ZHIN_NEEDS_OWNER', async () => {
    mockPlugin('owner1', ['admin1'], []);
    const fp = path.join(tmpDir, 'blocked-by-role.txt');
    const inst = new WriteFileBuiltinTool();
    const ctx = {
      platform: 'icqq',
      botId: 'bot1',
      senderId: 'admin1',
      roles: ['trusted'],
    } as ToolContext;
    const out = String(await inst.run({ file_path: fp, content: 'x' }, ctx));
    expect(out.startsWith('ZHIN_NEEDS_OWNER:\n')).toBe(true);
    expect(fs.existsSync(fp)).toBe(false);
  });

  it('普通用户调用 write_file 直接拒绝', async () => {
    mockPlugin('owner1', ['admin1'], []);
    const fp = path.join(tmpDir, 'deny-by-role.txt');
    const inst = new WriteFileBuiltinTool();
    const ctx = {
      platform: 'icqq',
      botId: 'bot1',
      senderId: 'user1',
      fileRole: 'user',
    } as ToolContext;
    const out = String(await inst.run({ file_path: fp, content: 'x' }, ctx));
    expect(out).toMatch(/^Error:/);
    expect(fs.existsSync(fp)).toBe(false);
  });

  it('master 调用 write_file 直接放行', async () => {
    mockPlugin('owner1', ['admin1'], []);
    const fp = path.join(tmpDir, 'owner-allowed.txt');
    const inst = new WriteFileBuiltinTool();
    const ctx = {
      platform: 'icqq',
      botId: 'bot1',
      senderId: 'owner1',
      roles: ['master'],
    } as ToolContext;
    const out = String(await inst.run({ file_path: fp, content: 'owner-ok' }, ctx));
    expect(out).toContain('Wrote');
    expect(fs.readFileSync(fp, 'utf-8')).toBe('owner-ok');
  });

  it('admin 且 write_file 在 execAllowlist 时可直接执行', async () => {
    mockPlugin('owner1', ['admin1'], ['write_file']);
    const fp = path.join(tmpDir, 'admin-allowlisted.txt');
    const inst = new WriteFileBuiltinTool();
    const ctx = {
      platform: 'icqq',
      botId: 'bot1',
      senderId: 'admin1',
      roles: ['trusted'],
    } as ToolContext;
    const out = String(await inst.run({ file_path: fp, content: 'allowlisted' }, ctx));
    expect(out).toContain('Wrote');
    expect(fs.readFileSync(fp, 'utf-8')).toBe('allowlisted');
  });
});
