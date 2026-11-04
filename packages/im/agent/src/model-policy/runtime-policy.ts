import { compileModelPolicy, modelPolicyEndpointAddressKey, modelPolicySceneAddressKey, type CompiledModelPolicy } from './policy.js';
import { ModelPolicyValidationError, type ModelPolicyConfig } from './types.js';

/** A complete persisted override snapshot. Absence of a field restores the static baseline. */
export type RuntimePolicyRefsOverride = Omit<ModelPolicyConfig, 'defaults'> & { readonly defaults?: ModelPolicyConfig['defaults'] };
export interface RuntimePolicySnapshot {
  readonly revision: number;
  readonly refsOverride: ModelPolicyConfig;
}
export type RuntimePolicyWriteResult =
  | Readonly<{ kind: 'updated'; snapshot: RuntimePolicySnapshot }>
  | Readonly<{ kind: 'conflict'; actualRevision?: number }>;
export interface RuntimePolicyRepository {
  read(): Promise<RuntimePolicySnapshot>;
  compareExchange(expectedRevision: number, refsOverride: RuntimePolicyRefsOverride): Promise<RuntimePolicyWriteResult>;
}
export class RuntimePolicyStateError extends Error {
  constructor(readonly code: 'unavailable' | 'integrity' | 'commit_unknown') {
    super(`Runtime model policy: ${code}`);
    this.name = 'RuntimePolicyStateError';
  }
}

/** Reuses the single purpose/scope allowlist and canonical address validation. */
export function normalizeRuntimePolicyRefsOverride(input: unknown): ModelPolicyConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new ModelPolicyValidationError('$', 'expected an object');
  }
  return compileModelPolicy({ defaults: {}, ...Object.fromEntries(Reflect.ownKeys(input).map(key => [key, Reflect.get(input, key)])) }).config;
}
/** Host address integrity is independent of whether a referenced preset still exists. */
export function runtimePolicyBelongsToRoot(refs: ModelPolicyConfig, rootId: string): boolean {
  return [...refs.endpoints ?? [], ...refs.scenes ?? []].every(entry => entry.address.rootId === rootId);
}

function mergeEntries<T extends { readonly address: unknown; readonly models: object }>(
  base: readonly T[] | undefined, override: readonly T[] | undefined, key: (address: T['address']) => string,
): readonly T[] | undefined {
  if (base === undefined && override === undefined) return undefined;
  const entries = new Map((base ?? []).map(entry => [key(entry.address), entry]));
  for (const entry of override ?? []) {
    const previous = entries.get(key(entry.address));
    entries.set(key(entry.address), { ...entry, models: { ...previous?.models, ...entry.models } });
  }
  return [...entries.values()];
}

/** Derived only in memory; the merged policy is never another persistence authority. */
export function compileRuntimePolicyRefsOverride(
  baseline: ModelPolicyConfig, override: ModelPolicyConfig, summaryInheritsChat: boolean,
): CompiledModelPolicy {
  const defaults = { ...baseline.defaults, ...override.defaults };
  if (summaryInheritsChat && override.defaults.summary === undefined) defaults.summary = defaults.chat;
  const adapters = baseline.adapters === undefined && override.adapters === undefined ? undefined
    : Object.fromEntries([...new Set([...Object.keys(baseline.adapters ?? {}), ...Object.keys(override.adapters ?? {})])]
      .map(key => [key, { ...baseline.adapters?.[key], ...override.adapters?.[key] }]));
  const endpoints = mergeEntries(baseline.endpoints, override.endpoints, modelPolicyEndpointAddressKey);
  const scenes = mergeEntries(baseline.scenes, override.scenes, modelPolicySceneAddressKey);
  return compileModelPolicy({ defaults, ...(adapters ? { adapters } : {}),
    ...(endpoints ? { endpoints } : {}), ...(scenes ? { scenes } : {}) });
}
