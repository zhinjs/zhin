import { createToken, projectLocaleToken, resolveLocale, type PluginId, type RuntimeConfigDocument, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import type { EnvStore } from './environment-store.js';

/**
 * Generation-owned, validated Root configuration.
 *
 * `document` deliberately retains environment placeholders for safe display and
 * persistence. Runtime consumers use `expanded`, which is derived exclusively
 * through the Root EnvStore instead of reading process.env themselves.
 */
export interface PrimaryConfig {
  /** Actual Runtime composition branch; absent on older authorities, never inferred from values. */
  readonly compositionMode?: 'document' | 'custom' | 'unknown';
  readonly document: RuntimeConfigDocument;
  readonly expanded: RuntimeConfigDocument;
  get<T = unknown>(key: string): T | undefined;
}

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
