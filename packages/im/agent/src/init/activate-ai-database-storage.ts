/**
 * 将 chat_messages / ai_sessions / ai_summaries 注入 ZhinAgent（可重复调用）。
 */
import type { AIConfig } from '@zhin.js/core';
import { ChatHistoryContext, IMSessionStore } from '@zhin.js/ai';
import type { AIServiceRefs } from './shared-refs.js';

export async function activateAiDatabaseStorage(
  db: any,
  refs: AIServiceRefs,
  config: AIConfig,
): Promise<void> {
  if (!refs.zhinAgent) return;
  if (config.sessions?.useDatabase === false) return;

  const sessionModel = db.models?.get('ai_sessions');
  const chatModel = db.models?.get('chat_messages');
  const sumModel = db.models?.get('ai_summaries');

  if (sessionModel) {
    const imStore = new IMSessionStore(sessionModel, {
      sessionIdleArchiveMs: config.sessions?.sessionIdleArchiveMs,
    });
    refs.zhinAgent.setIMSessionStore(imStore);
  }

  if (chatModel && sumModel) {
    const history = new ChatHistoryContext(chatModel, sumModel, {
      coldStartMaxMessages: config.sessions?.coldStartMaxMessages,
      coldStartMaxAgeMs: config.sessions?.coldStartMaxAgeMs,
    });
    refs.zhinAgent.setChatHistory(history);
  }

  const profileModel = db.models?.get('ai_user_profiles');
  if (profileModel) {
    refs.zhinAgent.upgradeProfilesToDatabase(profileModel);
  }
}
