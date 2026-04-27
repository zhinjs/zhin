// MCP v1.27.1 — stateless mode, per-request server+transport
// 外部 MCP Server：从 ToolFeature 读取所有注册工具，暴露给外部开发者
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type {} from "@zhin.js/http";
import { usePlugin, type ToolFeature, type Tool } from "zhin.js";
import { z } from "zod";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export interface McpConfig {
  enabled?: boolean;
  path?: string;
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

  // 从 ToolFeature 读取所有注册的工具，暴露给外部 MCP 客户端
  if (toolFeature) {
    for (const tool of toolFeature.getAll()) {
      if (tool.hidden) continue;
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

const plugin = usePlugin();
const { root, useContext, logger, onDispose } = plugin;

// 获取 ToolFeature 引用（可能在 MCP server 启动前或后注册）
let toolFeatureRef: ToolFeature | null = null;
useContext("tool", (toolService: ToolFeature) => {
  toolFeatureRef = toolService;
  return () => {
    toolFeatureRef = null;
  };
});

useContext("server", (server: Server) => {
  const configService = root.inject("config")!;
  const appConfig = configService.get<{ mcp?: McpConfig }>("zhin.config.yml");
  const { enabled = true, path: mcpPath = "/mcp" } = appConfig.mcp || {};

  if (!enabled) {
    logger.info("MCP Server is disabled");
    return;
  }

  const mcpHandler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        const mcpServer = createMcpServer(toolFeatureRef);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        res.writeHead(405, {
          Allow: "POST",
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Method not allowed in stateless mode",
            },
            id: null,
          }),
        );
        return;
      }

      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    } catch (err) {
      logger.error("MCP request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  };

  const originalListeners = server.listeners("request").slice();
  server.removeAllListeners("request");

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "";
    if (
      url === mcpPath ||
      url.startsWith(mcpPath + "?") ||
      url.startsWith(mcpPath + "/")
    ) {
      mcpHandler(req, res);
      return;
    }
    for (const listener of originalListeners) {
      (listener as Function).call(server, req, res);
    }
  });

  logger.info(`MCP Server ready at ${mcpPath} (stateless mode)`);

  onDispose(() => {
    server.removeAllListeners("request");
    for (const listener of originalListeners) {
      server.on("request", listener);
    }
  });
});

import type {} from "@zhin.js/http";
declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      server: import("node:http").Server;
    }
  }
}
