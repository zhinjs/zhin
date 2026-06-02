/**
 * todo_read 内置工具（BuiltinBaseTool）单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTodoReadTool, TodoReadBuiltinTool } from '../../src/builtin/todo-read-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

describe('TodoReadBuiltinTool', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-todo-read-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('toTool 元数据与 schema 完整', () => {
    const tool = createTodoReadTool(dataDir);
    expect(tool.name).toBe('todo_read');
    expect(tool.description).toContain('任务');
    expect(tool.parameters.required).toContain('chat_id');
    expect(tool.source).toBe('builtin:agent');
    expect(tool.tags).toContain('plan');
  });

  it('run 缺失 TODO.json 返回提示', async () => {
    const inst = new TodoReadBuiltinTool(dataDir);
    const out = String(await inst.run({ chat_id: 'global' }));
    expect(out).toContain('No tasks found');
  });

  it('run items 为空返回 Task list is empty', async () => {
    const todoPath = path.join(dataDir, 'TODO.json');
    fs.writeFileSync(todoPath, JSON.stringify({ items: [] }), 'utf-8');
    const inst = new TodoReadBuiltinTool(dataDir);
    const out = String(await inst.run({ chat_id: 'global' }));
    expect(out).toBe('Task list is empty.');
  });

  it('run 有任务时格式化输出', async () => {
    const todoPath = path.join(dataDir, 'TODO.json');
    fs.writeFileSync(
      todoPath,
      JSON.stringify({
        items: [
          { title: 'A', status: 'pending' },
          { title: 'B', detail: 'x', status: 'done' },
        ],
      }),
      'utf-8',
    );
    const inst = new TodoReadBuiltinTool(dataDir);
    const out = String(await inst.run({ chat_id: 'global' }));
    expect(out).toContain('📋 Tasks');
    expect(out).toContain('1.');
    expect(out).toContain('A');
    expect(out).toContain('✅ 2.');
    expect(out).toContain('B');
    expect(out).toContain('— x');
  });

  it('run chat_id 非 global 时读取 groups 子目录', async () => {
    const groupDir = path.join(dataDir, 'groups', 'chat-99');
    fs.mkdirSync(groupDir, { recursive: true });
    const todoPath = path.join(groupDir, 'TODO.json');
    fs.writeFileSync(todoPath, JSON.stringify({ items: [{ title: 'Scoped', status: 'in-progress' }] }), 'utf-8');
    const inst = new TodoReadBuiltinTool(dataDir);
    const out = String(await inst.run({ chat_id: 'chat-99' }));
    expect(out).toContain('Scoped');
    expect(out).toContain('🔄');
  });

  it('run chat_id 为 global 时使用 data 根目录', async () => {
    fs.writeFileSync(path.join(dataDir, 'TODO.json'), JSON.stringify({ items: [{ title: 'Root', status: 'done' }] }), 'utf-8');
    const inst = new TodoReadBuiltinTool(dataDir);
    const out = String(await inst.run({ chat_id: 'global' }));
    expect(out).toContain('Root');
  });

  it('execute 与 normalizeTool 绑定 context 时可调用', async () => {
    const tool = createTodoReadTool(dataDir);
    fs.writeFileSync(path.join(dataDir, 'TODO.json'), JSON.stringify({ items: [{ title: 'ok', status: 'pending' }] }), 'utf-8');
    const ctx = { platform: 'test' } as ToolContext;
    const agentTool = normalizeTool(tool, ctx);
    const result = await agentTool.execute({ chat_id: 'global' });
    expect(String(result)).toContain('ok');
  });
});
