import type { CapabilityContext } from '@zhin.js/feature-kit';

const toolBrand = 'zhin.agent-tool/1' as const;

export type ToolApproval = 'never' | 'on-risk' | 'always';

export interface AgentToolDefinition<
  TInput = unknown,
  TResult = unknown,
  TConfig = unknown,
> {
  readonly $feature: typeof toolBrand;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly approval: ToolApproval;
  execute(input: TInput, context: CapabilityContext<TConfig>): TResult | Promise<TResult>;
}

export function defineAgentTool<
  TInput = unknown,
  TResult = unknown,
  TConfig = unknown,
>(
  definition: Omit<AgentToolDefinition<TInput, TResult, TConfig>, '$feature' | 'approval'> & {
    readonly approval?: ToolApproval;
  },
): Readonly<AgentToolDefinition<TInput, TResult, TConfig>> {
  if (!definition.description.trim()) throw new TypeError('Agent Tool description cannot be empty');
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Agent Tool execute must be a function');
  }
  const approval = definition.approval ?? 'on-risk';
  if (approval !== 'never' && approval !== 'on-risk' && approval !== 'always') {
    throw new TypeError(`Invalid Agent Tool approval: ${String(approval)}`);
  }
  return Object.freeze({ ...definition, $feature: toolBrand, approval });
}

export function parseAgentToolDefinition(value: unknown): AgentToolDefinition {
  if (!value || typeof value !== 'object') throw invalidTool();
  const definition = value as Partial<AgentToolDefinition>;
  if (
    definition.$feature !== toolBrand
    || typeof definition.description !== 'string'
    || !definition.description.trim()
    || typeof definition.execute !== 'function'
    || (definition.approval !== 'never'
      && definition.approval !== 'on-risk'
      && definition.approval !== 'always')
  ) throw invalidTool();
  return definition as AgentToolDefinition;
}

function invalidTool(): TypeError {
  return new TypeError('Tool module must default-export defineAgentTool(...)');
}
