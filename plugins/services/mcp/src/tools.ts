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

  // ============================================================================
  // AI 相关工具
  // ============================================================================

  server.registerTool(
    "ai_chat",
    {
      description: "与 AI 对话，获取智能回复",
      inputSchema: z.object({
        message: z.string().describe("用户消息"),
        systemPrompt: z.string().optional().describe("系统提示词（可选）"),
        model: z.string().optional().describe("模型名称（可选）"),
        provider: z.string().optional().describe("提供商名称（可选）"),
      }),
    },
    async (args) => {
      const { aiChat } = await import("./ai-handlers.js");
      const result = await aiChat(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "ai_agent",
    {
      description: "让 AI Agent 执行复杂任务，可使用工具（计算器、时间查询等）",
      inputSchema: z.object({
        task: z.string().describe("任务描述"),
        model: z.string().optional().describe("模型名称（可选）"),
      }),
    },
    async (args) => {
      const { aiAgent } = await import("./ai-handlers.js");
      const result = await aiAgent(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "ai_code_review",
    {
      description: "让 AI 审查代码，提供改进建议",
      inputSchema: z.object({
        code: z.string().describe("要审查的代码"),
        language: z.string().optional().describe("编程语言"),
        focus: z.string().optional().describe("审查重点（性能/安全/可读性/最佳实践）"),
      }),
    },
    async (args) => {
      const { aiCodeReview } = await import("./ai-handlers.js");
      const result = await aiCodeReview(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "ai_explain_code",
    {
      description: "让 AI 解释代码的功能和逻辑",
      inputSchema: z.object({
        code: z.string().describe("要解释的代码"),
        language: z.string().optional().describe("编程语言"),
        detail: z.enum(["brief", "detailed"]).optional().describe("解释详细程度"),
      }),
    },
    async (args) => {
      const { aiExplainCode } = await import("./ai-handlers.js");
      const result = await aiExplainCode(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "ai_generate_code",
    {
      description: "让 AI 根据需求生成代码",
      inputSchema: z.object({
        requirement: z.string().describe("功能需求描述"),
        language: z.string().optional().describe("目标编程语言"),
        framework: z.string().optional().describe("使用的框架"),
      }),
    },
    async (args) => {
      const { aiGenerateCode } = await import("./ai-handlers.js");
      const result = await aiGenerateCode(args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  server.registerTool(
    "ai_list_models",
    {
      description: "列出所有可用的 AI 模型",
    },
    async () => {
      const { aiListModels } = await import("./ai-handlers.js");
      const result = await aiListModels();
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );
}
