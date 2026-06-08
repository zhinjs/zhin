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
  MEMORY_ENTRY_MODEL,
} from '@zhin.js/ai';
import { AI_USER_PROFILE_MODEL } from '../user-profile.js';

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
    defineModel('memory_entries', MEMORY_ENTRY_MODEL);
    logger.debug('AI database models registered (8 tables, ADR 0009 + orchestration + semantic memory)');
  } else {
    logger.debug('defineModel not available, AI will use in-memory storage');
  }
}
