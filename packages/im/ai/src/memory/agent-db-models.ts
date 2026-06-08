/**
 * ADR 0009 D4 — new persistence models (agent_* + im_transcripts).
 */

import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import {
  normalizeUserMessageForStorage,
  parseAgentMessageExtra,
  renderUserMessageForLlm,
  type AgentMessageExtra,
} from './sender-extra.js';

// ── im_transcripts ──

export const IM_TRANSCRIPT_MODEL = {
  message_id: { type: 'text' as const, default: '' },
  platform: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  scene_type: { type: 'text' as const, nullable: false },
  sender_id: { type: 'text' as const, nullable: false },
  sender_name: { type: 'text' as const, default: '' },
  sender_role: { type: 'text' as const, default: 'user' },
  direction: { type: 'text' as const, nullable: false },
  body: { type: 'text' as const, default: '' },
  media_json: { type: 'text' as const, default: '' },
  time: { type: 'integer' as const, nullable: false },
};

export type ImTranscriptDirection = 'inbound' | 'outbound';

export interface ImTranscriptRecord {
  id?: number;
  message_id?: string;
  platform: string;
  bot_id: string;
  scene_id: string;
  scene_type: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  direction: ImTranscriptDirection;
  body: string;
  media_json: string;
  time: number;
}

export interface ImTranscriptWriteInput {
  message_id?: string;
  platform: string;
  bot_id: string;
  scene_id: string;
  scene_type: string;
  sender_id: string;
  sender_name?: string;
  sender_role?: string;
  direction: ImTranscriptDirection;
  body: string;
  media_json?: string;
  time?: number;
}

// ── agent_sessions ──

export type AgentSessionStatus = 'active' | 'archived';

export const AGENT_SESSION_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  session_key: { type: 'text' as const, nullable: false },
  platform: { type: 'text' as const, nullable: false },
  bot_id: { type: 'text' as const, nullable: false },
  scene_id: { type: 'text' as const, nullable: false },
  scene_type: { type: 'text' as const, nullable: false },
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
  platform: string;
  bot_id: string;
  scene_id: string;
  scene_type: string;
  model: string;
  status: AgentSessionStatus;
  active_leaf_message_id?: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateAgentSessionInput {
  session_key: string;
  platform: string;
  bot_id: string;
  scene_id: string;
  scene_type: string;
  model?: string;
}

// ── agent_messages ──

export const AGENT_MESSAGE_MODEL = {
  id: { type: 'integer' as const, primary: true, autoIncrement: true },
  session_id: { type: 'text' as const, nullable: false },
  role: { type: 'text' as const, nullable: false },
  payload: { type: 'text' as const, nullable: false },
  parent_id: { type: 'integer' as const, nullable: true },
  /** JSON：群/频道 user 消息的 sender 元数据（id/name/roles/scope），payload 仅存用户正文 */
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
  if (extra?.sender || extra?.quote) {
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
