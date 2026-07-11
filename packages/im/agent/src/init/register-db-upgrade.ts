/**
 * Upgrade AI components when DB becomes ready (agent_* + im_transcripts).
 */
import './types.js';
import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/ai';
import type { AIServiceRefs } from './shared-refs.js';
import { activateAiDatabaseStorage } from './activate-ai-database-storage.js';
import { wireCollaborationStorage } from '../collaboration/wire-collaboration-storage.js';
import { markAllRuntimesPersistenceReady } from '../collaboration/bootstrap-agent-runtimes.js';
import {
  upgradeAgentSessionTreeData,
  type AgentDbQueryable,
} from './upgrade-agent-db-schema.js';
import { registerEndpointIdColumnMigrationHook } from './upgrade-endpoint-id-schema.js';

type SessionTreeUpgradeResult = Awaited<ReturnType<typeof upgradeAgentSessionTreeData>>;

function logSessionTreeUpgrade(
  logger: { info: (...args: unknown[]) => void; debug: (...args: unknown[]) => void },
  result: SessionTreeUpgradeResult,
): void {
  const changed =
    result.columns.length > 0
    || result.idsBackfilled > 0
    || result.parentLinks > 0
    || result.activeLeaves > 0;
  const summary =
    `AI Session: session tree upgrade checked (columns=${result.columns.length}, ids=${result.idsBackfilled}, parent_links=${result.parentLinks}, active_leaves=${result.activeLeaves})`;
  if (!changed) {
    logger.debug(summary);
    return;
  }
  logger.info(summary);
  if (result.columns.length > 0) {
    logger.info(`AI Session: migrated agent_* columns: ${result.columns.join(', ')}`);
  }
  if (result.idsBackfilled > 0 || result.parentLinks > 0 || result.activeLeaves > 0) {
    logger.info(
      `AI Session: repaired session tree (ids=${result.idsBackfilled}, parent_links=${result.parentLinks}, active_leaves=${result.activeLeaves})`,
    );
  }
}

export function registerDbUpgrade(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  registerEndpointIdColumnMigrationHook(logger);

  useContext('ai', (ai) => {
    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: AIConfig; collaboration?: unknown }>() || {};
    if (appConfig.ai?.sessions?.useDatabase === false) {
      if (refs.zhinAgent) markAllRuntimesPersistenceReady(refs.zhinAgent);
      void wireCollaborationStorage(undefined, appConfig.collaboration);
      return;
    }
    const db = root.inject('database' as const) as
      | { models?: Map<string, unknown> }
      | undefined;
    if (db && refs.zhinAgent) {
      void upgradeAgentSessionTreeData(db as AgentDbQueryable)
        .then(async (result) => {
          logSessionTreeUpgrade(logger, result);
        })
        .then(() => activateAiDatabaseStorage(db, refs, appConfig.ai || {}, appConfig.collaboration))
        .catch((e) => logger.error('AI Session: database setup failed:', e))
        .finally(() => {
          if (refs.zhinAgent) markAllRuntimesPersistenceReady(refs.zhinAgent);
        });
    }
  });

  useContext('database', 'ai', async (db: any, _ai) => {
    try {
      if (!refs.aiService) return;
      const configService = root.inject('config');
      const appConfig =
        configService?.getPrimary<{ ai?: AIConfig; collaboration?: unknown }>() || {};
      const config = appConfig.ai || {};
      if (config.sessions?.useDatabase === false) return;

      const result = await upgradeAgentSessionTreeData(db as AgentDbQueryable);
      logSessionTreeUpgrade(logger, result);
      await activateAiDatabaseStorage(db, refs, config, appConfig.collaboration);
      logger.debug('AI database storage activated (agent_sessions, agent_messages, im_transcripts)');
    } catch (e) {
      logger.error('AI Session: database setup failed:', e);
    } finally {
      if (refs.zhinAgent) markAllRuntimesPersistenceReady(refs.zhinAgent);
    }
  });
}
