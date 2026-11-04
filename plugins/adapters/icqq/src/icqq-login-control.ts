/**
 * ICQQ login control surface exposed to the Plugin Runtime, Console and the
 * recovery command. Controls are projected from actual current incarnations in
 * the owning IcqqAdapter; no plugin resource keeps a second Endpoint directory.
 */
import { adapterFeatureId, isAdapterIndex } from 'zhin.js/adapter';
import type { FeatureId, PluginId } from 'zhin.js';
import { IcqqAdapter } from './adapter.js';
import type { PendingLoginTask } from '@zhin.js/core';

export interface IcqqLoginControlState {
  readonly endpointId: string;
  readonly transportState: string;
  readonly online: boolean;
  readonly pending: readonly PendingLoginTask[];
}

export interface IcqqLoginControl {
  readonly endpointId: string;
  state(): IcqqLoginControlState;
  pending(): readonly PendingLoginTask[];
  /** Force a login attempt; rejects when the endpoint is stopped or the SDK login fails. */
  relogin(): Promise<void>;
  submit(taskId: string, value: string | Record<string, unknown>): boolean;
  cancel(taskId: string, reason?: string): boolean;
}

/** Read the owning Adapter's actual incarnations; this projection retains no independent directory. */
export function icqqLoginControls(context: Readonly<{ owner: PluginId | Readonly<{ id: PluginId }>; project<T>(id: FeatureId): T }>): ReadonlyMap<string, IcqqLoginControl> {
  const index = context.project<unknown>(adapterFeatureId);
  if (!isAdapterIndex(index)) throw new Error('ICQQ Adapter projection is unavailable');
  const owner = typeof context.owner === 'string' ? context.owner : context.owner.id;
  const controls = new Map<string, IcqqLoginControl>();
  for (const adapter of index.forOwner(owner).adapters()) {
    if (!(adapter instanceof IcqqAdapter)) continue;
    for (const row of adapter.list()) {
      const endpoint = adapter.getEndpoint(row.instanceId);
      if (endpoint) controls.set(row.endpointId, endpoint.loginControl);
    }
  }
  return controls;
}
