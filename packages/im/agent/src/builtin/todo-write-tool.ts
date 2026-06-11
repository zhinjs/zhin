/**
 * todo_write — 创建或更新任务计划（BuiltinBaseTool）
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const TODO_WRITE_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '任务列表 [{title, detail?, status: pending|in-progress|done}]',
    },
    chat_id: {
      type: 'string',
      description: '聊天范围（可选）',
    },
  },
  required: ['items'],
};

export class TodoWriteBuiltinTool extends BuiltinBaseTool {
  readonly name = 'todo_write';
  readonly description = '创建或更新任务计划，用于分解复杂任务并跟踪进度';
  readonly parameters = TODO_WRITE_PARAMETERS;
  readonly kind = 'plan';

  constructor(private readonly dataDir: string) {
    super();
    this.tags.push('plan', 'todo');
    this.keywords.push('创建计划', '更新任务', '标记完成', 'todo');
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    try {
      const chatId = args.chat_id;
      const dir = chatId ? path.join(this.dataDir, 'groups', chatId as string) : this.dataDir;
      const todoPath = path.join(dir, 'TODO.json');
      await fs.mkdir(path.dirname(todoPath), { recursive: true });
      const items = args.items as any[];
      const data = { updated_at: new Date().toISOString(), items };
      await fs.writeFile(todoPath, JSON.stringify(data, null, 2), 'utf-8');
      const done = items.filter((i: any) => i.status === 'done').length;
      return `✅ Tasks updated (${done}/${items.length} done)`;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createTodoWriteTool(dataDir: string): Tool {
  return new TodoWriteBuiltinTool(dataDir).toTool();
}
