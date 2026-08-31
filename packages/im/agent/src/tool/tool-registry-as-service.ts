/** Projects the generation-owned ResourceHub ToolRegistry into Capability Seam. */

import type { AgentToolExecutionContext } from '@zhin.js/ai';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { ToolRegistry } from '../resource-hub/tool-registry.js';
import type { SeamScope } from '../seam/seam-provider.js';
import type { ToolExecutionResult, ToolSchema, ToolService } from '../seam/tool-service.js';

export class ToolRegistryAsService implements ToolService {
  readonly id = 'zhin:resource-hub-tools';
  readonly description = 'Generation-owned Agent ResourceHub tools';
  readonly tags = ['tools', 'framework'];

  constructor(private readonly registry: ToolRegistry) {}

  schema(scope: SeamScope | 'global'): ToolSchema[] {
    return this.tools(scope).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
      approval: typeof tool.approval === 'string' ? tool.approval : 'on-risk',
      permissions: tool.permissions,
      hidden: (tool as { hidden?: boolean }).hidden,
      source: tool.source,
    }));
  }

  async execute(
    scope: SeamScope | 'global',
    toolName: string,
    args: unknown,
    context: ToolInvocationContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools(scope).find((candidate) => candidate.name === toolName);
    if (!tool) return { success: false, error: `Tool not found: ${toolName}` };
    const executionContext: AgentToolExecutionContext = {
      signal: context.signal,
      sessionId: context.sessionKey,
      toolCallId: context.turnId,
      toolName,
    };
    try {
      const output = await tool.execute(
        (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
        undefined,
        executionContext,
      );
      return { success: true, output };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  isAvailable(scope: SeamScope | 'global', toolName: string): boolean {
    return this.tools(scope).some((tool) => tool.name === toolName);
  }

  private tools(scope: SeamScope | 'global') {
    return scope === 'global'
      ? this.registry.getAll()
      : this.registry.getForAgent(String(scope));
  }
}
