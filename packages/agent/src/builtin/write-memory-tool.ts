/**
 * write_memory — 写入持久化记忆（AGENTS.md）
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const WRITE_MEMORY_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    content: { type: 'string', description: '要保存的记忆内容（Markdown）' },
    scope: {
      type: 'string',
      description: "'global' 或 'chat'（默认 chat）",
      enum: ['global', 'chat'],
    },
    chat_id: { type: 'string', description: '聊天 ID' },
  },
  required: ['content'],
};

export class WriteMemoryBuiltinTool extends BuiltinBaseTool {
  readonly name = 'write_memory';
  readonly description = '写入持久化记忆。当用户说"记住…"、"记录…"时使用此工具';
  readonly parameters = WRITE_MEMORY_PARAMETERS;
  readonly kind = 'memory';

  constructor(private readonly dataDir: string) {
    super();
    this.tags.push('memory', 'agents');
    this.keywords.push('记住', '保存', 'remember', '记录');
  }

  async run(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    try {
      const memPath = args.scope === 'global'
        ? path.join(this.dataDir, 'AGENTS.md')
        : path.join(this.dataDir, 'groups', (args.chat_id as string) || 'default', 'AGENTS.md');
      await fs.mkdir(path.dirname(memPath), { recursive: true });
      await fs.writeFile(memPath, String(args.content), 'utf-8');
      return `✅ Memory saved (${(args.scope as string) || 'chat'} scope)`;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createWriteMemoryTool(dataDir: string): Tool {
  return new WriteMemoryBuiltinTool(dataDir).toTool();
}
