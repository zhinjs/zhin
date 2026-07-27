import path from "node:path";
import fs from "node:fs/promises";

const pluginNamePattern = /^[a-z][a-z0-9-]*$/;

/**
 * 创建插件（新 Plugin Runtime 格式：`plugin.ts` definePlugin + 约定目录）。
 */
export async function createPlugin(args: {
  name: string;
  description: string;
  features?: string[];
  directory?: string;
}): Promise<string> {
  const { name, description, features = [], directory = "src/plugins" } = args;

  const files = generatePluginFiles(name, description, features);
  const pluginDir = path.resolve(process.cwd(), directory, name);

  // 防止路径遍历：确保插件目录在项目目录内
  const projectRoot = process.cwd() + path.sep;
  if (!pluginDir.startsWith(projectRoot)) {
    throw new Error(`安全错误：禁止在项目目录之外创建文件`);
  }

  try {
    for (const [relativePath, code] of Object.entries(files)) {
      const fullPath = path.join(pluginDir, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, code, "utf-8");
    }
    return `✅ 插件 ${name} 已创建: ${pluginDir}`;
  } catch (error: unknown) {
    throw new Error(`创建插件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 生成新格式插件文件树（相对路径 → 文件内容）：
 * - `plugin.ts` 默认导出 `definePlugin`；
 * - 命令/中间件/组件走约定目录（`commands/`、`middlewares/`、`components/`），
 *   分别默认导出 `defineCommand` / `defineMiddleware` / `defineComponent`。
 */
export function generatePluginFiles(
  name: string,
  description: string,
  features: string[] = [],
): Record<string, string> {
  if (!pluginNamePattern.test(name)) {
    throw new Error(`插件名 ${name} 不合法：须匹配 ${pluginNamePattern.source}`);
  }

  const files: Record<string, string> = {
    "plugin.ts": generatePluginEntry(name, description, features.includes("database")),
  };

  if (features.includes("command")) {
    files[`commands/${name}.ts`] = `import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '${description}',
  execute({ args }) {
    const content = args.join(' ');
    return \`你说: \${content}\`;
  },
});
`;
  }

  if (features.includes("middleware")) {
    files[`middlewares/${name}.ts`] = `import { defineMiddleware } from '@zhin.js/middleware';

export default defineMiddleware({
  // ${description}
  async handle(_context, next) {
    await next();
  },
});
`;
  }

  if (features.includes("component")) {
    files[`components/${name}.ts`] = `import { defineComponent } from 'zhin.js/component';

export default defineComponent<{ title?: string; content?: string }>({
  render(props) {
    return \`【\${props.title ?? ''}】\${props.content ?? ''}\`;
  },
});
`;
  }

  return files;
}

function generatePluginEntry(name: string, description: string, withDatabase: boolean): string {
  // 用插值拼装说明符，避免架构层级检查把模板字符串误判为本包真实 import
  const spec = 'zhin.js/plugin-runtime';
  const imports = withDatabase
    ? `import { definePlugin, databaseHostToken } from '${spec}';`
    : `import { definePlugin } from '${spec}';`;

  const setupBody = withDatabase
    ? `  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const db = context.resources.use(databaseHostToken);
      db.define('${name}_data', {
        name: { type: 'text', nullable: false },
        created_at: { type: 'timestamp', default: () => new Date() },
      });
    }
  },`
    : "";

  return `/**
 * ${description}
 * @name ${name}
 */
${imports}

export default definePlugin({
  name: '${name}',
  metadata: { displayName: '${name}' },
${setupBody ? `${setupBody}\n` : ""}});
`;
}
