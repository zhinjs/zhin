import type { AgentTool } from '@zhin.js/ai';

/** Turn-owned source of truth for tools visible to the model and executable by the runtime. */
export class ExecutableToolRegistry {
  readonly #tools = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[] = []) {
    this.replace(tools);
  }

  replace(tools: readonly AgentTool[]): void {
    this.#tools.clear();
    for (const tool of tools) this.#tools.set(tool.name, tool);
  }

  addMissing(tools: Iterable<AgentTool>): void {
    for (const tool of tools) {
      if (!this.#tools.has(tool.name)) this.#tools.set(tool.name, tool);
    }
  }

  resolve(name: string): AgentTool | undefined {
    return this.#tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.#tools.values()];
  }
}
