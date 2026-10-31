import type {
  Dispose,
  GenerationHandoffParticipant,
  PluginId,
  PluginMetadata,
  PluginLifecycleEventMap,
  Token,
} from '@zhin.js/plugin-runtime';
import type { RuntimeEnvironment } from './environment.js';

export interface IsolatedPluginPrepareRequest {
  readonly owner: PluginId;
  readonly parent: PluginId;
  readonly packageName: string;
  readonly entry: string;
  readonly config: unknown;
  readonly environment: RuntimeEnvironment;
}

export interface IsolatedPluginDescriptor {
  readonly name: string;
  readonly metadata?: PluginMetadata;
}

export interface IsolatedResourceBinding<T = unknown> {
  readonly token: Token<T>;
  readonly value: T;
}

export interface PreparedIsolatedPlugin {
  /** Cooperative control delivery bypasses business admission without reopening it. */
  controlEvent<TName extends keyof PluginLifecycleEventMap>(name: TName, event: PluginLifecycleEventMap[TName]): Promise<void>;
  readonly descriptor: IsolatedPluginDescriptor;
  readonly resources?: readonly IsolatedResourceBinding[];
  readonly handoff?: GenerationHandoffParticipant;
  readonly dispose: Dispose;
}

/** Adapter seam for child Plugin lifecycle that must not execute in the Host realm. */
export interface IsolatedPluginRuntimePort {
  prepare(
    request: IsolatedPluginPrepareRequest,
    signal: AbortSignal,
  ): Promise<PreparedIsolatedPlugin>;
}
