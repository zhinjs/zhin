// MCP v1.27.1 — stateless mode, per-request server+transport
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type {} from "@zhin.js/http";
import { usePlugin } from "zhin.js";
import { z } from "zod";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export interface McpConfig {
  enabled?: boolean;
  path?: string;
}

/**
 * MCP 工具注册表 — adapter 通过 useContext('mcp') 注册平台特有工具
 */
/**
 * JSON Schema 属性描述
 */
export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  default?: any;
  items?: JsonSchemaProperty;
  enum?: any[];
}

/**
 * MCP 工具注册表 — adapter 通过 useContext('mcp') 注册平台特有工具
 * schema 使用 JSON Schema object 格式，无需 zod 依赖
 */
export interface McpToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  handler: (args: Record<string, any>) => Promise<any>;
}

/** 将 JSON Schema 属性转为 zod 类型 */
function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (prop.type) {
    case "string":
      base = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
      break;
    case "number":
    case "integer":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array":
      base = z.array(prop.items ? jsonSchemaPropertyToZod(prop.items) : z.any());
      break;
    case "object":
      base = z.record(z.any());
      break;
    default:
      base = z.any();
  }
  if (prop.description) base = base.describe(prop.description);
  return base;
}

/** 将 McpToolDef.parameters → Record<string, z.ZodTypeAny>（MCP SDK 格式） */
function toZodSchema(params: McpToolDef["parameters"]): Record<string, z.ZodTypeAny> {
  const result: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(params.properties)) {
    let zodType = jsonSchemaPropertyToZod(prop);
    if (!params.required?.includes(key)) {
      zodType = zodType.optional();
    }
    result[key] = zodType;
  }
  return result;
}

export class McpToolRegistry {
  readonly #tools: Map<string, McpToolDef> = new Map();

  /** 注册一个 MCP 工具 */
  addTool(def: McpToolDef): void {
    this.#tools.set(def.name, def);
  }

  /** 移除一个 MCP 工具 */
  removeTool(name: string): void {
    this.#tools.delete(name);
  }

  /** 获取所有已注册的工具 */
  getTools(): McpToolDef[] {
    return Array.from(this.#tools.values());
  }
}

const registry = new McpToolRegistry();

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "zhin-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  // 注册 adapter 提供的平台工具
  for (const tool of registry.getTools()) {
    server.tool(
      tool.name,
      tool.description,
      toZodSchema(tool.parameters),
      async (args: Record<string, any>) => {
        const result = await tool.handler(args);
        return {
          content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }],
        };
      },
    );
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

// 提供 mcp Context 给 adapter 注册平台工具
plugin.provide({
  name: "mcp" as any,
  description: "MCP Tool Registry — adapter 通过此 Context 注册平台特有 MCP 工具",
  value: registry,
});

useContext("server" as any, (server: Server) => {
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
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed in stateless mode" },
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
    if (url === mcpPath || url.startsWith(mcpPath + "?") || url.startsWith(mcpPath + "/")) {
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
      server.on("request", listener as (...args: any[]) => void);
    }
  });
});

// 类型扩展：让 adapter 插件能 useContext('mcp') 获得类型提示
import type {} from "@zhin.js/http";
declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      mcp: McpToolRegistry;
      server: import("node:http").Server;
    }
  }
}
