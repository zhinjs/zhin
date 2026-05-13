/**
 * read_memory 内置工具单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createReadMemoryTool, ReadMemoryBuiltinTool } from '../../src/builtin/read-memory-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('ReadMemoryBuiltinTool', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-read-mem-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('无 AGENTS.md 时返回提示', async () => {
    const inst = new ReadMemoryBuiltinTool(dataDir);
    const out = String(await inst.run({ scope: 'global' }));
    expect(out).toBe('No memory stored yet.');
  });

  it('读取 global 记忆', async () => {
    const p = path.join(dataDir, 'AGENTS.md');
    fs.writeFileSync(p, 'hello global', 'utf-8');
    const inst = new ReadMemoryBuiltinTool(dataDir);
    expect(String(await inst.run({ scope: 'global' }))).toBe('hello global');
  });

  it('读取 chat scope 默认 default', async () => {
    const dir = path.join(dataDir, 'groups', 'default');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'chat mem', 'utf-8');
    const inst = new ReadMemoryBuiltinTool(dataDir);
    expect(String(await inst.run({ scope: 'chat' }))).toBe('chat mem');
  });

  it('读取指定 chat_id', async () => {
    const dir = path.join(dataDir, 'groups', 'c1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'scoped', 'utf-8');
    const inst = new ReadMemoryBuiltinTool(dataDir);
    expect(String(await inst.run({ scope: 'chat', chat_id: 'c1' }))).toBe('scoped');
  });

  it('toTool + normalizeTool execute', async () => {
    fs.writeFileSync(path.join(dataDir, 'AGENTS.md'), 'x', 'utf-8');
    const tool = createReadMemoryTool(dataDir);
    const agentTool = normalizeTool(tool, { platform: 't' } as ToolContext);
    expect(String(await agentTool.execute({ scope: 'global' }))).toBe('x');
  });
});
