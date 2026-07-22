import { createToken } from '@zhin.js/plugin-runtime';
import type { EnvStore } from './environment-store.js';
import type { RuntimeConfigDocument } from './config-composer.js';

/**
 * Generation-owned, validated Root configuration.
 *
 * `document` deliberately retains environment placeholders for safe display and
 * persistence. Runtime consumers use `expanded`, which is derived exclusively
 * through the Root EnvStore instead of reading process.env themselves.
 */
export interface PrimaryConfig {
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
): PrimaryConfig {
  const safeDocument = freezeConfig(structuredClone(document));
  const expanded = freezeConfig(environment.expandMissingAsEmpty(safeDocument));
  return Object.freeze({
    document: safeDocument,
    expanded,
    get<T = unknown>(key: string): T | undefined {
      return expanded[key] as T | undefined;
    },
  });
}

function freezeConfig<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeConfig(child);
  return Object.freeze(value);
}
