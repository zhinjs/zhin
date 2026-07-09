import { type AIProvider, createSdkProviderAdapter } from '@zhin.js/ai';
import type { ProviderInstanceConfig } from './types.js';
export function createProviderInstance(
  alias: string,
  raw: ProviderInstanceConfig,
): AIProvider | null {
  return createSdkProviderAdapter(alias, raw);
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
