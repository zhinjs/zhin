import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {} from "@zhin.js/http";
import { usePlugin } from "zhin.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// 类型扩展 - 使用新的 @zhin.js/core 模式
declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      mcpServer: McpServer;
    }
  }
}

// MCP 配置接口
export interface McpConfig {
  enabled?: boolean;
  path?: string;
}

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

const { provide, root, useContext, logger } = usePlugin();

let httpTransport: StreamableHTTPServerTransport | undefined;

// 使用新的 provide() API 注册 mcpServer Context
provide({
  name: "mcpServer",
  description: "MCP Server for Zhin development",
  async mounted(p) {
    // 从配置服务获取配置
    const configService = root.inject("config")!;
    const appConfig = configService.get<{ mcp?: McpConfig }>("zhin.config.yml");
    const config = appConfig.mcp || {};
    const { enabled = true } = config;

    if (!enabled) {
      logger.info("MCP Server is disabled");
      return null as any;
    }

    const mcpServer = createMCPServer();
    return mcpServer;
  },
  async dispose(mcpServer) {
    if (mcpServer) {
      await mcpServer.close();
    }
    if (httpTransport) {
      httpTransport.close();
      logger.info("MCP Server HTTP transport closed");
    }
  },
});

// HTTP Stream 传输
useContext("router", "mcpServer", (router, mcpServer) => {
  if (!mcpServer) return;

  // 从配置服务获取配置
  const configService = root.inject("config")!;
  const appConfig = configService.get<{ mcp?: McpConfig }>("zhin.config.yml");
  const config = appConfig.mcp || {};
  const { enabled = true, path: mcpPath = "/mcp" } = config;

  logger.info(`MCP Config: enabled=${enabled}, path=${mcpPath}`);

  // 创建 StreamableHTTPServerTransport (无状态模式)
  httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态模式
  });

  // 连接 transport
  mcpServer
    .connect(httpTransport)
    .then(() => {
      logger.info(`✅ MCP Server started at ${mcpPath}`);
    })
    .catch((err) => {
      logger.error("Failed to connect HTTP transport:", err);
    });

  // 处理 GET 和 POST 请求
  router.get(mcpPath, async (ctx) => {
    await httpTransport!.handleRequest(ctx.req, ctx.res);
  });

  router.post(mcpPath, async (ctx: any) => {
    await httpTransport!.handleRequest(ctx.req, ctx.res, ctx.request.body);
  });
});

