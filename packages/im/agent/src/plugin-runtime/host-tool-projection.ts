import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolApproval,
  type ToolScope,
} from '@zhin.js/tool';

export { toolFeatureId };

export interface HostToolProjectionInput {
  readonly name: string;
  readonly description: string;
  readonly parameters?: unknown;
  readonly approval?: ToolApproval;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ToolScope[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  execute(input: Record<string, unknown>, context: import('@zhin.js/tool').ToolExecutionContext): unknown | Promise<unknown>;
}

export interface HostToolProjection {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, unknown>>;
}

/** Converts a Host-owned tool into the same candidate ToolFeature used by plugins. */
export function projectHostTool(input: HostToolProjectionInput): HostToolProjection {
  if (!input.name.trim()) throw new TypeError('Host Tool name cannot be empty');
  return Object.freeze({
    feature: toolFeatureId,
    name: input.name,
    definition: defineAgentTool<Record<string, unknown>, unknown>({
      description: input.description,
      inputSchema: input.parameters,
      approval: input.approval,
      platforms: input.platforms,
      scopes: input.scopes,
      permissions: input.permissions,
      hidden: input.hidden,
      execute: (value, context) => input.execute(value, context),
    }),
  });
}
