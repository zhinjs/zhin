/**
 * memory_search — semantic memory recall (L4, text match v1).
 */
import type { Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { parseMemoryTags } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { getMemoryEntryRepository } from '../memory-entry-registry.js';

const PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search keywords or phrase' },
    scope: {
      type: 'string',
      enum: ['global', 'platform', 'session', 'user'],
      description: 'Optional: limit memory scope',
    },
    limit: { type: 'number', description: 'Max entries to return (default 5)' },
  },
  required: ['query'],
};

function sessionScopeKey(commMessage: Message): string {
  return resolveIMSessionIdFromMessage(commMessage);
}

class MemorySearchTool extends BuiltinBaseTool {
  readonly name = 'memory_search';
  readonly description = 'Search semantic memory (memory_entries) for facts related to query.';
  readonly parameters = PARAMS;
  readonly keywords = ['memory', 'recall', 'remember', '记忆', '回忆'];

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const repo = getMemoryEntryRepository();
    if (!repo) return '语义记忆未启用（ai.memory.semantic.enabled）或未初始化数据库。';

    const query = String(args.query ?? '').trim();
    if (!query) return '请提供 query';

    const scope = typeof args.scope === 'string' ? args.scope : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 5;
    const scopeKey = scope === 'session' && commMessage ? sessionScopeKey(commMessage) : undefined;

    const hits = await repo.search({
      query,
      scope: scope as 'global' | 'platform' | 'session' | 'user' | undefined,
      scope_key: scopeKey,
      limit,
    });

    if (!hits.length) return `未找到与 "${query}" 相关的记忆条目。`;

    const lines = hits.map((e) => {
      const tags = parseMemoryTags(e.tags);
      return `- [${e.scope}${e.scope_key ? `:${e.scope_key}` : ''}] ${e.key}=${e.content}`
        + (tags.length ? ` (tags: ${tags.join(', ')})` : '');
    });
    return `找到 ${hits.length} 条记忆：\n${lines.join('\n')}`;
  }
}

export function createMemorySearchTool() {
  return new MemorySearchTool().toTool();
}
