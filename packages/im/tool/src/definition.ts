import type { CapabilityContext } from '@zhin.js/feature-kit';

const toolBrand = 'zhin.agent-tool/1' as const;

export type ToolApproval = 'never' | 'on-risk' | 'always';
export type ToolScope = 'private' | 'group' | 'channel';

export interface AgentToolDefinition<
  TInput = unknown,
  TResult = unknown,
  TConfig = unknown,
> {
  readonly $feature: typeof toolBrand;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly approval: ToolApproval;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ToolScope[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
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
  validateStringList('platforms', definition.platforms);
  validateStringList('permissions', definition.permissions);
  if (definition.scopes?.some((scope) => scope !== 'private' && scope !== 'group' && scope !== 'channel')) {
    throw new TypeError('Agent Tool scopes must be private, group, or channel');
  }
  return Object.freeze({
    ...definition,
    platforms: freezeList(definition.platforms),
    scopes: freezeList(definition.scopes),
    permissions: freezeList(definition.permissions),
    $feature: toolBrand,
    approval,
  });
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
    || !validStringList(definition.platforms)
    || !validStringList(definition.permissions)
    || (definition.scopes?.some((scope) => scope !== 'private' && scope !== 'group' && scope !== 'channel') ?? false)
    || (definition.hidden !== undefined && typeof definition.hidden !== 'boolean')
  ) throw invalidTool();
  return definition as AgentToolDefinition;
}

function validateStringList(name: string, values: readonly string[] | undefined): void {
  if (!validStringList(values)) throw new TypeError(`Agent Tool ${name} must contain non-empty strings`);
}

function validStringList(values: readonly string[] | undefined): boolean {
  return values === undefined
    || (Array.isArray(values) && values.every((value) => typeof value === 'string' && value.trim() !== ''));
}

function freezeList<T>(values: readonly T[] | undefined): readonly T[] | undefined {
  return values ? Object.freeze([...values]) : undefined;
}

function invalidTool(): TypeError {
  return new TypeError('Tool module must default-export defineAgentTool(...)');
}
