/**
 * Register ADR 0009 AI persistence tables on a Host/plugin `define` surface.
 * Used by legacy `registerDbModels` and Plugin Runtime Agent Host.
 */
import {
  AGENT_SESSION_MODEL,
  AGENT_MESSAGE_MODEL,
  AGENT_SUMMARY_MODEL,
  IM_TRANSCRIPT_MODEL,
  ORCHESTRATION_RUN_MODEL,
  ORCHESTRATION_TASK_MODEL,
  ORCHESTRATION_EVENT_MODEL,
  MEMORY_ENTRY_MODEL,
} from '@zhin.js/ai';
import { AI_USER_PROFILE_MODEL } from '../user-profile.js';
import {
  COLLABORATION_SCENE_MODEL,
  COLLABORATION_SCENE_MEMBER_MODEL,
  COLLABORATION_SCENE_ARTIFACT_MODEL,
  COLLABORATION_SCENE_ALIAS_MODEL,
  COLLABORATION_INIT_SESSION_MODEL,
  COLLABORATION_INIT_OBSERVATION_MODEL,
  COLLABORATION_SCENE_MEMBER_CHANNEL_MODEL,
} from '../collaboration/collaboration-db-model.js';

export type AiDatabaseModelDefiner = (
  name: string,
  definition: Record<string, unknown>,
) => void;

const AI_DATABASE_MODELS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['im_transcripts', IM_TRANSCRIPT_MODEL],
  ['agent_sessions', AGENT_SESSION_MODEL],
  ['agent_messages', AGENT_MESSAGE_MODEL],
  ['agent_summaries', AGENT_SUMMARY_MODEL],
  ['ai_user_profiles', AI_USER_PROFILE_MODEL],
  ['orchestration_runs', ORCHESTRATION_RUN_MODEL],
  ['orchestration_tasks', ORCHESTRATION_TASK_MODEL],
  ['orchestration_events', ORCHESTRATION_EVENT_MODEL],
  ['memory_entries', MEMORY_ENTRY_MODEL],
  ['collaboration_scenes', COLLABORATION_SCENE_MODEL],
  ['collaboration_scene_members', COLLABORATION_SCENE_MEMBER_MODEL],
  ['collaboration_scene_artifacts', COLLABORATION_SCENE_ARTIFACT_MODEL],
  ['collaboration_scene_aliases', COLLABORATION_SCENE_ALIAS_MODEL],
  ['collaboration_init_sessions', COLLABORATION_INIT_SESSION_MODEL],
  ['collaboration_init_observations', COLLABORATION_INIT_OBSERVATION_MODEL],
  ['collaboration_scene_member_channels', COLLABORATION_SCENE_MEMBER_CHANNEL_MODEL],
];

/** Define all AI / orchestration / collaboration tables (idempotent per Host generation). */
export function defineAiDatabaseModels(define: AiDatabaseModelDefiner): number {
  for (const [name, definition] of AI_DATABASE_MODELS) {
    define(name, definition);
  }
  return AI_DATABASE_MODELS.length;
}
