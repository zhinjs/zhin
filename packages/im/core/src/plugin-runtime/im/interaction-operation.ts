import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

/** Core-only trusted operation binding; never read from message metadata. */
export const interactionOperationScope = Symbol('InteractionOperationScope');
export interface InteractionOperationScope {
  readonly snapshot: RuntimeSnapshot;
  readonly owner: PluginId;
  readonly retirementSignal?: AbortSignal;
}
