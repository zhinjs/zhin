/**
 * Upgrade AI components when DB becomes ready (agent_* + im_transcripts).
 */
import './types.js';
import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';
import type { AIServiceRefs } from './shared-refs.js';
import { activateAiDatabaseStorage } from './activate-ai-database-storage.js';

export function registerDbUpgrade(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: AIConfig }>() || {};
    if (appConfig.ai?.sessions?.useDatabase === false) {
      refs.zhinAgent?.markMemoryPersistenceReady();
      return;
    }
    const db = root.inject('database' as 'database') as
      | { models?: Map<string, unknown> }
      | undefined;
    if (db && refs.zhinAgent) {
      void activateAiDatabaseStorage(db, refs, appConfig.ai || {})
        .catch((e) => logger.error('AI Session: database setup failed:', e))
        .finally(() => refs.zhinAgent?.markMemoryPersistenceReady());
    }
  });

  useContext('database', 'ai', async (db: any, _ai) => {
    try {
      if (!refs.aiService) return;
      const configService = root.inject('config');
      const appConfig =
        configService?.getPrimary<{ ai?: AIConfig }>() || {};
      const config = appConfig.ai || {};
      if (config.sessions?.useDatabase === false) return;

      await activateAiDatabaseStorage(db, refs, config);
      logger.debug('AI database storage activated (agent_sessions, agent_messages, im_transcripts)');
    } catch (e) {
      logger.error('AI Session: database setup failed:', e);
    } finally {
      refs.zhinAgent?.markMemoryPersistenceReady();
    }
  });
}
