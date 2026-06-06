/**
 * ADR 0009 D4 — new persistence models (agent_* + im_transcripts).
 */

import type { AgentMessage } from '../llm/types/agent-message.js';

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
  session_id: { type: 'text' as const, nullable: false },
  role: { type: 'text' as const, nullable: false },
  payload: { type: 'text' as const, nullable: false },
  timestamp: { type: 'integer' as const, nullable: false },
};

export interface AgentMessageRow {
  id?: number;
  session_id: string;
  role: string;
  payload: string;
  timestamp: number;
}

export function serializeAgentMessage(message: AgentMessage): AgentMessageRow {
  return {
    session_id: '',
    role: message.role,
    payload: JSON.stringify(message),
    timestamp: message.timestamp ?? Date.now(),
  };
}

export function parseAgentMessageRow(row: AgentMessageRow): AgentMessage | null {
  try {
    const parsed = JSON.parse(row.payload) as AgentMessage;
    if (!parsed || typeof parsed !== 'object' || !parsed.role) return null;
    if (parsed.timestamp == null) {
      parsed.timestamp = row.timestamp;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ── agent_summaries ──

export const AGENT_SUMMARY_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  summary: { type: 'text' as const, nullable: false },
  anchor_message_id: { type: 'integer' as const, nullable: true },
  created_at: { type: 'integer' as const, default: 0 },
};

export interface AgentSummaryRecord {
  id?: number;
  session_id: string;
  summary: string;
  anchor_message_id?: number | null;
  created_at: number;
}
