/**
 * todo_read — 读取当前任务计划列表（BuiltinBaseTool）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const TODO_READ_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    chat_id: {
      type: 'string',
      description: 'Chat scope ("global" for global, or a specific chat ID)',
    },
  },
  required: ['chat_id'],
};

export class TodoReadBuiltinTool extends BuiltinBaseTool {
  readonly name = 'todo_read';
  readonly description = 'Read the current task plan list to check progress and pending items.';
  readonly parameters = TODO_READ_PARAMETERS;
  readonly kind = 'plan';

  constructor(private readonly dataDir: string) {
    super();
    this.tags.push('plan', 'todo');
    this.keywords.push('任务', '计划', '进度', 'todo', '待办');
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    try {
      const chatId = args.chat_id;
      const dir =
        chatId && chatId !== 'global'
          ? path.join(this.dataDir, 'groups', chatId as string)
          : this.dataDir;
      const todoPath = path.join(dir, 'TODO.json');
      if (!fs.existsSync(todoPath)) return 'No tasks found. Use todo_write to create a plan.';
      const data = JSON.parse(await fs.promises.readFile(todoPath, 'utf-8'));
      if (!data.items || data.items.length === 0) return 'Task list is empty.';
      const lines = data.items.map((item: any, i: number) => {
        const status = item.status === 'done' ? '✅' : item.status === 'in-progress' ? '🔄' : '⬜';
        return `${status} ${i + 1}. ${item.title}${item.detail ? ' — ' + item.detail : ''}`;
      });
      return `📋 Tasks (${data.items.filter((i: any) => i.status === 'done').length}/${data.items.length} done):\n${lines.join('\n')}`;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createTodoReadTool(dataDir: string): Tool {
  return new TodoReadBuiltinTool(dataDir).toTool();
}
