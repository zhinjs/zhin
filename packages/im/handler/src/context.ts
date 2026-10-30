import type { OperationSession, CapabilityContext } from '@zhin.js/feature-kit';
import type { UserInteraction } from '@zhin.js/interaction';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';

/** Handler context contains only generation-safe capabilities and user interactions. */
export interface HandlerContext<TConfig = unknown, TAdapter extends string | undefined = string | undefined> extends CapabilityContext<TConfig> {
  /** Canonical message operations share their bound view; native events without a message projection have none. */
  readonly session: OperationSession<TAdapter> | undefined;
  readonly interaction?: UserInteraction;
}

export interface HandlerDispatchOptions {
  /** Complete, leased snapshot for this operation rather than provider build order. */
  readonly snapshot?: RuntimeSnapshot;
  /** Build a user interaction for this dispatch (message or side-event). */
  resolveInteraction?: (event: string, args: readonly unknown[], owner: PluginId) => UserInteraction | undefined;
}
