/**
 * read_memory — 读取持久化记忆（AGENTS.md）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const READ_MEMORY_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      description: "'global' 或 'chat'（默认 chat）",
      enum: ['global', 'chat'],
    },
    chat_id: { type: 'string', description: '聊天 ID（chat scope 时使用）' },
  },
  required: ['scope'],
};

export class ReadMemoryBuiltinTool extends BuiltinBaseTool {
  readonly name = 'read_memory';
  readonly description =
    '读取持久化记忆（AGENTS.md）。记忆跨会话保持。scope: global（共享）或 chat（按聊天隔离）';
  readonly parameters = READ_MEMORY_PARAMETERS;
  readonly kind = 'memory';

  constructor(private readonly dataDir: string) {
    super();
    this.tags.push('memory', 'agents');
    this.keywords.push('记忆', '记住', '回忆', '之前', '上次', 'memory');
  }

  async run(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    try {
      const memPath = args.scope === 'global'
        ? path.join(this.dataDir, 'AGENTS.md')
        : path.join(this.dataDir, 'groups', (args.chat_id as string) || 'default', 'AGENTS.md');
      if (!fs.existsSync(memPath)) return 'No memory stored yet.';
      return await fs.promises.readFile(memPath, 'utf-8');
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createReadMemoryTool(dataDir: string): Tool {
  return new ReadMemoryBuiltinTool(dataDir).toTool();
}
