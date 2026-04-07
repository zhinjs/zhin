/**
 * Upgrade AI components from in-memory to database storage when DB becomes ready.
 *
 * FIX: Replaced the previous `setTimeout(100)` race condition with
 * a proper `useContext('database', 'ai', ...)` dual-dependency wait.
 */
import './types.js';
import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';
import { createDatabaseSessionManager } from '@zhin.js/ai';
import { createContextManager } from '@zhin.js/ai';
import type { AIServiceRefs } from './shared-refs.js';

export function registerDbUpgrade(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('database', 'ai', async (db: any, _ai) => {
    const aiService = refs.aiService;
    if (!aiService) return;

    const configService = root.inject('config');
    const appConfig =
      configService?.getPrimary<{ ai?: AIConfig }>() || {};
    const config = appConfig.ai || {};

    if (config.sessions?.useDatabase === false) return;

    try {
      const model = db.models?.get('ai_sessions');
      if (!model) return;

      const dbSession = createDatabaseSessionManager(
        model,
        aiService.getSessionConfig(),
      );
      aiService.setSessionManager(dbSession);
      if (refs.zhinAgent) refs.zhinAgent.setSessionManager(dbSession);

      const ctxCfg = aiService.getContextConfig();
      if (ctxCfg.enabled !== false) {
        const msgModel = db.models.get('chat_messages');
        const sumModel = db.models.get('context_summaries');
        if (msgModel && sumModel) {
          const ctxMgr = createContextManager(msgModel, sumModel, ctxCfg);
          aiService.setContextManager(ctxMgr);
          if (refs.zhinAgent) refs.zhinAgent.setContextManager(ctxMgr);
        }
      }

      if (refs.zhinAgent) {
        const aiMsgModel = db.models.get('ai_messages');
        const aiSumModel = db.models.get('ai_summaries');
        if (aiMsgModel && aiSumModel) {
          refs.zhinAgent.upgradeMemoryToDatabase(aiMsgModel, aiSumModel);
        }

        const profileModel = db.models.get('ai_user_profiles');
        if (profileModel) {
          refs.zhinAgent.upgradeProfilesToDatabase(profileModel);
        }
      }

      logger.debug('AI database storage activated (session, memory, profile)');
    } catch (e) {
      logger.error('AI Session: database setup failed:', e);
    }
  });
}
