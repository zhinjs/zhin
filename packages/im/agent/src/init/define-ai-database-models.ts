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
import { AI_SCENE_MEMBERS_TABLE, AI_SCENE_MEMBER_MODEL } from '../scene-facts.js';
import { AI_DECISION_EVENTS_TABLE, AI_DECISION_EVENT_MODEL } from '../decision-events.js';
import { AI_CONTROL_STATE_TABLE, AI_CONTROL_STATE_MODEL } from '../control-plane.js';
import { AI_SESSION_OPS_TABLE, AI_SESSION_OPS_MODEL } from '../session-ops.js';
import { AI_ANNOUNCEMENTS_TABLE, AI_ANNOUNCEMENT_MODEL } from '../announcements.js';
import { AI_SESSION_EVENTS_TABLE, AI_SESSION_EVENT_MODEL } from '../session-events.js';
import { AI_GROUP_RULES_TABLE, AI_GROUP_RULE_MODEL } from '../group-rules.js';

export type AiDatabaseModelDefiner = (
  name: string,
  definition: Record<string, unknown>,
  options?: { readonly addColumns?: readonly string[] },
) => void;

type AiDatabaseModelEntry = readonly [string, Record<string, unknown>, { readonly addColumns?: readonly string[] }?];

const AI_DATABASE_MODELS: ReadonlyArray<AiDatabaseModelEntry> = [
  ['agent_sessions', AGENT_SESSION_MODEL],
  ['agent_messages', AGENT_MESSAGE_MODEL],
  ['agent_summaries', AGENT_SUMMARY_MODEL],
  ['ai_user_profiles', AI_USER_PROFILE_MODEL],
  ['ai_user_relations', AI_USER_RELATION_MODEL],
  // ADR 0041 §6: columns added after first release are migrated additively on existing databases.
  ['ai_session_profiles', AI_SESSION_PROFILE_MODEL, { addColumns: ['owner_id', 'member_count', 'facts_updated_at'] }],
  [AI_SCENE_MEMBERS_TABLE, AI_SCENE_MEMBER_MODEL],
  [AI_DECISION_EVENTS_TABLE, AI_DECISION_EVENT_MODEL],
  [AI_CONTROL_STATE_TABLE, AI_CONTROL_STATE_MODEL],
  [AI_SESSION_OPS_TABLE, AI_SESSION_OPS_MODEL],
  [AI_ANNOUNCEMENTS_TABLE, AI_ANNOUNCEMENT_MODEL],
  [AI_SESSION_EVENTS_TABLE, AI_SESSION_EVENT_MODEL],
  [AI_GROUP_RULES_TABLE, AI_GROUP_RULE_MODEL],
  ['memory_entries', MEMORY_ENTRY_MODEL],
];

/** Define agent persistence tables (idempotent per Host generation). */
export function defineAiDatabaseModels(define: AiDatabaseModelDefiner): number {
  for (const [name, definition, options] of AI_DATABASE_MODELS) {
    if (options) define(name, definition, options); else define(name, definition);
  }
  return AI_DATABASE_MODELS.length;
}
