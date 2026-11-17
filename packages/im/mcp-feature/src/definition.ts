import type { ConstructionContext } from '@zhin.js/feature-kit';

const mcpBrand = 'zhin.mcp/1' as const;

/**
 * Upstream MCP tool annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` /
 * `openWorldHint`), kept as the tool's own facts (ADR 0065 D1). They come from an out-of-process
 * server: hosts may use them to pick a permission tier, never to relax approval.
 */
export interface McpToolHints {
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
}

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  /** Upstream annotations; absent when the server declared none (ADR 0065 D1). */
  readonly hints?: McpToolHints;
}

const HINT_KEYS = ['readOnly', 'destructive', 'idempotent', 'openWorld'] as const;
const ANNOTATION_KEYS = {
  readOnly: 'readOnlyHint',
  destructive: 'destructiveHint',
  idempotent: 'idempotentHint',
  openWorld: 'openWorldHint',
} as const;

/**
 * Reads the upstream `tools/list` `annotations` object into {@link McpToolHints}. Only boolean values
 * count; any other type is treated as "not annotated". Display fields such as `title` are ignored.
 */
export function mcpToolHintsFromAnnotations(annotations: unknown): McpToolHints | undefined {
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) return undefined;
  const source = annotations as Record<string, unknown>;
  const hints: Record<string, boolean> = {};
  for (const key of HINT_KEYS) {
    const value = source[ANNOTATION_KEYS[key]];
    if (typeof value === 'boolean') hints[key] = value;
  }
  return Object.keys(hints).length ? Object.freeze(hints) as McpToolHints : undefined;
}

/** Keeps only the boolean fields of a {@link McpToolHints}-shaped value (client output is untrusted). */
export function normalizeMcpToolHints(value: unknown): McpToolHints | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const hints: Record<string, boolean> = {};
  for (const key of HINT_KEYS) {
    if (typeof source[key] === 'boolean') hints[key] = source[key] as boolean;
  }
  return Object.keys(hints).length ? Object.freeze(hints) as McpToolHints : undefined;
}

export interface McpClientInstance {
  start?(signal: AbortSignal): void | Promise<void>;
  stop?(): void | Promise<void>;
  listTools(): readonly McpToolDescriptor[] | Promise<readonly McpToolDescriptor[]>;
  callTool(name: string, input: unknown): unknown | Promise<unknown>;
}

export interface McpDefinition<TConfig = unknown> {
  readonly $feature: typeof mcpBrand;
  readonly description?: string;
  create(context: ConstructionContext<TConfig>): McpClientInstance | Promise<McpClientInstance>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addMcp(localName: string, definition: McpDefinition<TConfig>): void;
  }
}

export type McpDefiner<TConfig> = (
  definition: Omit<McpDefinition<TConfig>, '$feature'>,
) => Readonly<McpDefinition<TConfig>>;

export function defineMcp<TConfig = unknown>(
  definition: Omit<McpDefinition<TConfig>, '$feature'>,
): Readonly<McpDefinition<TConfig>> {
  if (typeof definition.create !== 'function') {
    throw new TypeError('MCP create must be a function');
  }
  return Object.freeze({ ...definition, $feature: mcpBrand });
}

/**
 * Fix the plugin config type first, then define the MCP client.
 */
defineMcp.withConfig = function withConfig<TConfig = unknown>(): McpDefiner<TConfig> {
  return (definition) => defineMcp(definition);
};

export function parseMcpDefinition(value: unknown): McpDefinition {
  if (!value || typeof value !== 'object') throw invalidMcp();
  const definition = value as Partial<McpDefinition>;
  if (definition.$feature !== mcpBrand || typeof definition.create !== 'function') {
    throw invalidMcp();
  }
  return definition as McpDefinition;
}

export function assertMcpClient(value: unknown, source: string): asserts value is McpClientInstance {
  if (!value || typeof value !== 'object') throw invalidClient(source);
  const client = value as Partial<McpClientInstance>;
  if (typeof client.listTools !== 'function' || typeof client.callTool !== 'function') {
    throw invalidClient(source);
  }
}

function invalidMcp(): TypeError {
  return new TypeError('MCP module must default-export defineMcp(...)');
}

function invalidClient(source: string): TypeError {
  return new TypeError(`MCP ${source} create() must return a client instance`);
}
