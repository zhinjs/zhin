/**
 * Register AIService as a plugin context.
 */
import './types.js';
import { formatCompact, getPlugin, type Plugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';
import { AIService } from '../service.js';
import type { AIServiceRefs } from './shared-refs.js';

export function registerAIService(refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { provide, root, logger } = plugin;

  provide<'ai'>({
    name: 'ai',
    description: 'AI Service - Multi-model LLM integration',
    async mounted(_p: Plugin) {
      const configService = root.inject('config');
      const appConfig =
        configService?.getPrimary<{ ai?: AIConfig }>() || {};
      const config = appConfig.ai || {};

      if (config.enabled === false) {
        logger.info(formatCompact( { disabled: true }));
        return undefined as unknown as AIService;
      }

      const service = new AIService(config);
      refs.aiService = service;
      service.setPlugin(root);

      const providers = service.listProviders();
      if (providers.length === 0) {
        logger.warn(formatCompact( { error: 'no_providers' }));
      } else {
        logger.debug(formatCompact({ providers: providers.join(',') }));
      }

      return service;
    },
    async dispose(service) {
      if (service) {
        service.dispose();
        refs.aiService = null;
        logger.debug(formatCompact( { stopped: true }));
      }
    },
  });
}
