/**
 * Agent tool deps for icqq.
 * Endpoints register themselves on start; tools look up by config name / QQ uin.
 */

import type { IpcClient } from './ipc-client.js';
import type { IpcFriendInfo, IpcGroupInfo } from './types.js';
import type { IpcResponse } from './protocol.js';

export interface IcqqAgentEndpoint {
  readonly name: string;
  readonly ipc: {
    request(action: string, params?: Record<string, unknown>): Promise<IpcResponse>;
  };
  readonly friends: Map<number, IpcFriendInfo>;
  readonly groups: Map<number, IpcGroupInfo>;
  request(action: string, params?: Record<string, unknown>): Promise<IpcResponse>;
}

export interface IcqqAgentDeps {
  getEndpoint: (endpointId: string) => IcqqAgentEndpoint;
  getAdapter?: () => { getEndpoint: (id: string) => IcqqAgentEndpoint };
}

const endpoints = new Map<string, IcqqAgentEndpoint>();
let override: IcqqAgentDeps | null = null;

export function registerIcqqAgentEndpoint(
  endpointId: string,
  endpoint: IcqqAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setIcqqAgentDeps(deps: IcqqAgentDeps | null): void {
  override = deps;
}

function lookup(endpointId: string): IcqqAgentEndpoint {
  const registered = endpoints.get(endpointId);
  if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
  return registered;
}

export function getIcqqAgentDeps(): IcqqAgentDeps {
  if (override) return override;
  return {
    getEndpoint: lookup,
    getAdapter: () => ({ getEndpoint: lookup }),
  };
}
