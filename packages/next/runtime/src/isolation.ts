import type {
  Dispose,
  GenerationHandoffParticipant,
  PluginId,
  PluginMetadata,
  Token,
} from '@zhin.js/next-kernel';
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
  readonly descriptor: IsolatedPluginDescriptor;
  readonly resources?: readonly IsolatedResourceBinding[];
  readonly handoff?: GenerationHandoffParticipant;
  readonly dispose: Dispose;
}

/** Adapter seam for child Plugin lifecycle that must not execute in the Host realm. */
export interface IsolatedPluginRuntimePort {
  prepare(request: IsolatedPluginPrepareRequest): Promise<PreparedIsolatedPlugin>;
}
