import type { CapabilityContext } from '@zhin.js/next-feature-kit';

const mcpBrand = 'zhin.mcp/1' as const;

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpClientInstance {
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
  listTools(): readonly McpToolDescriptor[] | Promise<readonly McpToolDescriptor[]>;
  callTool(name: string, input: unknown): unknown | Promise<unknown>;
}

export interface McpDefinition<TConfig = unknown> {
  readonly $feature: typeof mcpBrand;
  readonly description?: string;
  create(context: CapabilityContext<TConfig>): McpClientInstance | Promise<McpClientInstance>;
}

export function defineMcp<TConfig = unknown>(
  definition: Omit<McpDefinition<TConfig>, '$feature'>,
): Readonly<McpDefinition<TConfig>> {
  if (typeof definition.create !== 'function') {
    throw new TypeError('MCP create must be a function');
  }
  return Object.freeze({ ...definition, $feature: mcpBrand });
}

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
