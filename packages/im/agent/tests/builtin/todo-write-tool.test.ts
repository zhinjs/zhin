/**
 * todo_write 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTodoWriteTool,
  TodoWriteBuiltinTool,
} from '../../src/builtin/todo-write-tool.js';
import { TodoReadBuiltinTool } from '../../src/builtin/todo-read-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('TodoWriteBuiltinTool', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-todo-write-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createTodoWriteTool(dataDir);
    expect(tool.name).toBe('todo_write');
    expect(tool.description).toContain('计划');
    expect(tool.parameters.required).toContain('items');
    expect(tool.source).toBe('builtin:agent');
  });

  it('run 写入后可在根目录读取', async () => {
    const writeInst = new TodoWriteBuiltinTool(dataDir);
    const out = String(
      await writeInst.run({
        items: [
          { title: 'One', status: 'pending' },
          { title: 'Two', status: 'done' },
        ],
      }),
    );
    expect(out).toMatch(/Tasks updated \(1\/2/);
    const todoPath = path.join(dataDir, 'TODO.json');
    expect(fs.existsSync(todoPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(todoPath, 'utf-8'));
    expect(raw.items).toHaveLength(2);
    expect(raw.updated_at).toBeDefined();

    const readInst = new TodoReadBuiltinTool(dataDir);
    const readOut = String(await readInst.run({ chat_id: 'global' }));
    expect(readOut).toContain('One');
    expect(readOut).toContain('Two');
  });

  it('run chat_id 写入 groups 子目录且 mkdir 递归', async () => {
    const writeInst = new TodoWriteBuiltinTool(dataDir);
    await writeInst.run({
      chat_id: 'room-42',
      items: [{ title: 'G', status: 'in-progress' }],
    });
    const todoPath = path.join(dataDir, 'groups', 'room-42', 'TODO.json');
    expect(fs.existsSync(todoPath)).toBe(true);

    const readInst = new TodoReadBuiltinTool(dataDir);
    expect(String(await readInst.run({ chat_id: 'room-42' }))).toContain('G');
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const tool = createTodoWriteTool(dataDir);
    const ctx = { platform: 'test' } as ToolContext;
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({
      items: [{ title: 'via execute', status: 'done' }],
    });
    expect(String(result)).toContain('Tasks updated');
    expect(fs.existsSync(path.join(dataDir, 'TODO.json'))).toBe(true);
  });
});
