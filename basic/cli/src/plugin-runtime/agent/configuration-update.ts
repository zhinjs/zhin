import { modelRuntimeBaselineToken, validateModelRuntimeConfig, type ModelRuntimeConfig } from '@zhin.js/agent/model-runtime';
import { ConfigValidationError, expandEnvironmentValue, type RootConfigUpdateHandler } from '@zhin.js/runtime';
import type { Token } from '@zhin.js/plugin-runtime';
import { hostModelOwnerId } from '../personal-models/host-identity.js';
import { isDeepStrictEqual } from 'node:util';

/** One model dependency group; unrelated AI authority remains on its existing lifecycle. */
export function createModelConfigurationUpdateHandler(initialConfig: ModelRuntimeConfig, projectRoot: string): RootConfigUpdateHandler {
  const paths: readonly (readonly string[])[] = Object.freeze([
    ['ai', 'providers'], ['ai', 'modelCatalog'], ['ai', 'modelPolicy'],
    ...Object.keys(initialConfig.agents ?? {}).flatMap(name => ['provider', 'model', 'preset'].map(field => ['ai', 'agents', name, field])),
  ].map(path => Object.freeze(path)));
  const environmentReferences = (document: Readonly<Record<string, unknown>>, expanded: ModelRuntimeConfig,
    hasValue: (name: string) => boolean) => {
    const references = new Set<string>();
    const missing = new Set<string>();
    // Use the canonical interpolation parser, including explicit fallback syntax.
    // Marker values reveal only presence; credentials are never collected here.
    const owned = paths.map(path => path.reduce<unknown>((value, key) => value && typeof value === 'object'
      && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, document));
    expandEnvironmentValue(owned, name => { references.add(name); return hasValue(name) ? 'present' : undefined; },
      name => { missing.add(name); return ''; });
    for (const connection of Object.values(expanded.modelCatalog?.connections ?? {})) {
      if (typeof connection.secretRef !== 'string') continue;
      const key = /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(connection.secretRef)?.[1];
      if (!key) continue;
      references.add(key);
      if (!hasValue(key)) missing.add(key);
    }
    return { references, missing };
  };
  return Object.freeze({
    id: 'agent-models', paths,
    validate: ({ next, expand, hasEnvironmentValue, signal }: Parameters<NonNullable<RootConfigUpdateHandler['validate']>>[0]) => {
      signal.throwIfAborted();
      const config = expand(next.ai) as ModelRuntimeConfig | undefined;
      if (config == null || (config as { enabled?: boolean }).enabled === false) return;
      const { missing } = environmentReferences(next, config, hasEnvironmentValue);
      if (missing.size) throw new ConfigValidationError([`AI model environment references are unavailable: ${[...missing].sort().join(', ')}`]);
      const errors = validateModelRuntimeConfig(config, hostModelOwnerId(projectRoot));
      if (errors.length) throw new ConfigValidationError(errors);
    },
    prepare: async ({ readRootResource, previous, next, desired, signal, expand, hasEnvironmentValue, environmentValueIsCurrent }: Parameters<RootConfigUpdateHandler['prepare']>[0]) => {
      signal.throwIfAborted();
      const runtime = readRootResource(modelRuntimeBaselineToken);
      if (!runtime) return undefined;
      const intended = desired.ai as (ModelRuntimeConfig & { enabled?: boolean }) | undefined;
      if (intended == null || intended.enabled === false) return Object.freeze({ effect: 'restart-process' as const,
        reasonCode: 'agent-installation-changed' });
      const before = previous.ai as ModelRuntimeConfig | undefined;
      if (!isDeepStrictEqual(Object.keys(before?.agents ?? {}).sort(), Object.keys(intended.agents ?? {}).sort())) {
        return Object.freeze({ effect: 'restart-process' as const, reasonCode: 'model-binding-topology-changed' });
      }
      const config = expand(next.ai) as ModelRuntimeConfig | undefined;
      if (config == null || (config as { enabled?: boolean }).enabled === false) return Object.freeze({ effect: 'restart-process' as const,
        reasonCode: 'agent-installation-changed' });
      const { references, missing } = environmentReferences(next, config, hasEnvironmentValue);
      if (missing.size || [...references].some(name => !environmentValueIsCurrent(name))) return Object.freeze({
        effect: 'restart-process' as const, reasonCode: 'model-environment-pending',
      });
      const update = runtime.prepareConfiguration(config);
      if (update.kind !== 'ready') return Object.freeze({ effect: 'restart-process' as const,
        reasonCode: `model-update:${update.reasons.join(',')}` });
      return Object.freeze({ effect: 'replace-resource' as const,
        rootResources: new Map<Token<unknown>, unknown>([[modelRuntimeBaselineToken, update.runtime]]) });
    },
  });
}
