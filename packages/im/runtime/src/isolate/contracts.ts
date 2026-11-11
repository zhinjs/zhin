import { createToken, type Dispose, type PluginId } from '@zhin.js/plugin-runtime';

export type IsolatedPluginStatus =
  | 'prepared'
  | 'active'
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

export const isolatedPluginToken = createToken<IsolatedPluginHandle>(
  'zhin.isolated-plugin',
  'Owner-scoped handle for an isolated Plugin instance',
);
