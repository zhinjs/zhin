import path from "node:path";
import fs from "node:fs/promises";
import { usePlugin } from "zhin.js";

const plugin = usePlugin();
const root = plugin.root;

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
  const fullPath = path.join(process.cwd(), directory, filename);
  
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
    status: dep.$mounted ? "active" : "inactive",
    commandCount: dep.$commands?.size || 0,
    componentCount: dep.$components?.size || 0,
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

declare module "@zhin.js/types" {
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
