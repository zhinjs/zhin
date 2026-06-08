/**
 * memory_upsert — write semantic memory entries (L4).
 */
import type { ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { resolveIMSessionIdFromToolContext } from '@zhin.js/ai';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { getMemoryEntryRepository } from '../memory-entry-registry.js';
import type { MemoryEntryScope } from '@zhin.js/ai';

const PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    key: { type: 'string', description: '记忆键（如 capability:hard_orchestration_v1）' },
    content: { type: 'string', description: '记忆内容（简短事实陈述）' },
    scope: {
      type: 'string',
      enum: ['global', 'platform', 'session', 'user'],
      description: '范围，默认 global',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '可选标签',
    },
    source: { type: 'string', description: '来源说明（如 skill:memory-consolidate）' },
    confidence: { type: 'number', description: '置信度 0–1，默认 1' },
  },
  required: ['key', 'content'],
};

function sessionScopeKey(ctx: ToolContext): string {
  return resolveIMSessionIdFromToolContext({
    platform: ctx.platform || '',
    botId: ctx.botId || '',
    scope: ctx.scope,
    sceneId: ctx.sceneId || '',
    senderId: ctx.senderId || '',
  });
}

class MemoryUpsertTool extends BuiltinBaseTool {
  readonly name = 'memory_upsert';
  readonly description = '写入或更新一条语义记忆（memory_entries），供 memory_search 召回。';
  readonly parameters = PARAMS;
  readonly keywords = ['memory', 'remember', 'store', '记忆', '记住'];

  async run(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const repo = getMemoryEntryRepository();
    if (!repo) return '语义记忆未启用（ai.memory.semantic.enabled）或未初始化数据库。';

    const key = String(args.key ?? '').trim();
    const content = String(args.content ?? '').trim();
    if (!key || !content) return '请提供 key 与 content';

    const scope = (typeof args.scope === 'string' ? args.scope : 'global') as MemoryEntryScope;
    let scopeKey = '';
    if (scope === 'session' && context) {
      scopeKey = sessionScopeKey(context);
    } else if (scope === 'platform' && context?.platform) {
      scopeKey = context.platform;
    } else if (scope === 'user' && context?.senderId) {
      scopeKey = context.senderId;
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

export function createMemoryUpsertTool(): MemoryUpsertTool {
  return new MemoryUpsertTool();
}
