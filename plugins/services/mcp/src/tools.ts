import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createPlugin,
  createCommandCode,
  createComponentCode,
  queryPlugin,
  listPlugins,
  createAdapterCode,
  createModelCode,
} from "./handlers.js";

/**
 * 注册所有 MCP 工具
 */
export function registerTools(server: McpServer) {
  server.registerTool(
    "create_plugin",
    {
      description: "创建一个新的 Zhin 插件文件，包含基础结构和示例代码",
      inputSchema: z.object({
        name: z.string().describe("插件名称 (例如: my-plugin)"),
        description: z.string().describe("插件描述"),
        features: z.array(z.string()).optional().describe("插件功能列表 (例如: ['command', 'middleware', 'component'])"),
        directory: z.string().optional().describe("插件保存目录 (相对于项目根目录)"),
      }),
    },
    async (args) => {
      const result = await createPlugin(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "create_command",
    {
      description: "生成一个 Zhin 命令的代码片段",
      inputSchema: z.object({
        pattern: z.string().describe("命令模式 (例如: 'hello <name:text>')"),
        description: z.string().describe("命令描述"),
        hasPermission: z.boolean().optional().describe("是否需要权限检查"),
      }),
    },
    async (args) => {
      const result = createCommandCode(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "create_component",
    {
      description: "生成一个 Zhin 消息组件的代码",
      inputSchema: z.object({
        name: z.string().describe("组件名称"),
        props: z.record(z.any()).describe("组件 props 定义"),
        usesJsx: z.boolean().optional().describe("是否使用 JSX"),
      }),
    },
    async (args) => {
      const result = createComponentCode(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "query_plugin",
    {
      description: "查询现有插件的信息、命令、组件等",
      inputSchema: z.object({
        pluginName: z.string().describe("插件名称"),
      }),
    },
    async (args) => {
      const result = queryPlugin(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "list_plugins",
    {
      description: "列出所有已加载的插件",
    },
    async () => {
      const result = listPlugins();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "create_adapter",
    {
      description: "创建一个新的 Zhin 适配器",
      inputSchema: z.object({
        name: z.string().describe("适配器名称 (例如: my-platform)"),
        description: z.string().describe("适配器描述"),
        hasWebhook: z.boolean().optional().describe("是否需要 Webhook 支持"),
      }),
    },
    async (args) => {
      const result = createAdapterCode(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "create_model",
    {
      description: "生成 Zhin 数据库模型定义代码",
      inputSchema: z.object({
        name: z.string().describe("模型名称"),
        fields: z.record(z.any()).describe("字段定义"),
      }),
    },
    async (args) => {
      const result = createModelCode(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );
}
