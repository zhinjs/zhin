import { createSdkProviderAdapter, type SdkProviderAdapter } from '@zhin.js/ai';
import type { ProviderInstanceConfig } from './types.js';
export function createProviderInstance(
  alias: string,
  raw: ProviderInstanceConfig,
): SdkProviderAdapter | null {
  return createSdkProviderAdapter(alias, raw);
}

export function registerProviderInstances(
  providers: Record<string, ProviderInstanceConfig> | undefined,
): Map<string, SdkProviderAdapter> {
  const map = new Map<string, SdkProviderAdapter>();
  if (!providers) return map;
  for (const [alias, cfg] of Object.entries(providers)) {
    const p = createProviderInstance(alias, cfg);
    if (p) map.set(alias, p);
  }
  return map;
}
