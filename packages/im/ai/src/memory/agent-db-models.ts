/**
 * Agent session persistence models.
 */

import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import {
  normalizeUserMessageForStorage,
  parseAgentMessageExtra,
  renderUserMessageForLlm,
  type AgentMessageExtra,
} from './user-message-presentation.js';

/** Query dimensions only; arbitrary content and extensions remain lossless in payload. */
const nullableText = { type: 'text' as const, nullable: true };
export const AGENT_SESSION_SOURCE_MODEL = {
  source_kind: nullableText, source_adapter: nullableText, source_endpoint: nullableText,
  source_scope: nullableText, source_id: nullableText, source_parent_kind: nullableText,
  source_parent_id: nullableText, source_thread_id: nullableText,
};
export interface AgentSessionSource {
  kind: string; adapter?: string; endpoint?: string; scope?: string; id?: string;
  parentKind?: string; parentId?: string; threadId?: string;
}
export function agentSessionSourceFields(source?: AgentSessionSource): Record<string, string | null> {
  return { source_kind: source?.kind ?? null, source_adapter: storageIdentity(source?.adapter),
    source_endpoint: storageIdentity(source?.endpoint), source_scope: source?.scope ?? null,
    source_id: storageIdentity(source?.id), source_parent_kind: source?.parentKind ?? null,
    source_parent_id: storageIdentity(source?.parentId), source_thread_id: storageIdentity(source?.threadId) };
}
function storageIdentity(value: string | undefined): string | null {
  return value === undefined ? null : `k1:${value.replaceAll('%', '%25').replaceAll('\0', '%00')}`;
}

export const AGENT_MESSAGE_QUERY_MODEL = {
  actor_id: nullableText, actor_name: nullableText, actor_scope: nullableText, actor_origin: nullableText,
  turn_id: nullableText, turn_intent: nullableText, target_turn_id: nullableText,
  api: nullableText, provider: nullableText, model: nullableText, stop_reason: nullableText,
  tool_call_id: nullableText, tool_name: nullableText, is_error: { type: 'boolean' as const, nullable: true },
  query_version: { type: 'integer' as const, nullable: true },
};

export function agentMessageQueryFields(message: AgentMessage): Record<string, string | number | boolean | null> {
  const user = message.role === 'user' ? message as UserMessage : undefined;
  const assistant = message.role === 'assistant' ? message as import('../llm/types/agent-message.js').AssistantMessage : undefined;
  const result = message.role === 'toolResult' ? message as import('../llm/types/agent-message.js').ToolResultMessage : undefined;
  return { actor_id: storageIdentity(user?.actor?.subjectId), actor_name: storageIdentity(user?.actor?.displayName),
    actor_scope: user?.actor?.scope ?? null, actor_origin: user?.actor?.origin ?? null,
    turn_id: storageIdentity(user?.cause?.turnId), turn_intent: user?.cause?.intent ?? null, target_turn_id: storageIdentity(user?.cause?.targetTurnId),
    api: assistant?.api ?? null, provider: assistant?.provider ?? null, model: assistant?.model ?? null, stop_reason: assistant?.stopReason ?? null,
    tool_call_id: storageIdentity(result?.toolCallId), tool_name: result?.toolName ?? null, is_error: result?.isError ?? null,
    query_version: 1 };
}

// ── agent_sessions ──

export type AgentSessionStatus = 'active' | 'archived';

export const AGENT_SESSION_MODEL = {
  ...AGENT_SESSION_SOURCE_MODEL,
  session_id: { type: 'text' as const, nullable: false },
  session_key: { type: 'text' as const, nullable: false },
  model: { type: 'text' as const, default: '' },
  status: { type: 'text' as const, default: 'active' },
  active_leaf_message_id: { type: 'integer' as const, nullable: true },
  created_at: { type: 'bigint' as const, default: 0 },
  updated_at: { type: 'bigint' as const, default: 0 },
};

export interface AgentSessionRecord {
  [key: `source_${string}`]: string | null;
  id?: number;
  session_id: string;
  session_key: string;
  model: string;
  status: AgentSessionStatus;
  active_leaf_message_id?: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateAgentSessionInput {
  source?: AgentSessionSource;
  session_key: string;
  model?: string;
}

// ── agent_messages ──

export const AGENT_MESSAGE_MODEL = {
  ...AGENT_MESSAGE_QUERY_MODEL,
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  session_id: { type: 'text' as const, nullable: false },
  role: { type: 'text' as const, nullable: false },
  payload: { type: 'text' as const, nullable: false },
  parent_id: { type: 'integer' as const, nullable: true },
  /** JSON presentation context; participant identity lives only in user payload actor. */
  extra: { type: 'text' as const, default: '' },
  timestamp: { type: 'bigint' as const, nullable: false },
};

export interface AgentMessageRow {
  [key: string]: unknown;
  id?: number;
  session_id: string;
  role: string;
  /** DB 读出时可能已被方言解析为对象（SQLite JSON 字段） */
  payload: string | AgentMessage;
  parent_id?: number | null;
  extra?: string | AgentMessageExtra | null;
  timestamp: number;
}

export type { AgentMessageExtra } from './user-message-presentation.js';

export function serializeAgentMessage(
  message: AgentMessage,
  extra?: AgentMessageExtra,
): AgentMessageRow {
  // `aliasSeq` is derived from stored order on every load (ADR 0043 §5); it is never persisted.
  const { aliasSeq: _derived, aliasParts: _derivedParts, ...persistable } = message as AgentMessage & { aliasSeq?: number; aliasParts?: readonly (string | null)[] };
  const stored = normalizeUserMessageForStorage(persistable as AgentMessage, extra);
  return {
    session_id: '',
    role: stored.message.role,
    ...agentMessageQueryFields(stored.message),
    payload: JSON.stringify(stored.message),
    extra: stored.extra ? JSON.stringify(stored.extra) : '',
    timestamp: stored.message.timestamp ?? Date.now(),
  };
}

function resolveAgentMessagePayload(payload: string | AgentMessage): AgentMessage | null {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as AgentMessage;
    } catch {
      return null;
    }
  }
  if (payload && typeof payload === 'object' && 'role' in payload) {
    return payload;
  }
  return null;
}

/** 读出 DB 行：payload 为用户可见正文（不含 sender 前缀） */
export function parseAgentMessageRow(row: AgentMessageRow): AgentMessage | null {
  const parsed = resolveAgentMessagePayload(row.payload);
  if (!parsed || typeof parsed !== 'object' || !parsed.role) return null;
  if (parsed.timestamp == null) {
    parsed.timestamp = row.timestamp;
  }
  return parsed;
}

/** 加载 LLM 上下文：从 actor 与引用上下文渲染模型输入。 */
export function agentMessageRowToLlm(row: AgentMessageRow): AgentMessage | null {
  const parsed = parseAgentMessageRow(row);
  if (!parsed) return null;
  if (parsed.role !== 'user') return parsed;
  const extra = parseAgentMessageExtra(row.extra);
  if (extra?.quote || (parsed as UserMessage).actor
    || (parsed as UserMessage).content.some(block => block.presentation === 'user-input')) {
    return renderUserMessageForLlm(parsed as UserMessage, extra);
  }
  return parsed;
}

// ── agent_summaries ──

export const AGENT_SUMMARY_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  summary: { type: 'text' as const, nullable: false },
  anchor_message_id: { type: 'integer' as const, nullable: true },
  branch_anchor_message_id: { type: 'integer' as const, nullable: true },
  created_at: { type: 'bigint' as const, default: 0 },
};

export interface AgentSummaryRecord {
  id?: number;
  session_id: string;
  summary: string;
  anchor_message_id?: number | null;
  branch_anchor_message_id?: number | null;
  created_at: number;
}
