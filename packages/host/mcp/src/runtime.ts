import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  type HttpRouteHost,
  type HttpRouteRegistration,
} from '@zhin.js/host-http-contract';
import { HttpBodyError, jsonResponse, readJsonBody } from '@zhin.js/host-http-contract';
import type { ToolInvocationContext } from '@zhin.js/tool';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mcpAuthRequired, verifyMcpBearer, type McpAuthRequest } from './mesh-auth.js';

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
  /**
   * Shared Host credential check (ADR 0049): user API tokens with `mcp.access`, or the
   * bootstrap token before setup. Tried when the bearer does not match `config.token`.
   */
  readonly authenticateBearer?: (token: string, request: Request, remoteAddress?: string) => Promise<boolean>;
  readonly production?: boolean;
  readonly tools: RuntimeMcpToolProvider;
}

/** Mount a stateless MCP endpoint on the Plugin Runtime HTTP Host. */
export function installRuntimeMcp(options: InstallRuntimeMcpOptions): () => void {
  if (options.config.enabled === false) return () => undefined;
  const path = normalizePath(options.config.path ?? '/mcp');
  const unregister = options.http.route('ALL', `${path}/*`, (request, { remoteAddress }) => (
    handleRuntimeMcpRequest(request, options, remoteAddress)
  ), { summary: 'Model Context Protocol', tags: ['mcp'] });
  return unregister;
}

export async function handleRuntimeMcpRequest(
  request: Request,
  options: Omit<InstallRuntimeMcpOptions, 'http'>,
  remoteAddress?: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode' },
      id: null,
    }, { Allow: 'POST' });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    // JSON-RPC keeps a protocol error envelope while the HTTP status preserves
    // the transport-level distinction between malformed and oversized input.
    return jsonResponse(error instanceof HttpBodyError ? error.statusCode : 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
  }

  const auth: McpAuthRequest = { headers: request.headers, ...(remoteAddress ? { remoteAddress } : {}) };
  const expectedToken = options.config.token ?? options.fallbackToken ?? '';
  const bearer = bearerOf(request);
  const bearerAuthenticated = verifyMcpBearer(auth, expectedToken)
    || (bearer !== '' && options.authenticateBearer !== undefined
      && await options.authenticateBearer(bearer, request, remoteAddress).catch(() => false));
  if (mcpAuthRequired(body, auth, options.config, options.production ?? false)
    && !bearerAuthenticated) {
    return jsonResponse(401, {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized - Bearer token required' },
      id: requestId(body),
    });
  }

  const internalError = () => jsonResponse(500, {
    jsonrpc: '2.0',
    error: { code: -32603, message: 'Internal server error' },
    id: requestId(body),
  });
  const { invocation, detach } = mcpInvocationContext(request, body, bearerAuthenticated);
  // The tool lease must outlive the (possibly streaming) response body, so the
  // response is handed out while `withTools` keeps waiting for the body to finish.
  return new Promise<Response>((resolve) => {
    let handedOut = false;
    void options.tools.withTools(invocation, async (tools) => {
      const server = createRuntimeMcpServer(tools, invocation);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request, { parsedBody: body });
        if (!response.body) {
          handedOut = true;
          resolve(response);
          return;
        }
        await new Promise<void>((finished) => {
          handedOut = true;
          resolve(new Response(onBodyFinished(response.body!, () => {
            detach();
            finished();
          }), { status: response.status, statusText: response.statusText, headers: response.headers }));
        });
      } finally {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    }).catch(() => {
      if (!handedOut) resolve(internalError());
    });
  });
}

/** Pass-through body that reports when it was read to the end, failed or was cancelled. */
function onBodyFinished(source: ReadableStream<Uint8Array>, finished: () => void): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    finished();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  }, { highWaterMark: 0 });
}

function createRuntimeMcpServer(
  tools: readonly RuntimeMcpTool[],
  invocation: ToolInvocationContext,
): McpServer {
  const server = new McpServer(
    { name: 'zhin-plugin-runtime', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  // McpServer lazily installs these handlers on the first registered tool.
  // An empty generation still advertises tools and must answer the protocol.
  if (tools.length === 0) {
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    server.server.setRequestHandler(CallToolRequestSchema, async () => {
      throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
    });
  }
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
  request: Request,
  body: unknown,
  bearerAuthenticated: boolean,
): { invocation: ToolInvocationContext; detach(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new Error('MCP request aborted'));
  if (request.signal.aborted) onAbort();
  else request.signal.addEventListener('abort', onAbort, { once: true });
  const id = String(requestId(body) ?? 'notification');
  const invocationId = randomUUID();
  const invocation: ToolInvocationContext = Object.freeze({
    signal: controller.signal,
    traceId: `mcp:${id}:${invocationId}`,
    turnId: `mcp:${invocationId}`,
    sessionKey: 'mcp:stateless',
    origin: Object.freeze({ kind: 'mcp', requestId: id }),
    principal: Object.freeze({
      subjectId: 'mcp-client',
      roles: Object.freeze([bearerAuthenticated ? 'authenticated' : 'localhost']),
    }),
    policy: Object.freeze({
      permissions: Object.freeze([bearerAuthenticated ? 'authenticated' : 'localhost']),
      unattended: true,
      network: Object.freeze({ enabled: false }),
    }),
  });
  // Body finished: nothing listens any more, drop the disconnect hook.
  return { invocation, detach: () => request.signal.removeEventListener('abort', onAbort) };
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

function bearerOf(request: Request): string {
  const auth = request.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
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
