/**
 * AgentRuntimeRegistry — endpoint-scoped ZhinAgent lookup.
 * Replaces direct refs.zhinAgent for inbound AI turns.
 */

import type { ZhinAgent } from '../zhin-agent/index.js';
import { createGenerationStore, type GenerationStoreContext } from '@zhin.js/plugin-runtime';

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

const runtimeRegistryStore = createGenerationStore<AgentRuntimeRegistry>('zhin.agent.runtime-registry');

let _fallbackRuntimeRegistry: AgentRuntimeRegistry | null = null;
export function getAgentRuntimeRegistry(): AgentRuntimeRegistry {
  return runtimeRegistryStore.tryUse() ?? (_fallbackRuntimeRegistry ??= new AgentRuntimeRegistry());
}

export function provideAgentRuntimeRegistry(context: GenerationStoreContext): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  runtimeRegistryStore.provide(context, registry);
  context.lifecycle.add(() => registry.clear());
  return registry;
}

export function resetAgentRuntimeRegistry(): void {
  const reg = runtimeRegistryStore.tryUse();
  if (reg) reg.clear();
  runtimeRegistryStore.clear();
  if (_fallbackRuntimeRegistry) { _fallbackRuntimeRegistry.clear(); _fallbackRuntimeRegistry = null; }
}
