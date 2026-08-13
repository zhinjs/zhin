import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  type HttpRouteHost,
  type HttpRouteRegistration,
} from '@zhin.js/host-http-contract';
import { HttpBodyError, readJsonBody } from '@zhin.js/host-http-contract';
import type { ToolInvocationContext } from '@zhin.js/tool';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mcpAuthRequired, verifyMcpBearer } from './mesh-auth.js';

export interface RuntimeMcpConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly token?: string;
  readonly allowUnauthenticatedLocalhost?: boolean;
}

export interface RuntimeMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  execute(input: unknown, context: ToolInvocationContext): Promise<unknown>;
}

export interface RuntimeMcpToolProvider {
  withTools<TResult>(
    context: ToolInvocationContext,
    operation: (tools: readonly RuntimeMcpTool[]) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface InstallRuntimeMcpOptions {
  readonly http: HttpRouteHost;
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
  } catch (error) {
    // JSON-RPC keeps a protocol error envelope while the HTTP status preserves
    // the transport-level distinction between malformed and oversized input.
    writeJson(response, error instanceof HttpBodyError ? error.statusCode : 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
    return;
  }

  const expectedToken = options.config.token ?? options.fallbackToken ?? '';
  const bearerAuthenticated = verifyMcpBearer(request, expectedToken);
  if (mcpAuthRequired(body, request, options.config, options.production ?? false)
    && !bearerAuthenticated) {
    writeJson(response, 401, {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized - Bearer token required' },
      id: requestId(body),
    });
    return;
  }

  try {
    const invocation = mcpInvocationContext(request, response, body, bearerAuthenticated);
    await options.tools.withTools(invocation, async (tools) => {
      const server = createRuntimeMcpServer(tools, invocation);
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
  invocation: ToolInvocationContext,
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
      const result = await tool.execute(input, invocation);
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

function mcpInvocationContext(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  bearerAuthenticated: boolean,
): ToolInvocationContext {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort(new Error('MCP request aborted')));
  response.once('close', () => {
    if (!response.writableEnded) controller.abort(new Error('MCP response closed'));
  });
  response.once('error', (error) => controller.abort(error));
  const id = String(requestId(body) ?? 'notification');
  const invocationId = randomUUID();
  return Object.freeze({
    signal: controller.signal,
    traceId: `mcp:${id}:${invocationId}`,
    turnId: `mcp:${invocationId}`,
    sessionKey: 'mcp:stateless',
    origin: Object.freeze({ kind: 'mcp', requestId: id }),
    principal: Object.freeze({
      subjectId: 'mcp-client',
      roles: Object.freeze([bearerAuthenticated ? 'authenticated' : 'localhost']),
    }),
  });
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

function trimTrailingSlashes(s: string): string {
  let i = s.length;
  while (i > 0 && s[i - 1] === '/') i--;
  return s.slice(0, i);
}

function normalizePath(path: string): string {
  const leading = path.startsWith('/') ? path : `/${path}`;
  return trimTrailingSlashes(leading) || '/';
}

export type { HttpRouteRegistration };
