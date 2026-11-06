import { createToken, projectLocaleToken, resolveLocale, type PluginId, type PrimaryConfig, type RuntimeConfigDocument, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import type { EnvStore } from './environment-store.js';

export type { PrimaryConfig } from '@zhin.js/plugin-runtime';

export const primaryConfigToken = createToken<PrimaryConfig>(
  'zhin.primary-config',
  'Validated Root configuration for the current generation',
);

export function createPrimaryConfig(
  document: RuntimeConfigDocument,
  environment: EnvStore,
  compositionMode: NonNullable<PrimaryConfig['compositionMode']> = 'unknown',
): PrimaryConfig {
  const safeDocument = freezeConfig(structuredClone(document));
  const expanded = freezeConfig(environment.expandMissingAsEmpty(safeDocument));
  return Object.freeze({
    compositionMode,
    document: safeDocument,
    expanded,
    get<T = unknown>(key: string): T | undefined {
      return expanded[key] as T | undefined;
    },
  });
}

/** Copies bindings so retained Scopes never mutate a leased generation's view. */
export function projectPrimaryConfigResources(
  resources: SnapshotState['resources'],
  config: PrimaryConfig,
): Map<PluginId, ReadonlyMap<TokenId, unknown>> {
  return new Map([...resources].map(([owner, bindings]) => [
    owner,
    new Map([...bindings, [primaryConfigToken.id, config], [projectLocaleToken.id, resolveLocale(config.get('locale'))]]),
  ]));
}

function freezeConfig<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeConfig(child);
  return Object.freeze(value);
}
