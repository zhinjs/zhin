/**
 * Define AI-related database models (ADR 0009).
 */
import { getPlugin } from '@zhin.js/core';
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
  COLLABORATION_CELL_MODEL,
  COLLABORATION_CELL_MEMBER_MODEL,
  COLLABORATION_CELL_ARTIFACT_MODEL,
  COLLABORATION_CELL_SCENE_MODEL,
  COLLABORATION_INIT_SESSION_MODEL,
  COLLABORATION_INIT_OBSERVATION_MODEL,
  COLLABORATION_CELL_MEMBER_CHANNEL_MODEL,
} from '../collaboration/collaboration-db-model.js';

export function registerDbModels(): void {
  const plugin = getPlugin();
  const { logger } = plugin;

  const defineModel = (plugin as unknown as Record<string, unknown>).defineModel as
    | ((name: string, def: Record<string, unknown>) => void)
    | undefined;

  if (typeof defineModel === 'function') {
    defineModel('im_transcripts', IM_TRANSCRIPT_MODEL);
    defineModel('agent_sessions', AGENT_SESSION_MODEL);
    defineModel('agent_messages', AGENT_MESSAGE_MODEL);
    defineModel('agent_summaries', AGENT_SUMMARY_MODEL);
    defineModel('ai_user_profiles', AI_USER_PROFILE_MODEL);
    defineModel('orchestration_runs', ORCHESTRATION_RUN_MODEL);
    defineModel('orchestration_tasks', ORCHESTRATION_TASK_MODEL);
    defineModel('orchestration_events', ORCHESTRATION_EVENT_MODEL);
    defineModel('memory_entries', MEMORY_ENTRY_MODEL);
    defineModel('collaboration_cells', COLLABORATION_CELL_MODEL);
    defineModel('collaboration_cell_members', COLLABORATION_CELL_MEMBER_MODEL);
    defineModel('collaboration_cell_artifacts', COLLABORATION_CELL_ARTIFACT_MODEL);
    defineModel('collaboration_cell_scenes', COLLABORATION_CELL_SCENE_MODEL);
    defineModel('collaboration_init_sessions', COLLABORATION_INIT_SESSION_MODEL);
    defineModel('collaboration_init_observations', COLLABORATION_INIT_OBSERVATION_MODEL);
    defineModel('collaboration_cell_member_channels', COLLABORATION_CELL_MEMBER_CHANNEL_MODEL);
    logger.debug(
      'AI database models registered (16 tables, + orchestration events + collaboration cells/members/artifacts/scenes/init/channels)',
    );
  } else {
    logger.debug('defineModel not available, AI will use in-memory storage');
  }
}
