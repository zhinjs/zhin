/**
 * Define AI-related database models (7 tables).
 */
import { getPlugin } from '@zhin.js/core';
import { AI_SESSION_MODEL } from '../session.js';
import { CHAT_MESSAGE_MODEL, CONTEXT_SUMMARY_MODEL } from '../context-manager.js';
import { AI_MESSAGE_MODEL, AI_SUMMARY_MODEL } from '../conversation-memory.js';
import { AI_USER_PROFILE_MODEL } from '../user-profile.js';
import { AI_FOLLOWUP_MODEL } from '../follow-up.js';

export function registerDbModels(): void {
  const plugin = getPlugin();
  const { logger } = plugin;

  const defineModel = (plugin as unknown as Record<string, unknown>).defineModel as
    | ((name: string, def: Record<string, unknown>) => void)
    | undefined;

  if (typeof defineModel === 'function') {
    defineModel('chat_messages', CHAT_MESSAGE_MODEL);
    defineModel('context_summaries', CONTEXT_SUMMARY_MODEL);
    defineModel('ai_sessions', AI_SESSION_MODEL);
    defineModel('ai_messages', AI_MESSAGE_MODEL);
    defineModel('ai_summaries', AI_SUMMARY_MODEL);
    defineModel('ai_user_profiles', AI_USER_PROFILE_MODEL);
    defineModel('ai_followups', AI_FOLLOWUP_MODEL);
    logger.debug('AI database models registered (7 tables)');
  } else {
    logger.debug('defineModel not available, AI will use in-memory storage');
  }
}
