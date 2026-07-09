/**
 * memory_upsert — write semantic memory entries (L4).
 */
import { type Message, type ToolParametersSchema, type ToolResult, resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { getMemoryEntryRepository } from '../memory-entry-registry.js';
import type { MemoryEntryScope } from '@zhin.js/ai';
const PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    key: { type: 'string', description: 'Memory key (e.g. capability:hard_orchestration_v1)' },
    content: { type: 'string', description: 'Memory content (short factual statement)' },
    scope: {
      type: 'string',
      enum: ['global', 'platform', 'session', 'user'],
      description: 'Scope; default global',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags',
    },
    source: { type: 'string', description: 'Source label (e.g. skill:memory-consolidate)' },
    confidence: { type: 'number', description: 'Confidence 0–1; default 1' },
  },
  required: ['key', 'content'],
};

function sessionScopeKey(commMessage: Message): string {
  return resolveIMSessionIdFromMessage(commMessage);
}

class MemoryUpsertTool extends BuiltinBaseTool {
  readonly name = 'memory_upsert';
  readonly description = 'Write or update a semantic memory entry (memory_entries) for memory_search recall.';
  readonly parameters = PARAMS;
  readonly keywords = ['memory', 'remember', 'store', '记忆', '记住'];

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const repo = getMemoryEntryRepository();
    if (!repo) return '语义记忆未启用（ai.memory.semantic.enabled）或未初始化数据库。';

    const key = String(args.key ?? '').trim();
    const content = String(args.content ?? '').trim();
    if (!key || !content) return '请提供 key 与 content';

    const scope = (typeof args.scope === 'string' ? args.scope : 'global') as MemoryEntryScope;
    let scopeKey = '';
    if (scope === 'session' && commMessage) {
      scopeKey = sessionScopeKey(commMessage);
    } else if (scope === 'platform' && commMessage?.$adapter) {
      scopeKey = String(commMessage.$adapter);
    } else if (scope === 'user' && commMessage?.$sender?.id) {
      scopeKey = commMessage.$sender.id;
    }

    const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;
    const source = typeof args.source === 'string' ? args.source : 'tool:memory_upsert';
    const confidence = typeof args.confidence === 'number' ? args.confidence : 1;

    const record = await repo.upsert({
      scope,
      scope_key: scopeKey,
      key,
      content,
      tags,
      source,
      confidence,
    });

    return `已写入记忆 ${record.id}: [${record.scope}] ${record.key}=${record.content}`;
  }
}

export function createMemoryUpsertTool() {
  return new MemoryUpsertTool().toTool();
}
