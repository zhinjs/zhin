/**
 * Agent session persistence models.
 */

import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import {
  normalizeUserMessageForStorage,
  parseAgentMessageExtra,
  renderUserMessageForLlm,
  type AgentMessageExtra,
} from './sender-extra.js';

// ── agent_sessions ──

export type AgentSessionStatus = 'active' | 'archived';

export const AGENT_SESSION_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  session_key: { type: 'text' as const, nullable: false },
  model: { type: 'text' as const, default: '' },
  status: { type: 'text' as const, default: 'active' },
  active_leaf_message_id: { type: 'integer' as const, nullable: true },
  created_at: { type: 'integer' as const, default: 0 },
  updated_at: { type: 'integer' as const, default: 0 },
};

export interface AgentSessionRecord {
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
  session_key: string;
  model?: string;
}

// ── agent_messages ──

export const AGENT_MESSAGE_MODEL = {
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  session_id: { type: 'text' as const, nullable: false },
  role: { type: 'text' as const, nullable: false },
  payload: { type: 'text' as const, nullable: false },
  parent_id: { type: 'integer' as const, nullable: true },
  /** JSON compatibility projection for sender/quote metadata; actor also lives in user payload. */
  extra: { type: 'text' as const, default: '' },
  timestamp: { type: 'integer' as const, nullable: false },
};

export interface AgentMessageRow {
  id?: number;
  session_id: string;
  role: string;
  /** DB 读出时可能已被方言解析为对象（SQLite JSON 字段） */
  payload: string | AgentMessage;
  parent_id?: number | null;
  extra?: string | AgentMessageExtra | null;
  timestamp: number;
}

export type { AgentMessageExtra, AgentMessageSenderExtra, SenderScope } from './sender-extra.js';

export function serializeAgentMessage(
  message: AgentMessage,
  extra?: AgentMessageExtra,
): AgentMessageRow {
  const stored = normalizeUserMessageForStorage(message, extra);
  return {
    session_id: '',
    role: stored.message.role,
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

/** 加载 LLM 上下文：按需从 `extra` 拼接 sender 前缀 */
export function agentMessageRowToLlm(row: AgentMessageRow): AgentMessage | null {
  const parsed = parseAgentMessageRow(row);
  if (!parsed) return null;
  if (parsed.role !== 'user') return parsed;
  const extra = parseAgentMessageExtra(row.extra);
  if (extra?.sender || extra?.quote || (parsed as UserMessage).actor) {
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
  created_at: { type: 'integer' as const, default: 0 },
};

export interface AgentSummaryRecord {
  id?: number;
  session_id: string;
  summary: string;
  anchor_message_id?: number | null;
  branch_anchor_message_id?: number | null;
  created_at: number;
}
