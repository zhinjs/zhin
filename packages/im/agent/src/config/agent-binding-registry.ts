import type { AgentMeta } from '../discovery/agents.js';
import { resolveAgentBinding } from './agent-bindings.js';
import type { AgentBindingConfig, ResolvedAgentBinding } from './types.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './types.js';

export class AgentBindingRegistry {
  private readonly agents: Record<string, AgentBindingConfig>;
  private readonly fileNames: Set<string>;

  constructor(
    agents: Record<string, AgentBindingConfig>,
    fileMetas: AgentMeta[] = [],
  ) {
    this.agents = agents;
    this.fileNames = new Set(fileMetas.map(m => m.name));
  }

  getDiscoveredAgentNames(): Set<string> {
    return new Set(this.fileNames);
  }

  getBinding(name: string): ResolvedAgentBinding | null {
    return resolveAgentBinding(name, this.agents);
  }

  requireZhinBinding(): ResolvedAgentBinding {
    const b = this.getBinding(DEFAULT_ZHIN_AGENT_NAME);
    if (!b) throw new Error(`ai.agents.${DEFAULT_ZHIN_AGENT_NAME} is required`);
    return b;
  }

  /** 非 zhin 的 route 名须在文件中发现 */
  hasAgentFile(name: string): boolean {
    return name === DEFAULT_ZHIN_AGENT_NAME || this.fileNames.has(name);
  }

  listAgentNames(): string[] {
    return Object.keys(this.agents);
  }
}
