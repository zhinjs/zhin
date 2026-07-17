import type {
  PluginId,
  PluginNodeSnapshot,
  RuntimeSnapshot,
  Token,
} from '@zhin.js/plugin-runtime';

export interface CapabilityContext<TConfig = unknown> {
  readonly owner: PluginNodeSnapshot;
  readonly generation: number;
  readonly config: Readonly<TConfig>;
  use<T>(token: Token<T>): T;
}

export function createCapabilityContext<TConfig = unknown>(
  snapshot: RuntimeSnapshot,
  ownerId: PluginId,
): CapabilityContext<TConfig> {
  const owner = snapshot.tree.get(ownerId);
  const resources = snapshot.resources.get(ownerId);
  if (!owner || !resources) throw new Error(`Broken Capability owner: ${ownerId}`);
  return Object.freeze({
    owner,
    generation: snapshot.generation,
    config: snapshot.config.get(ownerId) as Readonly<TConfig>,
    use<T>(token: Token<T>): T {
      if (!resources.has(token.id)) {
        throw new Error(`Missing resource ${token.id} for Capability owner ${ownerId}`);
      }
      return resources.get(token.id) as T;
    },
  });
}
