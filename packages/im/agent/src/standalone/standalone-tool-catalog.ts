import type { AgentTool } from '@zhin.js/ai';

export interface ResolveStandaloneToolsOptions {
  readonly includeRegisteredTools: boolean;
  readonly explicitTools: readonly AgentTool[];
}

/** Owns the explicit Tool namespace used by programmatic standalone Agents. */
export class StandaloneToolCatalog {
  readonly #tools = new Map<string, AgentTool>();

  register(tool: AgentTool): () => void {
    assertCanonicalToolName(tool.name);
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered on this AIService`);
    }
    this.#tools.set(tool.name, tool);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#tools.get(tool.name) === tool) this.#tools.delete(tool.name);
    };
  }

  snapshot(): readonly AgentTool[] {
    return Object.freeze([...this.#tools.values()]);
  }

  resolve(options: ResolveStandaloneToolsOptions): AgentTool[] {
    const resolved: AgentTool[] = [];
    const names = new Set<string>();
    const add = (tool: AgentTool): void => {
      assertCanonicalToolName(tool.name);
      if (names.has(tool.name)) throw new Error(`Duplicate standalone Agent Tool "${tool.name}"`);
      names.add(tool.name);
      resolved.push(tool);
    };
    if (options.includeRegisteredTools) {
      for (const tool of this.#tools.values()) add(tool);
    }
    for (const tool of options.explicitTools) add(tool);
    return resolved;
  }
}

function assertCanonicalToolName(name: string): void {
  if (!name || name !== name.trim()) {
    throw new TypeError('Standalone Agent Tool name must be a non-empty canonical name');
  }
}
