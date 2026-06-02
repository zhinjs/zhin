import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createPlugin,
  createCommandCode,
  createComponentCode,
  createMiddlewareCode,
  createServiceCode,
  createToolCode,
  queryPlugin,
  listPlugins,
  createAdapterCode,
  createModelCode,
  listBots,
  listCommands,
  listServices,
  listTools,
  listEvents,
  simulateMessage,
  getPluginSource,
  sendMessage,
  recallMessage,
  getLogs,
  getConfig,
  reloadPlugin,
} from "./handlers.js";

export function registerTools(server: McpServer) {
  // ============================================================================
  // 脚手架工具 — 生成代码片段
  // ============================================================================

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
    async (args) => ({
      content: [{ type: "text" as const, text: await createPlugin(args) }],
    }),
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
    async (args) => ({
      content: [{ type: "text" as const, text: createCommandCode(args) }],
    }),
  );

  server.registerTool(
    "create_component",
    {
      description: "生成一个 Zhin 消息组件的代码",
      inputSchema: z.object({
        name: z.string().describe("组件名称"),
        props: z.record(z.string(), z.string()).describe("组件 props 定义（键为 prop 名，值为 TS 类型字符串）"),
        usesJsx: z.boolean().optional().describe("是否使用 JSX"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: createComponentCode(args) }],
    }),
  );

  server.registerTool(
    "create_middleware",
    {
      description: "生成一个 Zhin 消息中间件的代码片段（洋葱模型）",
      inputSchema: z.object({
        name: z.string().describe("中间件名称 (用于日志标识)"),
        description: z.string().describe("中间件功能描述"),
        hasFilter: z.boolean().optional().describe("是否包含消息过滤逻辑"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: createMiddlewareCode(args) }],
    }),
  );

  server.registerTool(
    "create_service",
    {
      description: "生成一个 Zhin 服务 (Context) 的代码片段，使用 provide() 注册",
      inputSchema: z.object({
        name: z.string().describe("服务名称 (将注册到 Plugin.Contexts)"),
        description: z.string().describe("服务描述"),
        hasDispose: z.boolean().optional().describe("是否需要 dispose 清理逻辑"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: createServiceCode(args) }],
    }),
  );

  server.registerTool(
    "create_tool",
    {
      description: "生成一个 ZhinTool 的代码片段（可同时作为命令和 AI 工具）",
      inputSchema: z.object({
        name: z.string().describe("工具名称"),
        description: z.string().describe("工具描述"),
        params: z.array(z.object({
          name: z.string().describe("参数名"),
          type: z.string().describe("参数类型 (string/number/boolean)"),
          description: z.string().describe("参数描述"),
          required: z.boolean().optional().describe("是否必需"),
        })).describe("工具参数列表"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: createToolCode(args) }],
    }),
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
    async (args) => ({
      content: [{ type: "text" as const, text: createAdapterCode(args) }],
    }),
  );

  server.registerTool(
    "create_model",
    {
      description: "生成 Zhin 数据库模型定义代码",
      inputSchema: z.object({
        name: z.string().describe("模型名称"),
        fields: z.record(z.string(), z.any()).describe("字段定义"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: createModelCode(args) }],
    }),
  );

  // ============================================================================
  // 运行时查询工具 — 了解当前运行状态
  // ============================================================================

  server.registerTool(
    "list_plugins",
    { description: "列出所有已加载的插件及其功能概况" },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(listPlugins(), null, 2) }],
    }),
  );

  server.registerTool(
    "query_plugin",
    {
      description: "查询指定插件的详细信息（命令、组件、中间件、Context 等）",
      inputSchema: z.object({
        pluginName: z.string().describe("插件名称"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: JSON.stringify(queryPlugin(args), null, 2) }],
    }),
  );

  server.registerTool(
    "list_services",
    { description: "列出所有已注册的 Context 服务（provide 注册的依赖注入）" },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(listServices(), null, 2) }],
    }),
  );

  server.registerTool(
    "list_tools",
    {
      description: "列出所有已注册的 ZhinTool（包含插件工具和适配器工具）",
      inputSchema: z.object({
        plugin_name: z.string().optional().describe("按插件名筛选（为空则返回全部）"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: JSON.stringify(listTools(args), null, 2) }],
    }),
  );

  server.registerTool(
    "list_events",
    { description: "列出 Zhin 插件可监听的生命周期事件和消息事件" },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(listEvents(), null, 2) }],
    }),
  );

  server.registerTool(
    "list_commands",
    { description: "列出所有已注册的命令（含模式、描述、用法）" },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(listCommands(), null, 2) }],
    }),
  );

  server.registerTool(
    "list_bots",
    { description: "列出所有连接的 Bot 及其状态（适配器、在线/离线）" },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(listBots(), null, 2) }],
    }),
  );

  server.registerTool(
    "get_plugin_source",
    {
      description: "读取指定插件的入口源码文件，方便参考和学习",
      inputSchema: z.object({
        pluginName: z.string().describe("插件名称"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: await getPluginSource(args) }],
    }),
  );

  // ============================================================================
  // 运行时操作工具 — 开发调试
  // ============================================================================

  server.registerTool(
    "simulate_message",
    {
      description: "模拟发送一条消息来测试命令，返回 Bot 的回复内容",
      inputSchema: z.object({
        content: z.string().describe("模拟的消息内容 (例如: 'ping' 或 'echo hello')"),
        adapter: z.string().optional().describe("适配器名称 (默认使用 sandbox)"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: await simulateMessage(args) }],
    }),
  );

  server.registerTool(
    "send_message",
    {
      description: "通过指定 Bot 发送消息到群组或私聊",
      inputSchema: z.object({
        adapter: z.string().describe("适配器名称 (如 icqq, discord)"),
        bot: z.string().describe("Bot 名称/ID"),
        target_id: z.string().describe("目标 ID (群号或用户 ID)"),
        target_type: z.enum(["private", "group", "channel"]).describe("目标类型"),
        content: z.string().describe("消息内容"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: await sendMessage(args) }],
    }),
  );

  server.registerTool(
    "recall_message",
    {
      description: "撤回/删除指定消息",
      inputSchema: z.object({
        adapter: z.string().describe("适配器名称 (如 icqq, discord)"),
        bot: z.string().describe("Bot 名称/ID"),
        message_id: z.string().describe("要撤回的消息 ID"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: await recallMessage(args) }],
    }),
  );

  server.registerTool(
    "get_logs",
    {
      description: "获取最近的系统日志",
      inputSchema: z.object({
        limit: z.number().optional().describe("返回条数（默认 50）"),
        level: z.string().optional().describe("日志级别筛选 (info/warn/error/all)"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await getLogs(args), null, 2) }],
    }),
  );

  server.registerTool(
    "get_config",
    {
      description: "获取当前运行配置（全部或指定插件）",
      inputSchema: z.object({
        plugin_name: z.string().optional().describe("插件名称（为空则返回全部配置）"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: JSON.stringify(getConfig(args), null, 2) }],
    }),
  );

  server.registerTool(
    "reload_plugin",
    {
      description: "热重载指定插件",
      inputSchema: z.object({
        name: z.string().describe("要重载的插件名称"),
      }),
    },
    async (args) => ({
      content: [{ type: "text" as const, text: await reloadPlugin(args) }],
    }),
  );
}
