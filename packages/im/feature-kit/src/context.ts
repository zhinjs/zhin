import {
  bindGenerationAdmission,
  type FeatureId,
  type GenerationAdmissionGate,
  type PluginId,
  type PluginNodeSnapshot,
  type RuntimeSnapshot,
  type Token,
} from '@zhin.js/plugin-runtime';

/** Owner-lifetime resources available while constructing a reusable transport. */
export interface ConstructionContext<TConfig = unknown> {
  readonly signal: AbortSignal;
  readonly owner: PluginNodeSnapshot;
  readonly generation: number;
  readonly config: Readonly<TConfig>;
  use<T>(token: Token<T>): T;
  /**
   * True when `use(token)` would succeed (optional resources such as `aiCompletionToken`).
   * Optional so hand-written contexts stay valid; built-in contexts always provide it.
   * Prefer `hasResource(context, token)` from `zhin.js`, which also works without it.
   */
  has?(token: Token<unknown>): boolean;
}

/** Context for an operation whose caller owns this generation snapshot. */
export interface CapabilityContext<TConfig = unknown> extends ConstructionContext<TConfig> {
  /** Resolve a generation-owned Feature projection from this operation's snapshot. */
  project<T>(feature: FeatureId): T;
}

/** Deliberately excludes operation projections from the actual runtime object. */
export function createConstructionContext<TConfig = unknown>(
  snapshot: RuntimeSnapshot,
  ownerId: PluginId,
  admission?: GenerationAdmissionGate,
  signal: AbortSignal = new AbortController().signal,
): ConstructionContext<TConfig> {
  const owner = snapshot.tree.get(ownerId);
  const resources = snapshot.resources.get(ownerId);
  if (!owner || !resources) throw new Error(`Broken Capability owner: ${ownerId}`);
  return Object.freeze({
    signal,
    owner,
    generation: snapshot.generation,
    config: snapshot.config.get(ownerId) as Readonly<TConfig>,
    use<T>(token: Token<T>): T {
      if (!resources.has(token.id)) {
        throw new Error(`Missing resource ${token.id} for Capability owner ${ownerId}`);
      }
      const value = resources.get(token.id) as T;
      return admission ? bindGenerationAdmission(value, admission) : value;
    },
    has(token: Token<unknown>): boolean {
      return resources.has(token.id);
    },
  });
}

export function createCapabilityContext<TConfig = unknown>(
  snapshot: RuntimeSnapshot,
  ownerId: PluginId,
  admission?: GenerationAdmissionGate,
  signal: AbortSignal = new AbortController().signal,
): CapabilityContext<TConfig> {
  return Object.freeze({
    ...createConstructionContext<TConfig>(snapshot, ownerId, admission, signal),
    project<T>(feature: FeatureId): T {
      if (!snapshot.projections.has(feature)) {
        throw new Error(`Missing Feature projection ${feature}`);
      }
      return snapshot.projections.get(feature) as T;
    },
  });
}
