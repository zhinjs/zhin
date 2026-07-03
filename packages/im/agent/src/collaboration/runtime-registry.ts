/**
 * AgentRuntimeRegistry — endpoint-scoped ZhinAgent lookup.
 * Replaces direct refs.zhinAgent for inbound AI turns.
 */

import type { ZhinAgent } from '../zhin-agent/index.js';

export class AgentRuntimeRegistry {
  private defaultRuntime: ZhinAgent | null = null;
  private byEndpoint = new Map<string, ZhinAgent>();

  registerDefault(agent: ZhinAgent): void {
    this.defaultRuntime = agent;
  }

  registerForEndpoint(endpointId: string, agent: ZhinAgent): void {
    this.byEndpoint.set(endpointId, agent);
    if (!this.defaultRuntime) this.defaultRuntime = agent;
  }

  getDefault(): ZhinAgent | null {
    return this.defaultRuntime;
  }

  getForEndpoint(endpointId: string): ZhinAgent | null {
    return this.byEndpoint.get(endpointId) ?? this.defaultRuntime;
  }

  listEndpointIds(): string[] {
    return [...this.byEndpoint.keys()];
  }

  clear(): void {
    this.defaultRuntime = null;
    this.byEndpoint.clear();
  }
}

let globalRegistry: AgentRuntimeRegistry | null = null;

export function getAgentRuntimeRegistry(): AgentRuntimeRegistry {
  if (!globalRegistry) globalRegistry = new AgentRuntimeRegistry();
  return globalRegistry;
}

export function resetAgentRuntimeRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = null;
}
