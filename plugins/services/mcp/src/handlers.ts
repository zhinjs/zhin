import path from "node:path";
import fs from "node:fs/promises";
import { usePlugin } from "zhin.js";

const plugin = usePlugin();
const root = plugin.root;
const logger = plugin.logger;

/**
 * 创建插件文件
 */
export async function createPlugin(args: {
  name: string;
  description: string;
  features?: string[];
  directory?: string;
}): Promise<string> {
  const { name, description, features = [], directory = "src/plugins" } = args;
  
  const pluginCode = generatePluginCode(name, description, features);
  const filename = `${name}.ts`;
  const fullPath = path.resolve(process.cwd(), directory, filename);
  
  // 防止路径遍历：确保文件在项目目录内
  const projectRoot = process.cwd() + path.sep;
  if (!fullPath.startsWith(projectRoot)) {
    throw new Error(`安全错误：禁止在项目目录之外创建文件`);
  }
  
  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, pluginCode, "utf-8");
    return `✅ 插件 ${name} 已创建: ${fullPath}`;
  } catch (error) {
    throw new Error(`创建插件失败: ${(error as Error).message}`);
  }
}

function generatePluginCode(
  name: string,
  description: string,
  features: string[]
): string {
  const imports: string[] = ["usePlugin"];
  
  if (features.includes("command")) {
    imports.push("addCommand", "MessageCommand");
  }
  if (features.includes("middleware")) {
    imports.push("addMiddleware");
  }
  if (features.includes("component")) {
    imports.push("addComponent", "defineComponent");
  }
  if (features.includes("context")) {
    imports.push("useContext");
  }
  // database 功能通过 plugin.defineModel 和 useContext 实现，不需要额外导入
  
  let result = `/**
 * ${description}
 * @name ${name}
 */
import { ${imports.join(", ")} } from "zhin.js";

const plugin = usePlugin();
plugin.logger.info("插件 ${name} 已加载");

`;

  if (features.includes("command")) {
    result += `// 示例命令
addCommand(
  new MessageCommand("${name} <content:text>")
    .description("${description}")
    .action(async (message, result) => {
      const content = result.params.content;
      plugin.logger.info(\`收到命令: \${content}\`);
      return \`你说: \${content}\`;
    })
);

`;
  }

  if (features.includes("middleware")) {
    result += `// 示例中间件
addMiddleware(async (message, next) => {
  plugin.logger.info(\`消息来自: \${message.$sender.name}\`);
  await next();
});

`;
  }

  if (features.includes("component")) {
    result += `// 示例组件
const MyComponent = defineComponent({
  name: "my-comp",
  props: {
    title: String,
    content: String,
  },
  render(props) {
    return \`【\${props.title}】\${props.content}\`;
  },
});

addComponent(MyComponent);

`;
  }

  if (features.includes("database")) {
    result += `// 示例数据模型
declare module "zhin.js" {
  interface Models {
    ${name}_data: {
      id?: number;
      name: string;
      created_at?: Date;
    };
  }
}

const { defineModel, useContext } = plugin;

defineModel("${name}_data", {
  name: { type: "text", nullable: false },
  created_at: { type: "timestamp", default: () => new Date() },
});

useContext("database", async (db) => {
  const model = db.models.get("${name}_data");
  if (model) {
    plugin.logger.info("数据库已就绪");
  }
});

`;
  }

  return result;
}

/**
 * 生成命令代码
 */
export function createCommandCode(args: {
  pattern: string;
  description: string;
  hasPermission?: boolean;
}): string {
  const { pattern, description, hasPermission = false } = args;
  
  let code = `import { addCommand, MessageCommand } from "zhin.js";

addCommand(
  new MessageCommand("${pattern}")
    .description("${description}")`;

  if (hasPermission) {
    code += `
    .permit((message) => {
      // 权限检查逻辑
      return message.$sender.role === "admin";
    })`;
  }

  code += `
    .action(async (message, result) => {
      // 命令处理逻辑
      const args = result.params;
      return "处理结果";
    })
);
`;

  return code;
}

/**
 * 生成组件代码
 */
export function createComponentCode(args: {
  name: string;
  props: Record<string, string>;
  usesJsx?: boolean;
}): string {
  const { name, props, usesJsx = false } = args;
  
  const propsObj = Object.entries(props)
    .map(([key, type]) => `    ${key}: ${type},`)
    .join("\n");

  if (usesJsx) {
    return `import { defineComponent } from "zhin.js";

const ${name} = defineComponent({
  name: "${name}",
  props: {
${propsObj}
  },
  render(props) {
    return (
      <text>
        {/* 在这里使用 props 渲染内容 */}
      </text>
    );
  },
});

export default ${name};
`;
  }

  return `import { defineComponent } from "zhin.js";

const ${name} = defineComponent({
  name: "${name}",
  props: {
${propsObj}
  },
  render(props) {
    return \`\${props.title}: \${props.content}\`;
  },
});

export default ${name};
`;
}

/**
 * 查询插件信息
 */
export function queryPlugin(args: { pluginName: string }): any {
  const { pluginName } = args;
  // 在子插件树中查找
  const targetPlugin = root.children.find((p: any) => p.name === pluginName || p.$filename?.includes(pluginName));
  
  if (!targetPlugin) {
    throw new Error(`插件 ${pluginName} 不存在`);
  }
  
  const p = targetPlugin as any;
  return {
    name: p.name,
    filename: p.$filename || p.filename,
    status: p.$mounted ? "active" : "inactive",
    commands: Array.from(p.$commands || []),
    components: Array.from(p.$components || []),
    middlewares: p.$middlewares?.size || 0,
    contexts: Array.from(p.contexts?.keys() || []),
    crons: p.$crons?.size || 0,
  };
}

/**
 * 列出所有插件
 */
export function listPlugins(): any {
  return root.children.map((dep: any) => ({
    name: dep.name,
    status: "active",
    features: dep.getFeatures?.() || [],
  }));
}

/**
 * 生成适配器代码
 */
export function createAdapterCode(args: {
  name: string;
  description: string;
  hasWebhook?: boolean;
}): string {
  const { name, description, hasWebhook = false } = args;
  const className = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  
  let code = `/**
 * ${description}
 */
import {
  Bot,
  Adapter,
  registerAdapter,
  Message,
  SendOptions,
  segment,
  usePlugin,
} from "zhin.js";

declare module "zhin.js" {
  interface RegisteredAdapters {
    "${name}": Adapter<${className}Bot>;
  }
}

export interface ${className}Config extends Bot.Config {
  context: "${name}";
  name: string;
  apiKey?: string;
}

export class ${className}Bot implements Bot<any, ${className}Config> {
  $config: ${className}Config;
  $connected: boolean = false;

  constructor(config: ${className}Config) {
    this.$config = config;
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  $formatMessage(raw: any): Message<any> {
    return Message.from({
      id: raw.id,
      type: "private",
      content: raw.text,
      $sender: {
        id: raw.userId,
        name: raw.userName,
      },
      $reply: async (content) => {
        return await this.$sendMessage({
          context: this.$config.context,
          bot: this.$config.name,
          id: raw.userId,
          type: "private",
          content,
        });
      },
    });
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    return "message-id";
  }

  async $recallMessage(id: string): Promise<void> {
    // 实现消息撤回逻辑
  }
}

`;

  if (hasWebhook) {
    code += `import { useContext } from "zhin.js";

useContext("router", (router) => {
  registerAdapter(
    new Adapter("${name}", (config: ${className}Config) => {
      const bot = new ${className}Bot(config);
      
      router.post("/webhook/${name}", async (ctx) => {
        const raw = ctx.request.body;
        const message = bot.$formatMessage(raw);
        bot.emit?.("message", message);
        ctx.body = { success: true };
      });
      
      return bot;
    })
  );
});
`;
  } else {
    code += `registerAdapter(
  new Adapter("${name}", (config: ${className}Config) => new ${className}Bot(config))
);
`;
  }

  return code;
}

/**
 * 生成数据库模型代码
 */
export function createModelCode(args: {
  name: string;
  fields: Record<string, any>;
}): string {
  const { name, fields } = args;
  
  const fieldTypes: string[] = [];
  const fieldDefs: string[] = [];
  
  for (const [key, value] of Object.entries(fields)) {
    const typeDef = typeof value === "string" ? value : value.type;
    fieldTypes.push(`    ${key}${value.nullable !== false ? "?" : ""}: ${getTypeScriptType(typeDef)};`);
    fieldDefs.push(`    ${key}: ${JSON.stringify(value)},`);
  }

  return `import { usePlugin } from "zhin.js";

// 声明模型类型
declare module "zhin.js" {
  interface Models {
    ${name}: {
${fieldTypes.join("\n")}
    };
  }
}

const plugin = usePlugin();
const { defineModel, useContext } = plugin;

// 定义模型结构
defineModel("${name}", {
${fieldDefs.join("\n")}
});

// 数据库就绪后使用模型
useContext("database", async (db) => {
  const model = db.models.get("${name}");
  if (model) {
    // 在这里使用模型
    // 例如: const items = await model.select();
  }
});
`;
}

function getTypeScriptType(dbType: string): string {
  const typeMap: Record<string, string> = {
    text: "string",
    integer: "number",
    real: "number",
    boolean: "boolean",
    json: "any",
    timestamp: "Date",
    date: "Date",
  };
  return typeMap[dbType] || "any";
}

// ============================================================================
// 新增脚手架工具 handlers
// ============================================================================

/**
 * 生成中间件代码
 */
export function createMiddlewareCode(args: {
  name: string;
  description: string;
  hasFilter?: boolean;
}): string {
  const { name, description, hasFilter = false } = args;

  let code = `import { usePlugin } from "zhin.js";

const { addMiddleware, logger } = usePlugin();

`;

  if (hasFilter) {
    code += `addMiddleware(function ${name}(message, next) {
  // ${description}
  if (message.type !== "group") {
    return next();
  }

  logger.info(\`[${name}] 处理消息: \${message.content}\`);

  // 在这里添加处理逻辑

  return next();
});
`;
  } else {
    code += `addMiddleware(function ${name}(message, next) {
  // ${description}
  const start = Date.now();

  return next().then(() => {
    const cost = Date.now() - start;
    logger.info(\`[${name}] 处理耗时: \${cost}ms\`);
  });
});
`;
  }

  return code;
}

/**
 * 生成服务代码
 */
export function createServiceCode(args: {
  name: string;
  description: string;
  hasDispose?: boolean;
}): string {
  const { name, description, hasDispose = true } = args;
  const className = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  let code = `import { provide, useContext } from "zhin.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      ${name}: ${className}Service;
    }
  }
}

class ${className}Service {
  // ${description}

  async initialize(): Promise<void> {
    // 初始化逻辑
  }
`;

  if (hasDispose) {
    code += `
  async close(): Promise<void> {
    // 清理资源
  }
`;
  }

  code += `}

provide({
  name: "${name}",
  description: "${description}",
  async mounted() {
    const service = new ${className}Service();
    await service.initialize();
    return service;
  },`;

  if (hasDispose) {
    code += `
  async dispose(service) {
    await service.close();
  },`;
  }

  code += `
});

// 在其他插件中消费此服务:
// useContext("${name}", (${name}Service) => {
//   ${name}Service.doSomething();
// });
`;

  return code;
}

/**
 * 生成 ZhinTool 代码
 */
export function createToolCode(args: {
  name: string;
  description: string;
  params: { name: string; type: string; description: string; required?: boolean }[];
}): string {
  const { name, description, params } = args;

  const paramLines = params
    .map((p) => {
      const req = p.required !== false ? "true" : "false";
      return `    .param("${p.name}", "${p.type}", "${p.description}", ${req})`;
    })
    .join("\n");

  const destructureArgs = params.map((p) => p.name).join(", ");

  return `import { usePlugin, ZhinTool } from "zhin.js";

const { addTool } = usePlugin();

addTool(
  new ZhinTool("${name}")
    .description("${description}")
${paramLines}
    .execute(async ({ ${destructureArgs} }) => {
      // 工具执行逻辑
      return \`结果: TODO\`;
    })
);
`;
}

// ============================================================================
// 运行时工具 handlers
// ============================================================================

/**
 * 列出所有连接的 Bot 及状态
 */
export function listBots(): any[] {
  const { Adapter } = require("zhin.js");
  const bots: any[] = [];
  for (const adapterName of root.adapters) {
    const adapter = root.inject(adapterName as any);
    if (adapter instanceof Adapter) {
      for (const [botName, bot] of (adapter as any).bots.entries()) {
        bots.push({
          name: botName,
          adapter: adapterName,
          connected: bot.$connected || false,
          status: bot.$connected ? "online" : "offline",
        });
      }
    }
  }
  return bots;
}

/**
 * 列出所有注册的命令
 */
export function listCommands(): any[] {
  const commandService = root.inject("command" as any) as any;
  if (!commandService?.items) return [];
  return commandService.items.map((cmd: any) => ({
    pattern: cmd.pattern || cmd.helpInfo?.pattern || String(cmd),
    description: cmd.helpInfo?.desc?.join(" ") || "",
    usage: cmd.helpInfo?.usage || [],
    examples: cmd.helpInfo?.examples || [],
  }));
}

/**
 * 通过指定 Bot 发送消息
 */
export async function sendMessage(args: {
  adapter: string;
  bot: string;
  target_id: string;
  target_type: "private" | "group" | "channel";
  content: string;
}): Promise<string> {
  const { Adapter } = require("zhin.js");
  const adapterInstance = root.inject(args.adapter as any);
  if (!adapterInstance || !(adapterInstance instanceof Adapter)) {
    throw new Error(`Adapter "${args.adapter}" not found`);
  }
  const msgId = await (adapterInstance as any).sendMessage({
    context: args.adapter,
    bot: args.bot,
    id: args.target_id,
    type: args.target_type,
    content: args.content,
  });
  return `Message sent (id: ${msgId})`;
}

/**
 * 撤回/删除指定消息
 */
export async function recallMessage(args: {
  adapter: string;
  bot: string;
  message_id: string;
}): Promise<string> {
  const { Adapter } = require("zhin.js");
  const adapterInstance = root.inject(args.adapter as any);
  if (!adapterInstance || !(adapterInstance instanceof Adapter)) {
    throw new Error(`Adapter "${args.adapter}" not found`);
  }
  const bot = (adapterInstance as any).bots.get(args.bot);
  if (!bot) {
    throw new Error(`Bot "${args.bot}" not found in adapter "${args.adapter}"`);
  }
  await bot.$recallMessage(args.message_id);
  return `Message recalled (id: ${args.message_id})`;
}

/**
 * 获取最近 N 条日志
 */
export async function getLogs(args: {
  limit?: number;
  level?: string;
}): Promise<any[]> {
  const database = root.inject("database" as any) as any;
  if (!database) throw new Error("Database service not available");

  const LogModel = database.models?.get("SystemLog");
  if (!LogModel) throw new Error("SystemLog model not available");

  const limit = args.limit || 50;
  let selection = LogModel.select();
  if (args.level && args.level !== "all") {
    selection = selection.where({ level: args.level });
  }

  const logs = await selection.orderBy("timestamp", "DESC").limit(limit);
  return logs.map((log: any) => ({
    level: log.level,
    name: log.name,
    message: log.message,
    source: log.source,
    timestamp:
      log.timestamp instanceof Date
        ? log.timestamp.toISOString()
        : log.timestamp,
  }));
}

/**
 * 获取当前运行配置
 */
export function getConfig(args?: { plugin_name?: string }): any {
  const configService = root.inject("config" as any) as any;
  if (!configService) throw new Error("Config service not available");

  const appConfig = configService.get("zhin.config.yml");
  if (args?.plugin_name) {
    return appConfig[args.plugin_name] || null;
  }
  return appConfig;
}

/**
 * 热重载指定插件
 */
export async function reloadPlugin(args: { name: string }): Promise<string> {
  const target = root.children.find((p: any) => p.name === args.name);
  if (!target) {
    throw new Error(`Plugin "${args.name}" not found`);
  }
  await root.reload(target as any);
  return `Plugin "${args.name}" reloaded successfully`;
}

// ============================================================================
// 新增运行时查询 handlers
// ============================================================================

/**
 * 列出所有已注册的 Context 服务
 */
export function listServices(): any[] {
  const contexts = root.contexts;
  const result: any[] = [];
  for (const [name, ctx] of contexts) {
    result.push({
      name,
      description: ctx.description || "",
      hasValue: ctx.value !== undefined && ctx.value !== null,
      type: ctx.value ? typeof ctx.value : "unknown",
    });
  }
  return result;
}

/**
 * 列出所有已注册的 ZhinTool
 */
export function listTools(args?: { plugin_name?: string }): any[] {
  const toolService = root.inject("tool" as any) as any;

  if (args?.plugin_name && toolService?.getToolsByPlugin) {
    const tools = toolService.getToolsByPlugin(args.plugin_name);
    return tools.map(formatTool);
  }

  if (toolService?.getAll) {
    const tools = toolService.getAll();
    return tools.map(formatTool);
  }

  return [];
}

function formatTool(tool: any): any {
  return {
    name: tool.name,
    description: tool.description || "",
    source: tool.source || "",
    tags: tool.tags || [],
    params: tool.params?.map((p: any) => ({
      name: p.name,
      type: p.type,
      description: p.description || "",
      required: p.required ?? true,
    })) || [],
  };
}

/**
 * 列出可监听的事件
 */
export function listEvents(): any {
  return {
    lifecycle: [
      { name: "mounted", description: "插件挂载完成" },
      { name: "dispose", description: "插件卸载" },
      { name: "before-start", description: "插件启动前" },
      { name: "started", description: "插件启动后" },
      { name: "before-mount", description: "子插件挂载前" },
      { name: "before-dispose", description: "子插件卸载前" },
      { name: "context.mounted", description: "Context 服务就绪" },
      { name: "context.dispose", description: "Context 服务销毁" },
    ],
    message: [
      { name: "before.sendMessage", description: "发送消息前触发" },
      { name: "call.recallMessage", description: "撤回消息时触发" },
    ],
    usage: `// 监听事件示例:
import { usePlugin } from "zhin.js";
const { root, onDispose } = usePlugin();

root.on("context.mounted", (name) => {
  console.log(\`服务 \${name} 已就绪\`);
});

// 监听消息（通过中间件）:
const { addMiddleware } = usePlugin();
addMiddleware(async (message, next) => {
  console.log("收到消息:", message.content);
  await next();
});`,
  };
}

/**
 * 模拟发送消息测试命令
 */
export async function simulateMessage(args: {
  content: string;
  adapter?: string;
}): Promise<string> {
  const adapterName = args.adapter || "sandbox";

  try {
    const { Adapter } = require("zhin.js");
    const adapterInstance = root.inject(adapterName as any);
    if (!adapterInstance || !(adapterInstance instanceof Adapter)) {
      return `❌ 适配器 "${adapterName}" 不可用。可用的适配器: ${Array.from(root.contexts.keys()).filter((k: string) => {
        const v = root.contexts.get(k)?.value;
        return v && typeof v === "object" && "bots" in v;
      }).join(", ") || "(无)"}`;
    }

    const bots = Array.from((adapterInstance as any).bots.entries());
    if (bots.length === 0) {
      return `❌ 适配器 "${adapterName}" 没有在线的 Bot`;
    }

    const [botName, bot] = bots[0] as [string, any];

    // 构造模拟消息
    const { Message } = require("zhin.js");
    let reply = "";
    const fakeMessage = Message.from({
      id: `simulate-${Date.now()}`,
      type: "private" as const,
      content: args.content,
      $sender: { id: "mcp-tester", name: "MCP Tester" },
      $reply: async (content: string) => {
        reply = content;
        return `simulated-reply-${Date.now()}`;
      },
    });

    // 通过根插件的 middleware chain 处理
    const middleware = (root as any).middleware;
    if (typeof middleware === "function") {
      await middleware(fakeMessage, async () => {});
    }

    return reply
      ? `✅ Bot 回复:\n${reply}`
      : `⚠️ 命令 "${args.content}" 未产生回复（可能命令不存在或无匹配）`;
  } catch (error) {
    return `❌ 模拟失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 读取插件入口源码
 */
export async function getPluginSource(args: { pluginName: string }): Promise<string> {
  const target = root.children.find(
    (p: any) => p.name === args.pluginName || p.filePath?.includes(args.pluginName),
  );

  if (!target) {
    throw new Error(`插件 "${args.pluginName}" 不存在。可用插件: ${root.children.map((p: any) => p.name).join(", ")}`);
  }

  const filePath = (target as any).filePath;
  if (!filePath) {
    throw new Error(`插件 "${args.pluginName}" 没有文件路径信息`);
  }

  // 尝试找到 .ts 源文件
  const possiblePaths = [
    filePath.replace(/\.js$/, ".ts"),
    filePath.replace(/\/lib\//, "/src/").replace(/\.js$/, ".ts"),
    filePath,
  ];

  for (const p of possiblePaths) {
    try {
      const content = await fs.readFile(p, "utf-8");
      return `// 文件: ${p}\n// 行数: ${content.split("\n").length}\n\n${content}`;
    } catch {
      continue;
    }
  }

  throw new Error(`无法读取插件 "${args.pluginName}" 的源文件 (尝试路径: ${possiblePaths.join(", ")})`);
}
