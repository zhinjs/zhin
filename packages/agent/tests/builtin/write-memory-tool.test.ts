/**
 * write_memory 内置工具单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWriteMemoryTool, WriteMemoryBuiltinTool } from '../../src/builtin/write-memory-tool.js';
import { createReadMemoryTool } from '../../src/builtin/read-memory-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('WriteMemoryBuiltinTool', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-write-mem-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('写入 global 后可读回', async () => {
    const w = new WriteMemoryBuiltinTool(dataDir);
    const msg = String(await w.run({ content: '# note', scope: 'global' }));
    expect(msg).toContain('Memory saved');
    const r = createReadMemoryTool(dataDir);
    expect(String(await normalizeTool(r, {} as ToolContext).execute({ scope: 'global' }))).toBe('# note');
  });

  it('写入 chat scope', async () => {
    const w = new WriteMemoryBuiltinTool(dataDir);
    await w.run({ content: 'c', scope: 'chat', chat_id: 'g99' });
    const f = path.join(dataDir, 'groups', 'g99', 'AGENTS.md');
    expect(fs.readFileSync(f, 'utf-8')).toBe('c');
  });

  it('toTool execute 路径', async () => {
    const tool = createWriteMemoryTool(dataDir);
    const agentTool = normalizeTool(tool, { platform: 't' } as ToolContext);
    const out = String(await agentTool.execute({ content: 'z', scope: 'global' }));
    expect(out).toContain('Memory saved');
  });
});
