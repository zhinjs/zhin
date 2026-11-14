import type { AgentMeta } from '../discovery/agents.js';
import { resolveAgentBinding } from './agent-bindings.js';
import { type AgentBindingConfig, type ResolvedAgentBinding, DEFAULT_ZHIN_AGENT_NAME } from './types.js';
export class AgentBindingRegistry {
  private readonly agents: Record<string, AgentBindingConfig>;
  private readonly fileNames: Set<string>;
  private readonly configured: Set<string>;

  constructor(
    agents: Record<string, AgentBindingConfig>,
    fileMetas: AgentMeta[] = [],
  ) {
    this.agents = { ...Object.fromEntries(fileMetas.map(meta => [meta.name, {}])), ...agents };
    this.fileNames = new Set(fileMetas.map(m => m.name));
    this.configured = new Set(Object.keys(agents));
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

  /**
   * Bindings configured under `ai.agents` (`zhin` included), without names only
   * discovered from `agents/<name>/` files: those directories are plugin
   * sub-agents too, and their `purposes.agents` keys must stay usable for them
   * (#1250 sub-agent purposes). Configured names are the binding keys the
   * legacy migration writes into `purposes.agents`.
   */
  listConfiguredBindingNames(): string[] {
    return Object.keys(this.agents).filter(name => !this.fileNames.has(name) || this.configured.has(name));
  }
}
