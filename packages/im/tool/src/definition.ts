/**
 * Agent Tool authoring API consumed from `@zhin.js/tool`.
 * @module @zhin.js/tool
 */
import type {
  AdapterClient,
  CapabilityContext,
  OperationClientPort,
  RegisteredAdapterName,
} from '@zhin.js/feature-kit';

const toolBrand = 'zhin.agent-tool/1' as const;

export type ToolApproval = 'never' | 'on-risk' | 'once' | 'always';
export type ToolScope = 'private' | 'group' | 'channel';

export interface ToolInvocationPolicy {
  readonly permissions: readonly string[];
  readonly unattended: boolean;
  readonly network: Readonly<{
    readonly enabled: boolean;
    readonly httpsOnly?: boolean;
    readonly allowedDomains?: readonly string[];
  }>;
  readonly shell?: Readonly<{
    readonly preset?: 'readonly' | 'network';
    readonly security?: 'deny' | 'allowlist' | 'full';
    readonly execPreset?: 'readonly' | 'network' | 'development' | 'custom';
    readonly approvalMode?: 'ask' | 'allow' | 'deny';
    readonly isolation?: 'required' | 'none';
  }>;
  readonly filesystem?: Readonly<{
    readonly workspaceRoot: string;
    readonly workingDirectory?: string;
    readonly access?: 'read-only' | 'workspace-write' | 'danger-full-access';
  }>;
}

export type ToolQuestionType = 'text' | 'number' | 'confirm' | 'pick';

export interface ToolQuestionRequest {
  readonly requestId: string;
  readonly question: string;
  readonly type: ToolQuestionType;
  readonly options?: readonly string[];
  readonly defaultValue?: string;
  readonly timeoutMs?: number;
  readonly signal: AbortSignal;
}

export type ToolQuestionAnswer =
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'number'; value: number }>
  | Readonly<{ type: 'confirm'; value: boolean }>
  | Readonly<{ type: 'pick'; value: string; index: number }>;

export interface ToolQuestionPort {
  ask(input: ToolQuestionRequest): Promise<ToolQuestionAnswer>;
}

export type ToolInvocationOrigin =
  | Readonly<{
      kind: 'im';
      platform: string;
      endpoint: string;
      scope: ToolScope;
      sceneId: string;
      messageId?: string;
      threadId?: string;
    }>
  | Readonly<{ kind: 'http'; sessionId: string }>
  | Readonly<{ kind: 'a2a'; taskId: string }>
  | Readonly<{ kind: 'schedule'; jobId: string }>
  | Readonly<{ kind: 'internal'; source: string }>
  | Readonly<{ kind: 'mcp'; requestId: string }>;

export interface ToolInvocationContext {
  readonly signal: AbortSignal;
  readonly traceId: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly origin: ToolInvocationOrigin;
  readonly principal: Readonly<{
    subjectId: string;
    displayName?: string;
    roles: readonly string[];
  }>;
  readonly policy: ToolInvocationPolicy;
  readonly question?: ToolQuestionPort;
  /** Runtime-only native Client capability for an IM-origin turn. */
  readonly client?: OperationClientPort;
}

export interface ToolExecutionContext<
  TConfig = unknown,
  TAdapter extends string | undefined = undefined,
> extends CapabilityContext<TConfig> {
  readonly signal: AbortSignal;
  readonly traceId: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly origin: ToolInvocationOrigin;
  readonly principal: ToolInvocationContext['principal'];
  readonly policy: ToolInvocationPolicy;
  readonly question?: ToolQuestionPort;
  /** Lazily resolved native Client. Without `adapter`, its static type is `unknown`. */
  readonly $client: AdapterClient<TAdapter>;
}

export interface AgentToolDefinition<
  TInput = unknown,
  TResult = unknown,
  TConfig = unknown,
  TAdapter extends string | undefined = string | undefined,
> {
  /** @internal Runtime feature brand. */
  readonly $feature: typeof toolBrand;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly approval: ToolApproval;
  /** Restrict this tool to one adapter and infer `context.$client`. */
  readonly adapter?: TAdapter;
  readonly platforms?: readonly string[];
  readonly scopes?: readonly ToolScope[];
  readonly permissions?: readonly string[];
  readonly hidden?: boolean;
  execute(
    input: TInput,
    context: ToolExecutionContext<TConfig, TAdapter>,
  ): TResult | Promise<TResult>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addTool<TInput = unknown, TResult = unknown>(
      localName: string,
      definition: AgentToolDefinition<TInput, TResult, TConfig, string | undefined>,
    ): void;
  }
}

/**
 * Define an Agent tool together with its approval and invocation boundaries.
 * Runtime policy remains authoritative even when a definition requests broad access.
 *
 * @public
 * @experimental
 */
type AgentToolAuthoringDefinition<TInput, TResult, TConfig> =
  | (Omit<
      AgentToolDefinition<TInput, TResult, TConfig, undefined>,
      '$feature' | 'approval'
    > & { readonly approval?: ToolApproval })
  | {
      [TAdapter in RegisteredAdapterName]: Omit<
        AgentToolDefinition<TInput, TResult, TConfig, TAdapter>,
        '$feature' | 'approval'
      > & {
        readonly adapter: TAdapter;
        readonly approval?: ToolApproval;
      }
    }[RegisteredAdapterName];

export function defineAgentTool<
  TInput = unknown,
  TResult = unknown,
  TConfig = unknown,
>(
  definition: AgentToolAuthoringDefinition<TInput, TResult, TConfig>,
): Readonly<AgentToolDefinition<TInput, TResult, TConfig, string | undefined>> {
  if (!definition.description.trim()) throw new TypeError('Agent Tool description cannot be empty');
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Agent Tool execute must be a function');
  }
  const adapter = (definition as { readonly adapter?: unknown }).adapter;
  if (adapter !== undefined
    && (typeof adapter !== 'string' || adapter.trim() === '')) {
    throw new TypeError('Agent Tool adapter must be a non-empty string');
  }
  if (typeof adapter === 'string' && definition.platforms
    && (definition.platforms.length !== 1 || definition.platforms[0] !== adapter)) {
    throw new TypeError('Agent Tool adapter and platforms must select the same single adapter');
  }
  const approval = definition.approval ?? 'on-risk';
  if (approval !== 'never' && approval !== 'on-risk' && approval !== 'once' && approval !== 'always') {
    throw new TypeError(`Invalid Agent Tool approval: ${String(approval)}`);
  }
  validateStringList('platforms', definition.platforms);
  validateStringList('permissions', definition.permissions);
  if (definition.scopes !== undefined && !Array.isArray(definition.scopes)) {
    throw new TypeError('Agent Tool scopes must be an array');
  }
  if (definition.scopes?.some((scope) => scope !== 'private' && scope !== 'group' && scope !== 'channel')) {
    throw new TypeError('Agent Tool scopes must be private, group, or channel');
  }
  return Object.freeze({
    ...definition,
    platforms: freezeList(typeof adapter === 'string' ? [adapter] : definition.platforms),
    scopes: freezeList(definition.scopes),
    permissions: freezeList(definition.permissions),
    $feature: toolBrand,
    approval,
  }) as Readonly<AgentToolDefinition<TInput, TResult, TConfig, string | undefined>>;
}

/** @internal Runtime validation for convention-discovered modules. */
export function parseAgentToolDefinition(value: unknown): AgentToolDefinition {
  if (!value || typeof value !== 'object') throw invalidTool();
  const definition = value as Partial<AgentToolDefinition>;
  if (
    definition.$feature !== toolBrand
    || typeof definition.description !== 'string'
    || !definition.description.trim()
    || typeof definition.execute !== 'function'
    || !validAdapterName((definition as { readonly adapter?: unknown }).adapter)
    || (definition.approval !== 'never'
      && definition.approval !== 'on-risk'
      && definition.approval !== 'once'
      && definition.approval !== 'always')
    || !validStringList(definition.platforms)
    || !validStringList(definition.permissions)
    || (definition.scopes !== undefined && !Array.isArray(definition.scopes))
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

function validAdapterName(adapter: unknown): boolean {
  return adapter === undefined || (typeof adapter === 'string' && adapter.trim() !== '');
}
