import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import type { ToolApproval } from '@zhin.js/tool';
import { z } from 'zod';
import { mcpAuthRequired, verifyMcpBearer } from './mesh-auth.js';

export interface RuntimeMcpConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly token?: string;
  readonly allowUnauthenticatedLocalhost?: boolean;
  /** External callers may only invoke `approval: never` tools by default. */
  readonly allowApprovalTools?: boolean;
}

export interface RuntimeMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly approval: ToolApproval;
  execute(input: unknown): Promise<unknown>;
}

export interface RuntimeMcpToolProvider {
  withTools<TResult>(
    operation: (tools: readonly RuntimeMcpTool[]) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface InstallRuntimeMcpOptions {
  readonly http: HttpHost;
  readonly config: RuntimeMcpConfig;
  readonly fallbackToken?: string;
  readonly production?: boolean;
  readonly tools: RuntimeMcpToolProvider;
}

/** Mount a stateless MCP endpoint on the Plugin Runtime HTTP Host. */
export function installRuntimeMcp(options: InstallRuntimeMcpOptions): () => void {
  if (options.config.enabled === false) return () => undefined;
  const path = normalizePath(options.config.path ?? '/mcp');
  const unregister = options.http.route('ALL', `${path}/*`, async (request, response) => {
    await handleRuntimeMcpRequest(request, response, options);
  }, { summary: 'Model Context Protocol', tags: ['mcp'] });
  return unregister;
}

export async function handleRuntimeMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Omit<InstallRuntimeMcpOptions, 'http'>,
): Promise<void> {
  if (request.method !== 'POST') {
    writeJson(response, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode' },
      id: null,
    }, { Allow: 'POST' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    writeJson(response, 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
    return;
  }

  const expectedToken = options.config.token ?? options.fallbackToken ?? '';
  if (
    mcpAuthRequired(body, request, options.config, options.production ?? false)
    && !verifyMcpBearer(request, expectedToken)
  ) {
    writeJson(response, 401, {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized - Bearer token required' },
      id: requestId(body),
    });
    return;
  }

  try {
    await options.tools.withTools(async (tools) => {
      const server = createRuntimeMcpServer(
        tools,
        options.config.allowApprovalTools === true,
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, body);
      } finally {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    });
  } catch {
    if (!response.headersSent) {
      writeJson(response, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: requestId(body),
      });
    }
  }
}

function createRuntimeMcpServer(
  tools: readonly RuntimeMcpTool[],
  allowApprovalTools: boolean,
): McpServer {
  const server = new McpServer(
    { name: 'zhin-plugin-runtime', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) continue;
    names.add(tool.name);
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: inputSchemaToZodShape(tool.inputSchema),
    }, async (input) => {
      if (tool.approval !== 'never' && !allowApprovalTools) {
        throw new Error(`Tool ${tool.name} requires approval and is not exposed to MCP`);
      }
      const result = await tool.execute(input);
      return {
        content: [{
          type: 'text' as const,
          text: typeof result === 'string' ? result : JSON.stringify(result),
        }],
      };
    });
  }
  return server;
}

function inputSchemaToZodShape(schema: unknown): Record<string, z.ZodType> {
  const zodShape = (schema as { shape?: unknown } | null)?.shape;
  if (zodShape && typeof zodShape === 'object' && !Array.isArray(zodShape)) {
    return zodShape as Record<string, z.ZodType>;
  }
  return jsonSchemaToZodShape(schema);
}

function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodType> {
  if (!schema || typeof schema !== 'object') return {};
  const value = schema as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  const shape: Record<string, z.ZodType> = {};
  for (const [name, property] of Object.entries(value.properties ?? {})) {
    let field = jsonSchemaPropertyToZod(property);
    if (!value.required?.includes(name)) field = field.optional();
    shape[name] = field;
  }
  return shape;
}

interface JsonSchemaProperty {
  readonly type?: string;
  readonly description?: string;
  readonly enum?: unknown[];
  readonly items?: JsonSchemaProperty;
  readonly properties?: Record<string, JsonSchemaProperty>;
}

function jsonSchemaPropertyToZod(property: JsonSchemaProperty): z.ZodType {
  let value: z.ZodType;
  switch (property.type) {
    case 'string':
      value = property.enum?.length
        ? z.enum(property.enum.map(String) as [string, ...string[]])
        : z.string();
      break;
    case 'number':
      value = z.number();
      break;
    case 'integer':
      value = z.number().int();
      break;
    case 'boolean':
      value = z.boolean();
      break;
    case 'array':
      value = z.array(property.items ? jsonSchemaPropertyToZod(property.items) : z.unknown());
      break;
    case 'object':
      value = z.object(jsonSchemaToZodShape(property));
      break;
    default:
      value = z.unknown();
  }
  return property.description ? value.describe(property.description) : value;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.trim() ? JSON.parse(raw) : undefined;
}

function requestId(body: unknown): unknown {
  return body && typeof body === 'object' && 'id' in body
    ? (body as { id?: unknown }).id ?? null
    : null;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    ...headers,
  });
  response.end(payload);
}

function normalizePath(path: string): string {
  const leading = path.startsWith('/') ? path : `/${path}`;
  return leading.replace(/\/+$/u, '') || '/';
}

export type { HttpRouteRegistration };
