/**
 * Register ADR 0009 AI persistence tables on a Host/plugin `define` surface.
 * Used by the Plugin Runtime Agent Host.
 */
import {
  AGENT_SESSION_MODEL,
  AGENT_MESSAGE_MODEL,
  AGENT_SUMMARY_MODEL,
  MEMORY_ENTRY_MODEL,
} from '@zhin.js/ai';
import { AI_USER_PROFILE_MODEL } from '../user-profile.js';
import { AI_USER_RELATION_MODEL } from '../user-relation.js';
import { AI_SESSION_PROFILE_MODEL } from '../session-profile.js';
import { AI_DECISION_EVENTS_TABLE, AI_DECISION_EVENT_MODEL } from '../decision-events.js';
import { AI_CONTROL_STATE_TABLE, AI_CONTROL_STATE_MODEL } from '../control-plane.js';
import { AI_SESSION_OPS_TABLE, AI_SESSION_OPS_MODEL } from '../session-ops.js';

export type AiDatabaseModelDefiner = (
  name: string,
  definition: Record<string, unknown>,
) => void;

const AI_DATABASE_MODELS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['agent_sessions', AGENT_SESSION_MODEL],
  ['agent_messages', AGENT_MESSAGE_MODEL],
  ['agent_summaries', AGENT_SUMMARY_MODEL],
  ['ai_user_profiles', AI_USER_PROFILE_MODEL],
  ['ai_user_relations', AI_USER_RELATION_MODEL],
  ['ai_session_profiles', AI_SESSION_PROFILE_MODEL],
  [AI_DECISION_EVENTS_TABLE, AI_DECISION_EVENT_MODEL],
  [AI_CONTROL_STATE_TABLE, AI_CONTROL_STATE_MODEL],
  [AI_SESSION_OPS_TABLE, AI_SESSION_OPS_MODEL],
  ['memory_entries', MEMORY_ENTRY_MODEL],
];

/** Define agent persistence tables (idempotent per Host generation). */
export function defineAiDatabaseModels(define: AiDatabaseModelDefiner): number {
  for (const [name, definition] of AI_DATABASE_MODELS) {
    define(name, definition);
  }
  return AI_DATABASE_MODELS.length;
}
