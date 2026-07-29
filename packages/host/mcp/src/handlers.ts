import path from "node:path";
import fs from "node:fs/promises";
import { Adapter, Message, segment, usePlugin, type SendContent, type ConfigFeature } from '@zhin.js/core';

import type {} from "zhin.js";

const plugin = usePlugin();
const root = plugin.root;
const logger = plugin.logger;

// createPlugin 模板已迁移到新 Plugin Runtime 格式（definePlugin + 约定目录），
// 实现见 plugin-template.ts（无 usePlugin 副作用，可单测）。
export { createPlugin } from "./plugin-template.js";

/**
 * 生成命令代码（Plugin Runtime：`commands/` + `defineCommand`）。
 * `pattern` 仅作注释提示；文件路径才是路由 SSOT。
 */
export function createCommandCode(args: {
  pattern: string;
  description: string;
  hasPermission?: boolean;
}): string {
  const { pattern, description, hasPermission = false } = args;
  const slug = pattern
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase() || 'command';

  const permitNote = hasPermission
    ? `
  // 权限：在 zhin.config.yml endpoints[].master / trusted 配置，
  // 或中间件里读 context.input?.sender / scene 做场景校验。`
    : '';

  return `// 建议路径：commands/${slug}.ts（文件路径即命令路由；带参用 [name:string].ts）
// 经典模板「${pattern}」请改写为路径参数，勿再使用 MessageCommand。
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: ${JSON.stringify(description)},${permitNote}
  execute({ params, args }) {
    // 命令处理逻辑
    void params;
    void args;
    return '处理结果';
  },
});
`;
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
  const targetPlugin = root.children.find((p) => p.name === pluginName || p.filePath?.includes(pluginName));

  if (!targetPlugin) {
    throw new Error(`插件 ${pluginName} 不存在`);
  }

  return {
    name: targetPlugin.name,
    filename: targetPlugin.filePath,
    status: targetPlugin.started ? "active" : "inactive",
    commands: Array.from((targetPlugin as any).$commands || []),
    components: Array.from((targetPlugin as any).$components || []),
    middlewares: (targetPlugin as any).$middlewares?.size || 0,
    contexts: Array.from(targetPlugin.contexts?.keys() || []),
    crons: (targetPlugin as any).$crons?.size || 0,
  };
}

/**
 * 列出所有插件
 */
export function listPlugins(): any {
  return root.children.map((dep) => ({
    name: dep.name,
    status: "active",
    features: (dep as any).getFeatures?.() || [],
  }));
}

/**
 * 生成适配器代码
 */
/**
 * 生成适配器骨架（Plugin Runtime：`defineAdapter` + `plugin.ts`）。
 * 完整 Endpoint IO 请对照 `plugins/adapters/sandbox`。
 */
export function createAdapterCode(args: {
  name: string;
  description: string;
  hasWebhook?: boolean;
}): string {
  const { name, description, hasWebhook = false } = args;
  const webhookNote = hasWebhook
    ? `
// Webhook：在 Endpoint 的 open/start 里挂 httpHostToken.route(...)，
// 不要再用 useContext('router') / registerAdapter 经典路径。`
    : '';

  return `/**
 * ${description}
 * 建议：adapters/${name}.ts + 同包 plugin.ts（definePlugin）
 */
import { defineAdapter } from 'zhin.js/adapter';

export default defineAdapter({
  name: ${JSON.stringify(name)},
  // 在此声明 Endpoint 工厂、capabilities（inbound/outbound）等
  // 参考：plugins/adapters/sandbox/adapters/sandbox.ts
});
${webhookNote}
`;
}

/**
 * 生成数据库模型代码
 */
/**
 * 生成数据库模型装配提示（Plugin Runtime：`databaseHostToken` + schema）。
 */
export function createModelCode(args: {
  name: string;
  fields: Record<string, any>;
}): string {
  const { name, fields } = args;

  const fieldTypes: string[] = [];
  const fieldDefs: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    const typeDef = typeof value === 'string' ? value : value.type;
    fieldTypes.push(`    ${key}${value.nullable !== false ? '?' : ''}: ${getTypeScriptType(typeDef)};`);
    fieldDefs.push(`    ${key}: ${JSON.stringify(value)},`);
  }

  return `// 在 plugin.ts 的 setup 中装配（勿再 usePlugin / defineModel 经典路径）
import { definePlugin } from 'zhin.js/plugin-runtime';
import { databaseHostToken } from '@zhin.js/plugin-runtime'; // 以仓库实际导出为准

export default definePlugin({
  name: 'with-${name.toLowerCase()}',
  setup(context) {
    if (!context.resources.has(databaseHostToken)) return;
    const db = context.resources.use(databaseHostToken);
    // 行类型示意：
    // interface ${name}Row {
${fieldTypes.join('\n')}
    // }
    db.define?.('${name}', {
${fieldDefs.join('\n')}
    });
  },
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
 * 生成中间件代码（Plugin Runtime：`middlewares/` + `defineMiddleware`）。
 */
export function createMiddlewareCode(args: {
  name: string;
  description: string;
  hasFilter?: boolean;
}): string {
  const { name, description, hasFilter = false } = args;
  const ident = name.replace(/[^a-zA-Z0-9_]/g, '_') || 'middleware';

  if (hasFilter) {
    return `// 建议路径：middlewares/${ident}.ts
import { defineMiddleware } from 'zhin.js/middleware';

export default defineMiddleware({
  target: 'inbound',
  // ${description}
  async handle(context, next) {
    const input = context.input;
    if (input?.scene?.type !== 'group') {
      return next();
    }
    // 在这里添加处理逻辑
    return next();
  },
});
`;
  }

  return `// 建议路径：middlewares/${ident}.ts
import { defineMiddleware } from 'zhin.js/middleware';

export default defineMiddleware({
  target: 'inbound',
  // ${description}
  async handle(_context, next) {
    const start = Date.now();
    await next();
    // 处理耗时: Date.now() - start
    void start;
  },
});
`;
}

/**
 * 生成服务代码（Plugin Runtime：`context.resources.provide` + Token）。
 */
export function createServiceCode(args: {
  name: string;
  description: string;
  hasDispose?: boolean;
}): string {
  const { name, description, hasDispose = true } = args;
  const className = name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  const tokenName = `${name.replace(/[^a-zA-Z0-9]/g, '')}Token`;

  const disposeBlock = hasDispose
    ? `
  async close(): Promise<void> {
    // 清理资源
  }
`
    : '';

  const provideDispose = hasDispose
    ? `,
      () => { void service.close(); }`
    : '';

  return `// 在 plugin.ts setup 中装配（勿再用 provide / useContext 经典路径）
import { createToken, definePlugin } from 'zhin.js/plugin-runtime';

class ${className}Service {
  // ${description}
  async initialize(): Promise<void> {
    // 初始化逻辑
  }
${disposeBlock}}

export const ${tokenName} = createToken<${className}Service>(${JSON.stringify(name)});

export default definePlugin({
  name: ${JSON.stringify(name + '-service')},
  async setup(context) {
    const service = new ${className}Service();
    await service.initialize();
    context.resources.provide(${tokenName}, service${provideDispose});
  },
});

// 消费：context.resources.has(${tokenName}) && context.resources.use(${tokenName})
`;
}

/**
 * 生成 AI 工具代码（Plugin Runtime：`tools/` + `defineAgentTool`）。
 */
export function createToolCode(args: {
  name: string;
  description: string;
  params: { name: string; type: string; description: string; required?: boolean }[];
}): string {
  const { name, description, params } = args;
  const properties = params
    .map((p) => `    ${p.name}: { type: ${JSON.stringify(p.type)}, description: ${JSON.stringify(p.description)} },`)
    .join('\n');
  const required = params.filter((p) => p.required !== false).map((p) => p.name);
  const destructure = params.map((p) => p.name).join(', ');

  return `// 建议路径：tools/${name}.ts（package.json#zhin.features 需含 tool Feature）
import { defineAgentTool } from 'zhin.js/tool';

export default defineAgentTool({
  description: ${JSON.stringify(description)},
  inputSchema: {
    type: 'object',
    properties: {
${properties}
    },
    required: ${JSON.stringify(required)},
  },
  async execute({ ${destructure} }) {
    // 工具执行逻辑
    return \`结果: 请在此添加工具执行逻辑\`;
  },
});
`;
}

// ============================================================================
// 运行时工具 handlers
// ============================================================================

/**
 * 列出所有连接的 Endpoint 及状态
 */
export function listBots(): any[] {
  const endpoints: any[] = [];
  for (const adapterName of root.adapters) {
    const adapter = root.inject(adapterName);
    if (!(adapter instanceof Adapter)) continue;
    for (const [endpointId, endpoint] of adapter.endpoints.entries()) {
        endpoints.push({
          name: endpointId,
          adapter: adapterName,
          connected: endpoint.$connected || false,
          status: endpoint.$connected ? "online" : "offline",
        });
      }
  }
  return endpoints;
}

/**
 * 列出所有注册的命令
 */
export function listCommands(): any[] {
  const commandService = root.inject("command");
  if (!commandService?.items) return [];
  return commandService.items.map((cmd) => ({
    pattern: cmd.pattern || cmd.helpInfo?.pattern || String(cmd),
    description: cmd.helpInfo?.desc?.join(" ") || "",
    usage: cmd.helpInfo?.usage || [],
    examples: cmd.helpInfo?.examples || [],
  }));
}

/**
 * 通过指定 Endpoint 发送消息
 */
export async function sendMessage(args: {
  adapter: string;
  endpoint: string;
  target_id: string;
  target_type: "private" | "group" | "channel";
  content: string;
}): Promise<string> {
  const adapterInstance = root.inject(args.adapter);
  if (!(adapterInstance instanceof Adapter)) {
    throw new Error(`Adapter "${args.adapter}" not found`);
  }
  const msgId = await adapterInstance.sendMessage({
    context: args.adapter,
    endpoint: args.endpoint,
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
  endpoint: string;
  message_id: string;
}): Promise<string> {
  const adapterInstance = root.inject(args.adapter);
  if (!(adapterInstance instanceof Adapter)) {
    throw new Error(`Adapter "${args.adapter}" not found`);
  }
  const endpoint = adapterInstance.endpoints.get(args.endpoint);
  if (!endpoint) {
    throw new Error(`Endpoint "${args.endpoint}" not found in adapter "${args.adapter}"`);
  }
  await endpoint.$recallMessage(args.message_id);
  return `Message recalled (id: ${args.message_id})`;
}

/**
 * 获取最近 N 条日志
 */
export async function getLogs(args: {
  limit?: number;
  level?: string;
}): Promise<any[]> {
  const database = root.inject("database");
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
  const configService = root.inject("config") as ConfigFeature | undefined;
  if (!configService) throw new Error("Config service not available");

  const appConfig = configService.getPrimary() as Record<string, unknown>;
  if (args?.plugin_name) {
    return appConfig[args.plugin_name] ?? null;
  }
  return appConfig;
}

/**
 * 热重载指定插件
 */
export async function reloadPlugin(args: { name: string }): Promise<string> {
  const target = root.children.find((p) => p.name === args.name);
  if (!target) {
    throw new Error(`Plugin "${args.name}" not found`);
  }
  await root.reload(target);
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
  const toolService = root.inject("tool");

  if (args?.plugin_name && toolService) {
    const tools = toolService.getToolsByPlugin(args.plugin_name);
    return tools.map(formatTool);
  }

  if (toolService) {
    const tools = toolService.getAll();
    return tools.map(formatTool);
  }

  return [];
}

function formatTool(tool: any): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description || "",
    source: tool.source || "",
    tags: tool.tags || [],
    params: tool.params?.map((p: Record<string, unknown>) => ({
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

const { root, logger } = usePlugin();

root.on("context.mounted", (name) => {
  logger.info(\`服务 \${name} 已就绪\`);
});

// 监听消息（通过中间件；入站链走 root.middleware）:
root.addMiddleware(async (message, next) => {
  logger.info("收到消息:" + message.content);
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
    const adapterInstance = root.inject(adapterName);
    if (!(adapterInstance instanceof Adapter)) {
      return `❌ 适配器 "${adapterName}" 不可用。可用的适配器: ${Array.from(root.contexts.keys()).filter((k: string) => {
        const v = root.contexts.get(k)?.value;
        return v && typeof v === "object" && "endpoints" in v;
      }).join(", ") || "(无)"}`;
    }

    const endpoints = Array.from(adapterInstance.endpoints.entries());
    if (endpoints.length === 0) {
      return `❌ 适配器 "${adapterName}" 没有在线的 Endpoint`;
    }

    const firstEndpoint = endpoints[0];
    if (!firstEndpoint) {
      return `❌ 适配器 "${adapterName}" 没有在线的 Endpoint`;
    }
    const [endpointId] = firstEndpoint;

    // 构造模拟消息
    let reply = "";
    const ts = Date.now();
    const fakeMessage = Message.from(
      { content: args.content },
      {
        $id: `simulate-${ts}`,
        $adapter: adapterName as never,
        $endpoint: endpointId,
        $sender: { id: "mcp-tester", name: "MCP Tester" },
        $channel: { id: "mcp-tester", type: "private" },
        $content: [segment.text(args.content)],
        $raw: args.content,
        $timestamp: ts,
        $recall: async () => {},
        $reply: async (content: SendContent) => {
          reply = typeof content === "string" ? content : segment.raw(content);
          return `simulated-reply-${Date.now()}`;
        },
      },
    );

    // 通过根插件的 middleware chain 处理
    const middleware = root.middleware;
    if (typeof middleware === "function") {
      await middleware(fakeMessage, async () => {});
    }

    return reply
      ? `✅ Endpoint 回复:\n${reply}`
      : `⚠️ 命令 "${args.content}" 未产生回复（可能命令不存在或无匹配）`;
  } catch (error: unknown) {
    return `❌ 模拟失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 读取插件入口源码
 */
export async function getPluginSource(args: { pluginName: string }): Promise<string> {
  const target = root.children.find(
    (p) => p.name === args.pluginName || p.filePath?.includes(args.pluginName),
  );

  if (!target) {
    throw new Error(`插件 "${args.pluginName}" 不存在。可用插件: ${root.children.map((p) => p.name).join(", ")}`);
  }

  const filePath = target.filePath;
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
