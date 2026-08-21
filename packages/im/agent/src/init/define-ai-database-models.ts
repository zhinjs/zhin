/**
 * Register ADR 0009 AI persistence tables on a Host/plugin `define` surface.
 * Used by legacy `registerDbModels` and Plugin Runtime Agent Host.
 */
import {
  AGENT_SESSION_MODEL,
  AGENT_MESSAGE_MODEL,
  AGENT_SUMMARY_MODEL,
  ORCHESTRATION_RUN_MODEL,
  ORCHESTRATION_TASK_MODEL,
  ORCHESTRATION_EVENT_MODEL,
  MEMORY_ENTRY_MODEL,
} from '@zhin.js/ai';
import { AI_USER_PROFILE_MODEL } from '../user-profile.js';

export type AiDatabaseModelDefiner = (
  name: string,
  definition: Record<string, unknown>,
) => void;

const AI_DATABASE_MODELS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['agent_sessions', AGENT_SESSION_MODEL],
  ['agent_messages', AGENT_MESSAGE_MODEL],
  ['agent_summaries', AGENT_SUMMARY_MODEL],
  ['ai_user_profiles', AI_USER_PROFILE_MODEL],
  ['orchestration_runs', ORCHESTRATION_RUN_MODEL],
  ['orchestration_tasks', ORCHESTRATION_TASK_MODEL],
  ['orchestration_events', ORCHESTRATION_EVENT_MODEL],
  ['memory_entries', MEMORY_ENTRY_MODEL],
];

/** Define all AI and orchestration tables (idempotent per Host generation). */
export function defineAiDatabaseModels(define: AiDatabaseModelDefiner): number {
  for (const [name, definition] of AI_DATABASE_MODELS) {
    define(name, definition);
  }
  return AI_DATABASE_MODELS.length;
}
