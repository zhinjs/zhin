import type { AIProvider, ProviderConfig } from '@zhin.js/core';
import type { CloudflareConfig, OllamaProviderConfig } from '@zhin.js/ai';
import {
  AnthropicProvider,
  CloudflareProvider,
  DeepSeekProvider,
  MoonshotProvider,
  OllamaProvider,
  OpenAIProvider,
  ZhipuProvider,
  GoogleProvider,
} from '@zhin.js/core';
import type { ProviderInstanceConfig } from './types.js';

type ProviderFactory = new (config: ProviderConfig) => AIProvider;

const DRIVER_FACTORIES: Record<
  string,
  { factory: ProviderFactory; requireApiKey: boolean }
> = {
  openai: { factory: OpenAIProvider as ProviderFactory, requireApiKey: true },
  anthropic: { factory: AnthropicProvider as ProviderFactory, requireApiKey: true },
  deepseek: { factory: DeepSeekProvider as ProviderFactory, requireApiKey: true },
  moonshot: { factory: MoonshotProvider as ProviderFactory, requireApiKey: true },
  zhipu: { factory: ZhipuProvider as ProviderFactory, requireApiKey: true },
  google: { factory: GoogleProvider as ProviderFactory, requireApiKey: true },
  gemini: { factory: GoogleProvider as ProviderFactory, requireApiKey: true },
  ollama: { factory: OllamaProvider as ProviderFactory, requireApiKey: false },
};

export function createProviderInstance(
  alias: string,
  raw: ProviderInstanceConfig,
): AIProvider | null {
  const driver = raw.driver?.trim().toLowerCase();
  if (!driver) return null;

  const { driver: _d, ...rest } = raw;

  if (driver === 'cloudflare') {
    const cfg = rest as CloudflareConfig;
    if (!cfg.apiKey || !cfg.accountId) return null;
    const provider = new CloudflareProvider(cfg);
    (provider as AIProvider & { name: string }).name = alias;
    return provider;
  }

  const entry = DRIVER_FACTORIES[driver];
  if (!entry) return null;

  const cfg = { ...rest } as ProviderConfig & OllamaProviderConfig;
  if (entry.requireApiKey && !cfg.apiKey) return null;

  const provider = new entry.factory(cfg);
  (provider as AIProvider & { name: string }).name = alias;
  return provider;
}

export function registerProviderInstances(
  providers: Record<string, ProviderInstanceConfig> | undefined,
): Map<string, AIProvider> {
  const map = new Map<string, AIProvider>();
  if (!providers) return map;
  for (const [alias, cfg] of Object.entries(providers)) {
    const p = createProviderInstance(alias, cfg);
    if (p) map.set(alias, p);
  }
  return map;
}
