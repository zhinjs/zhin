/**
 * Register AIService as a plugin context.
 */
import './types.js';
import { getPlugin, type Plugin } from '@zhin.js/core';
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
        logger.info('AI Service is disabled');
        return undefined as unknown as AIService;
      }

      const service = new AIService(config);
      refs.aiService = service;
      service.setPlugin(root);

      const providers = service.listProviders();
      if (providers.length === 0) {
        logger.warn(
          'No AI providers configured. Please add API keys in zhin.config (yml/json/toml)',
        );
      } else {
        logger.info(
          `AI Service started with providers: ${providers.join(', ')}`,
        );
      }

      return service;
    },
    async dispose(service) {
      if (service) {
        service.dispose();
        refs.aiService = null;
        logger.info('AI Service stopped');
      }
    },
  });
}
