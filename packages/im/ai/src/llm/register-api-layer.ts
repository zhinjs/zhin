import type { AIProvider, ProviderConfig } from '../types.js';
import type { ProviderInstanceConfig } from './types/model.js';
import {
  registerApiProvider,
  registerProviderInstance,
  clearApiRegistryForTests,
  setLegacyProviderResolver as wireLegacyProviderResolver,
  getLegacyProviderResolver,
} from './api-registry.js';
import {
  createOpenAiCompletionsStreamFn,
} from './providers/openai-completions.js';

export interface LegacyProviderEntry {
  alias: string;
  provider: AIProvider;
  config: ProviderConfig & { api?: string };
  models: string[];
}

const registeredApis = new Set<string>();

export function setLegacyProviderResolver(
  resolver: (alias: string) => AIProvider | undefined,
): void {
  wireLegacyProviderResolver(resolver);
}

/**
 * Register LLM API providers from legacy {@link AIProvider} instances.
 * Wires OpenAI-completions stream bridge + provider instance registry.
 */
export function registerLlmApiFromProviders(
  entries: LegacyProviderEntry[],
  resolveProvider: (alias: string) => AIProvider | undefined,
): void {
  setLegacyProviderResolver(resolveProvider);

  for (const entry of entries) {
    const api = entry.config.api?.trim() || 'openai-completions';

    if (!registeredApis.has(api)) {
      registeredApis.add(api);
      const streamFn = createOpenAiCompletionsStreamFn(() => getLegacyProviderResolver());
      registerApiProvider({ api, stream: streamFn, streamSimple: streamFn });
    }

    const instanceConfig: ProviderInstanceConfig = {
      api,
      apiKey: entry.config.apiKey,
      authScheme: entry.config.authScheme,
      baseUrl: entry.config.baseUrl,
      headers: entry.config.headers,
      timeout: entry.config.timeout,
      maxRetries: entry.config.maxRetries,
      accountId: (entry.config as { accountId?: string }).accountId,
      host: (entry.config as { host?: string }).host,
    };
    registerProviderInstance(entry.alias, instanceConfig, entry.models);
  }
}

/** @internal test helper */
export function resetLlmApiRegistryForTests(): void {
  registeredApis.clear();
  clearApiRegistryForTests();
}
