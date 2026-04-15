import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * 注册所有 MCP 提示词
 */
export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "create-plugin-workflow",
    {
      description: "创建 Zhin 插件的完整工作流程指导",
      argsSchema: {
        feature_type: z.string().describe("插件功能类型 (command/middleware/component/adapter)"),
      },
    },
    async (args) => ({
      description: `创建 ${args.feature_type} 类型的 Zhin 插件`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `我想创建一个 ${args.feature_type} 类型的 Zhin 插件，请指导我完整的开发流程。`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "debug-plugin",
    {
      description: "调试 Zhin 插件的步骤和技巧",
      argsSchema: {
        error_message: z.string().optional().describe("错误消息"),
      },
    },
    async (args) => ({
      description: "调试 Zhin 插件",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: args.error_message
              ? `我的插件遇到错误: ${args.error_message}`
              : "我想调试我的 Zhin 插件",
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "best-practices",
    {
      description: "Zhin 开发的最佳实践建议",
    },
    async () => ({
      description: "Zhin 开发最佳实践",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "请告诉我 Zhin 开发的最佳实践",
          },
        },
      ],
    })
  );
}
