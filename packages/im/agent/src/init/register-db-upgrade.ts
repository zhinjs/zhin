/**
 * Upgrade AI components when DB becomes ready (agent_* + im_transcripts).
 */
import './types.js';
import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';
import type { AIServiceRefs } from './shared-refs.js';
import { activateAiDatabaseStorage } from './activate-ai-database-storage.js';
import {
  upgradeAgentSessionTreeData,
  type AgentDbQueryable,
} from './upgrade-agent-db-schema.js';
import { registerEndpointIdColumnMigrationHook } from './upgrade-endpoint-id-schema.js';

export function registerDbUpgrade(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  registerEndpointIdColumnMigrationHook(logger);

  useContext('ai', (ai) => {
    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: AIConfig }>() || {};
    if (appConfig.ai?.sessions?.useDatabase === false) {
      refs.zhinAgent?.markMemoryPersistenceReady();
      return;
    }
    const db = root.inject('database' as const) as
      | { models?: Map<string, unknown> }
      | undefined;
    if (db && refs.zhinAgent) {
      void upgradeAgentSessionTreeData(db as AgentDbQueryable)
        .then((result) => {
          logger.info(
            `AI Session: session tree upgrade checked (columns=${result.columns.length}, ids=${result.idsBackfilled}, parent_links=${result.parentLinks}, active_leaves=${result.activeLeaves})`,
          );
          if (result.columns.length > 0) {
            logger.info(`AI Session: migrated agent_* columns: ${result.columns.join(', ')}`);
          }
          if (result.idsBackfilled > 0 || result.parentLinks > 0 || result.activeLeaves > 0) {
            logger.info(
              `AI Session: repaired session tree (ids=${result.idsBackfilled}, parent_links=${result.parentLinks}, active_leaves=${result.activeLeaves})`,
            );
          }
        })
        .then(() => activateAiDatabaseStorage(db, refs, appConfig.ai || {}))
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

      const result = await upgradeAgentSessionTreeData(db as AgentDbQueryable);
      logger.info(
        `AI Session: session tree upgrade checked (columns=${result.columns.length}, ids=${result.idsBackfilled}, parent_links=${result.parentLinks}, active_leaves=${result.activeLeaves})`,
      );
      if (result.columns.length > 0) {
        logger.info(`AI Session: migrated agent_* columns: ${result.columns.join(', ')}`);
      }
      if (result.idsBackfilled > 0 || result.parentLinks > 0 || result.activeLeaves > 0) {
        logger.info(
          `AI Session: repaired session tree (ids=${result.idsBackfilled}, parent_links=${result.parentLinks}, active_leaves=${result.activeLeaves})`,
        );
      }
      await activateAiDatabaseStorage(db, refs, config);
      logger.debug('AI database storage activated (agent_sessions, agent_messages, im_transcripts)');
    } catch (e) {
      logger.error('AI Session: database setup failed:', e);
    } finally {
      refs.zhinAgent?.markMemoryPersistenceReady();
    }
  });
}
