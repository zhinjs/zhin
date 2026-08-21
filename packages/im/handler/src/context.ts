import type { CapabilityContext } from '@zhin.js/feature-kit';
import type { UserInteraction } from '@zhin.js/interaction';

/** Handler context contains only generation-safe capabilities and user interactions. */
export interface HandlerContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly interaction?: UserInteraction;
}

export interface HandlerDispatchOptions {
  /** Build a user interaction for this dispatch (message or side-event). */
  resolveInteraction?: (event: string, args: readonly unknown[]) => UserInteraction | undefined;
}
