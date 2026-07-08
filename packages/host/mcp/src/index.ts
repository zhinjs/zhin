// MCP v1.27.1 — stateless mode, per-request server+transport
// 外部 MCP Server：从 ToolFeature 读取所有注册工具，暴露给外部开发者
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage } from "node:http";
import type { Router, RouterContext } from "@zhin.js/host-router";
import type {} from "@zhin.js/host-router";
import { formatCompact, type Tool, type ToolFeature, usePlugin } from '@zhin.js/core';
import { z } from "zod";
import { registerTools } from "./tools.js";
import {
  mcpAuthRequired,
  verifyMcpBearer,
} from "./mesh-auth.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export {
  mcpAuthRequired,
  verifyMcpBearer,
  extractMcpToolName,
  isLocalhost,
  timingSafeEqualString,
} from "./mesh-auth.js";

export interface McpConfig {
  enabled?: boolean;
  path?: string;
  /** MCP Bearer token；缺省回退 http.token */
  token?: string;
  /** 非 production 下 localhost 是否允许无 token 调用 */
  allowUnauthenticatedLocalhost?: boolean;
}

// ============================================================================
// JSON Schema → Zod 转换（MCP SDK 需要 Zod schema）
// ============================================================================

interface JsonSchemaProperty {
  type: string;
  description?: string;
  default?: any;
  items?: JsonSchemaProperty;
  enum?: any[];
}

/** 将 JSON Schema 属性转为 zod 类型 */
function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (prop.type) {
    case "string":
      base = prop.enum
        ? z.enum(prop.enum as [string, ...string[]])
        : z.string();
      break;
    case "number":
    case "integer":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array":
      base = z.array(
        prop.items ? jsonSchemaPropertyToZod(prop.items) : z.any(),
      );
      break;
    case "object":
      base = z.record(z.string(), z.any());
      break;
    default:
      base = z.any();
  }
  if (prop.description) base = base.describe(prop.description);
  return base;
}

/** 将 Tool.parameters → Record<string, z.ZodTypeAny>（MCP SDK 格式） */
function toolParamsToZodSchema(
  params: Tool["parameters"],
): Record<string, z.ZodTypeAny> {
  const result: Record<string, z.ZodTypeAny> = {};
  if (!params?.properties) return result;
  for (const [key, prop] of Object.entries(params.properties)) {
    let zodType = jsonSchemaPropertyToZod(prop as JsonSchemaProperty);
    if (!params.required?.includes(key)) {
      zodType = zodType.optional();
    }
    result[key] = zodType;
  }
  return result;
}

// ============================================================================
// MCP Server 创建（从 ToolFeature 读取工具）
// ============================================================================

function createMcpServer(toolFeature: ToolFeature | null): McpServer {
  const server = new McpServer(
    { name: "zhin-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  // 从 ToolFeature 读取所有注册的工具，暴露给外部 MCP 客户端（按 name 去重）
  if (toolFeature) {
    const runtimeTools = new Map<string, Tool>();
    for (const tool of toolFeature.getAll()) {
      if (tool.hidden) continue;
      runtimeTools.set(tool.name, tool);
    }
    for (const tool of runtimeTools.values()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: toolParamsToZodSchema(tool.parameters),
        },
        async (args: Record<string, any>) => {
          const result = await tool.execute(args);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  typeof result === "string" ? result : JSON.stringify(result),
              },
            ],
          };
        },
      );
    }
  }

  return server;
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function resolveRequestBody(ctx: RouterContext): Promise<unknown> {
  const parsed = ctx.request.body;
  if (parsed !== undefined && parsed !== null) return parsed;
  return parseJsonBody(ctx.req);
}

function sendJsonViaRawRes(
  ctx: RouterContext,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  ctx.respond = false;
  ctx.res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  ctx.res.end(JSON.stringify(body));
}

function registerMcpRoutes(
  router: Router,
  basePath: string,
  handler: (ctx: RouterContext) => Promise<void>,
): void {
  const normalized = basePath.replace(/\/+$/, "") || "/";
  router.all(normalized, handler);
  if (normalized !== "/") {
    router.all(`${normalized}/:tail+`, handler);
  }
}

const plugin = usePlugin();
const { root, useContext, logger } = plugin;

// 获取 ToolFeature 引用（可能在 MCP server 启动前或后注册）
let toolFeatureRef: ToolFeature | null = null;
useContext("tool", (toolService: ToolFeature) => {
  toolFeatureRef = toolService;
  return () => {
    toolFeatureRef = null;
  };
});

useContext("router", (router: Router) => {
  const configService = root.inject("config")!;
  const appConfig = configService.get<{ mcp?: McpConfig; http?: { token?: string } }>("zhin.config.yml");
  const mcpCfg = appConfig.mcp || {};
  const { enabled = true, path: mcpPath = "/mcp" } = mcpCfg;
  const mcpToken = mcpCfg.token || appConfig.http?.token || "";
  const isProduction = process.env.NODE_ENV === "production";

  if (!enabled) {
    logger.info(formatCompact({ enabled: false }));
    return;
  }

  const mcpHandler = async (ctx: RouterContext): Promise<void> => {
    ctx.respond = false;
    const { req, res } = ctx;

    try {
      if (req.method === "POST") {
        const body = await resolveRequestBody(ctx);
        if (mcpAuthRequired(body, req, mcpCfg, isProduction) && !verifyMcpBearer(req, mcpToken)) {
          sendJsonViaRawRes(ctx, 401, {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unauthorized — Bearer token required" },
            id: (body as { id?: unknown })?.id ?? null,
          });
          return;
        }
        const mcpServer = createMcpServer(toolFeatureRef);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        try {
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
        } finally {
          try { await transport.close(); } catch { /* ignore */ }
          try { await mcpServer.close(); } catch { /* ignore */ }
        }
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        sendJsonViaRawRes(
          ctx,
          405,
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Method not allowed in stateless mode",
            },
            id: null,
          },
          { Allow: "POST" },
        );
        return;
      }

      sendJsonViaRawRes(ctx, 405, { error: "Method not allowed" });
    } catch (err) {
      logger.error("MCP request error:", err);
      if (!res.headersSent) {
        sendJsonViaRawRes(ctx, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  registerMcpRoutes(router, mcpPath, mcpHandler);

  logger.info(formatCompact({ MCP路径: mcpPath, 运行模式: "无状态" }));
});
