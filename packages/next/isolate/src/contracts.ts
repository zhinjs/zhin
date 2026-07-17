import { createToken, type Dispose, type PluginId } from '@zhin.js/next-kernel';

export type IsolatedPluginStatus =
  | 'prepared'
  | 'active'
  | 'quiesced'
  | 'failed'
  | 'closed';

export interface IsolatedPluginEvent {
  readonly name: string;
  readonly payload: unknown;
}

/** Host-side capability for an isolated Plugin instance. */
export interface IsolatedPluginHandle {
  readonly owner: PluginId;
  readonly status: IsolatedPluginStatus;
  call<TResult = unknown>(method: string, input?: unknown): Promise<TResult>;
  onEvent(listener: (event: IsolatedPluginEvent) => void): Dispose;
}

/** Plugin-side boundary. Imported by isolated Plugin entry modules. */
export interface IsolatedChannel {
  expose(method: string, handler: (input: unknown) => unknown | Promise<unknown>): Dispose;
  call<TResult = unknown>(method: string, input?: unknown): Promise<TResult>;
  emit(name: string, payload?: unknown): void;
}

export const isolatedPluginToken = createToken<IsolatedPluginHandle>(
  'zhin.isolated-plugin',
  'Owner-scoped handle for an isolated Plugin instance',
);

export const isolatedChannelToken = createToken<IsolatedChannel>(
  'zhin.isolate.channel',
  'Structured-clone RPC boundary available inside an isolated Plugin',
);
