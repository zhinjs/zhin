import type { Dispose } from './dispose.js';
import type { CapabilityId, PluginId } from './identity.js';

/** Planned invalidation is distinct from the instances actually replaced at commit. */
export interface HmrReloadScope {
  readonly fullRoot: boolean;
  readonly plugins: readonly PluginId[];
  readonly capabilities: readonly CapabilityId[];
}
export interface HmrEventDetails {
  readonly trigger: 'manual' | 'source';
  readonly changed: readonly string[];
  readonly planned: HmrReloadScope;
  readonly previousGeneration: number;
  readonly activeGeneration: number;
  readonly receiver: Readonly<{
    owner: PluginId;
    creationGeneration: number;
    state: 'current' | 'replaced';
  }>;
}
export type HmrOutcome = 'committed' | 'unchanged' | 'rejected' | 'cancelled' | 'restart-required';
export interface HmrResumeDetails extends HmrEventDetails {
  readonly outcome: HmrOutcome;
  readonly reason?: 'root-stopping';
  readonly replaced: readonly PluginId[];
}
/** A control-phase signal, not a command to cancel the plugin's accepted business work. */
export interface PluginLifecycleEvent<TDetails> {
  readonly signal: AbortSignal;
  readonly details: Readonly<TDetails>;
}
export interface PluginLifecycleEventMap {
  readonly 'hmr.pause': PluginLifecycleEvent<HmrEventDetails>;
  readonly 'hmr.resume': PluginLifecycleEvent<HmrResumeDetails>;
}
export interface PluginEventSubscriptions {
  /** Subscription belongs to this concrete plugin instance, including when its Scope is reused. */
  on<TName extends keyof PluginLifecycleEventMap>(
    name: TName,
    handler: (event: PluginLifecycleEventMap[TName]) => void | Promise<void>,
  ): Dispose;
}
/** @internal Runtime delivery authority; never exposed through a setup context or resource snapshot. */
export interface PluginEventChannel {
  readonly events: PluginEventSubscriptions;
  dispatch<TName extends keyof PluginLifecycleEventMap>(name: TName, event: PluginLifecycleEventMap[TName]): Promise<void>;
  dispose(): void;
}

/** @internal One instance-owned subscription record; no inherited or process-wide listener registry. */
export function createPluginEventChannel(): PluginEventChannel {
  const handlers: { [TName in keyof PluginLifecycleEventMap]: Set<(event: PluginLifecycleEventMap[TName]) => void | Promise<void>> } = {
    'hmr.pause': new Set(), 'hmr.resume': new Set(),
  };
  let disposed = false;
  return Object.freeze<PluginEventChannel>({
    events: Object.freeze<PluginEventSubscriptions>({
      on(name, handler) {
        if (disposed) throw new Error('Plugin event subscriptions are disposed');
        handlers[name].add(handler);
        return () => { handlers[name].delete(handler); };
      },
    }),
    async dispatch(name, event) {
      if (disposed) throw new Error('Plugin event subscriptions are disposed');
      const results = await Promise.allSettled([...handlers[name]].map(handler => Promise.resolve().then(() => handler(event))));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, `Plugin ${name} handlers failed`);
    },
    dispose() {
      disposed = true;
      handlers['hmr.pause'].clear(); handlers['hmr.resume'].clear();
    },
  });
}
