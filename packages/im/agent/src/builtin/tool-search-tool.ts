/**
 * tool_search — 查询 deferred 工具目录（不执行）
 */
import { filterTools } from '@zhin.js/ai';
import type { Tool, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export const TOOL_SEARCH_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索关键词（工具名、能力、领域，如 github star repo）' },
  },
  required: ['query'],
};

export interface ToolSearchToolOptions {
  getDeferredCatalog: () => AgentTool[];
  maxResults?: number;
}

export class ToolSearchBuiltinTool extends BuiltinBaseTool {
  readonly name = 'tool_search';
  readonly description =
    '在 deferred 工具目录中搜索相关工具（仅列出名称与说明，不执行）。规划任务前用于确定 tool_query';
  readonly parameters = TOOL_SEARCH_PARAMETERS;
  readonly kind = 'meta';

  constructor(private readonly opts: ToolSearchToolOptions) {
    super();
    this.tags.push('search', 'tools', 'deferred');
    this.keywords.push('工具', '搜索', '查找', 'tool', 'search', 'deferred');
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) return '请提供 query 参数';
    const catalog = this.opts.getDeferredCatalog();
    if (catalog.length === 0) return 'Deferred 工具目录为空。';
    const max = this.opts.maxResults ?? 5;
    const icqqQuery = /\bicqq\b|mcp_icqq|send_private|friend\s+send|qq.*消息/i.test(query);
    const pool = icqqQuery
      ? catalog.filter(t => !t.name.startsWith('mcp_filesystem'))
      : catalog;
    const matched = filterTools(query, pool, { maxTools: max, minScore: 0.05 });
    if (matched.length === 0) {
      return `未找到与「${query}」匹配的 deferred 工具。请换关键词或直接在 run_deferred_task 的 tool_query 中描述能力。`;
    }
    const lines = matched.map(t => `- **${t.name}**: ${t.description.slice(0, 160)}`);
    return [
      `找到 ${matched.length} 个相关 deferred 工具（最多 ${max} 个）：`,
      '',
      ...lines,
      '',
      '执行这些能力请调用 run_deferred_task，在 goal 中写清任务，tool_query 可复用本次搜索词。',
    ].join('\n');
  }
}

export function createToolSearchTool(opts: ToolSearchToolOptions): Tool {
  return new ToolSearchBuiltinTool(opts).toTool();
}
