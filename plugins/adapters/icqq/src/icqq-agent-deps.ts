import type { Client } from '@icqqjs/icqq';

export interface IcqqAgentEndpoint extends Client {
  readonly endpointName: string;
}

export interface IcqqAgentDeps {
  getEndpoint: (endpointKey: string) => IcqqAgentEndpoint;
  getAdapter?: () => { getEndpoint: (id: string) => IcqqAgentEndpoint };
}

const endpoints = new Map<string, IcqqAgentEndpoint>();
let override: IcqqAgentDeps | null = null;

export function registerIcqqAgentEndpoint(
  endpointKey: string,
  endpoint: IcqqAgentEndpoint,
): () => void {
  endpoints.set(endpointKey, endpoint);
  return () => {
    if (endpoints.get(endpointKey) === endpoint) {
      endpoints.delete(endpointKey);
    }
  };
}

export function setIcqqAgentDeps(deps: IcqqAgentDeps | null): void {
  override = deps;
}

function lookup(endpointKey: string): IcqqAgentEndpoint {
  const registered = endpoints.get(endpointKey);
  if (!registered) throw new Error(`Endpoint ${endpointKey} 不存在`);
  return registered;
}

export function getIcqqAgentDeps(): IcqqAgentDeps {
  if (override) return override;
  return {
    getEndpoint: lookup,
    getAdapter: () => ({ getEndpoint: lookup }),
  };
}
