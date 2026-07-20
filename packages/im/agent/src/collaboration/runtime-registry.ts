/**
 * AgentRuntimeRegistry — endpoint-scoped ZhinAgent lookup.
 * Replaces direct refs.zhinAgent for inbound AI turns.
 */

import type { ZhinAgent } from '../zhin-agent/index.js';

export class AgentRuntimeRegistry {
  private defaultRuntimes: ZhinAgent[] = [];
  private byEndpoint = new Map<string, ZhinAgent>();

  registerDefault(agent: ZhinAgent): () => void {
    this.defaultRuntimes.push(agent);
    return () => {
      const index = this.defaultRuntimes.lastIndexOf(agent);
      if (index >= 0) this.defaultRuntimes.splice(index, 1);
    };
  }

  registerForEndpoint(endpointId: string, agent: ZhinAgent): void {
    this.byEndpoint.set(endpointId, agent);
    if (this.defaultRuntimes.length === 0) this.defaultRuntimes.push(agent);
  }

  getDefault(): ZhinAgent | null {
    return this.defaultRuntimes[this.defaultRuntimes.length - 1] ?? null;
  }

  getForEndpoint(endpointId: string): ZhinAgent | null {
    return this.byEndpoint.get(endpointId) ?? this.getDefault();
  }

  listEndpointIds(): string[] {
    return [...this.byEndpoint.keys()];
  }

  clear(): void {
    this.defaultRuntimes = [];
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
