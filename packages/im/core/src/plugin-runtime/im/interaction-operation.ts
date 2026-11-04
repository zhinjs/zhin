import type { CapturedEndpointOperation } from './captured-endpoint-operation.js';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

/** Core-only trusted operation binding; never read from message metadata. */
export const interactionOperationScope = Symbol('InteractionOperationScope');
export interface InteractionOperationScope {
  readonly snapshot: RuntimeSnapshot;
  readonly owner: PluginId;
  /** Explicit stop/source/caller lifetime; not an HMR replacement notification. */
  readonly signal?: AbortSignal;
  /** Pin one actual source Client and independently owned snapshot until the question settles. */
  readonly retain?: () => CapturedEndpointOperation;
}
