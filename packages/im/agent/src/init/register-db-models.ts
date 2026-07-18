/**
 * Define AI-related database models (ADR 0009).
 */
import { getPlugin } from '@zhin.js/core';
import { defineAiDatabaseModels } from './define-ai-database-models.js';

export function registerDbModels(): void {
  const plugin = getPlugin();
  const { logger } = plugin;

  const defineModel = (plugin as unknown as Record<string, unknown>).defineModel as
    | ((name: string, def: Record<string, unknown>) => void)
    | undefined;

  if (typeof defineModel === 'function') {
    const count = defineAiDatabaseModels(defineModel);
    logger.debug(
      `AI database models registered (${count} tables, + orchestration events + collaboration scenes/members/artifacts/aliases/init/channels)`,
    );
  } else {
    logger.debug('defineModel not available, AI will use in-memory storage');
  }
}
