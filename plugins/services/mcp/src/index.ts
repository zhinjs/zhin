import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { } from '@zhin.js/http'
import { register, usePlugin, defineSchema, Schema, useContext } from "zhin.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

declare module "@zhin.js/types" {
  interface GlobalContext {
    mcpServer: McpServer;
  }
}

const plugin = usePlugin();

// 配置 Schema
const schema = defineSchema(
  Schema.object({
    enabled: Schema.boolean("enabled")
      .default(true)
      .description("是否启用 MCP Server"),
    path: Schema.string("path")
      .default("/mcp")
      .description("HTTP 端点路径"),
  })
);

const config = schema(plugin.config, "mcp");

// ============================================================================
// 创建 MCP Server
// ============================================================================

function createMCPServer(): McpServer {
  const server = new McpServer(
    {
      name: "zhin-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // 注册所有工具、资源和提示词
  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

// ============================================================================
// 注册 Context 并启动服务
// ============================================================================

let mcpServer: McpServer;
let cleanup: (() => void) | undefined;

mcpServer = createMCPServer();
register({
  name: "mcpServer",
  description: "MCP Server for Zhin development",
  async mounted(p) {
    if (!config.enabled) {
      p.logger.info("MCP Server is disabled");
      return null as any;
    }
    return mcpServer;
  },
  async dispose() {
    if (mcpServer) {
      await mcpServer.close();
    }
    if (cleanup) {
      cleanup();
    }
  },
});

// HTTP Stream 传输
useContext("router", (router) => {
  plugin.logger.info(`MCP Config: enabled=${config.enabled}, path=${config.path}`);
  const mcpPath = config.path || "/mcp";

  // 创建 StreamableHTTPServerTransport (无状态模式)
  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态模式
  });

  // 连接 transport
  mcpServer.connect(httpTransport).then(() => {
    plugin.logger.info(`✅ MCP Server started at ${mcpPath}`);
  }).catch((err) => {
    plugin.logger.error("Failed to connect HTTP transport:", err);
  });


  // 处理 GET 和 POST 请求
  router.get(mcpPath, async (ctx) => {
    await httpTransport.handleRequest(ctx.req, ctx.res);
  });

  router.post(mcpPath, async (ctx: any) => {
    await httpTransport.handleRequest(ctx.req, ctx.res, ctx.request.body);
  });

  cleanup = () => {
    httpTransport.close();
    plugin.logger.info("MCP Server HTTP transport closed");
  };
});

