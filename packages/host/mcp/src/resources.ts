import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * 资源列表定义（Plugin Runtime 文档面）
 */
export const resourceList = [
  {
    uri: 'zhin://docs/architecture',
    name: 'Zhin 架构文档',
    description: '分层架构与 Plugin Runtime',
  },
  {
    uri: 'zhin://docs/plugin-development',
    name: '插件开发指南',
    description: 'definePlugin + 约定目录',
  },
  {
    uri: 'zhin://docs/best-practices',
    name: '最佳实践',
    description: '导入、生命周期、发送链',
  },
  {
    uri: 'zhin://docs/command-system',
    name: '命令系统',
    description: 'defineCommand 与路径路由',
  },
  {
    uri: 'zhin://docs/component-system',
    name: '组件系统',
    description: 'defineComponent',
  },
  {
    uri: 'zhin://docs/context-system',
    name: '资源与 Scope',
    description: 'context.resources / lifecycle',
  },
  {
    uri: 'zhin://examples/basic-plugin',
    name: '基础插件示例',
    description: 'plugin.ts + commands/',
  },
  {
    uri: 'zhin://examples/command-plugin',
    name: '命令插件示例',
    description: '多命令约定目录',
  },
  {
    uri: 'zhin://examples/adapter',
    name: '适配器示例',
    description: 'defineAdapter 提示',
  },
] as const;

/**
 * 资源内容映射
 */
export const resourceContents: Record<string, string> = {
  'zhin://docs/architecture': `# Zhin 架构设计

唯一启动路径：\`zhin runtime start\`（Plugin Runtime）。

\`\`\`
basic → kernel → ai → core → agent → zhin
\`\`\`

- **创作面**：\`definePlugin\` + 约定目录（\`commands/\`、\`tools/\`…）
- **禁止新代码**：\`usePlugin\` / \`MessageCommand\` / \`bootstrapNode\`（\`zhin.js/node\`）
- 出站：\`Message.$reply\` / \`Adapter.sendMessage\` → \`before.sendMessage\` → Endpoint

详见仓库 \`AGENTS.md\`、\`docs/concepts/architecture.md\`。
`,

  'zhin://docs/plugin-development': `# 插件开发指南

\`\`\`typescript
// plugin.ts
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: 'hello-bot',
  metadata: { displayName: 'Hello Bot' },
  setup(context) {
    context.lifecycle.add(() => { /* cleanup */ });
  },
});
\`\`\`

\`\`\`typescript
// commands/hello/[name:string].ts — 路径即路由
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '打招呼',
  execute({ params }) {
    return \`Hello, \${params.name}!\`;
  },
});
\`\`\`

\`package.json#zhin\` 声明 \`entry\` / \`features\`。见 \`docs/getting-started/first-plugin.md\`。
`,

  'zhin://docs/best-practices': `# Zhin 开发最佳实践

1. 相对导入带 \`.js\` 扩展名
2. 清理走 \`context.lifecycle\`；禁止裸模块级单例（优先 \`createGenerationStore\`）
3. Host token 先 \`has\` 再 \`use\`
4. 出站不绕过统一发送链
5. 配置写 \`schema.json\`，用 \`context.config.get()\`
6. 新代码不要 \`usePlugin\` / \`MessageCommand\`
`,

  'zhin://docs/command-system': `# 命令系统（Plugin Runtime）

文件路径是路由 SSOT：

- \`commands/hello.ts\` → \`hello\`
- \`commands/hello/[name:string=world].ts\` → \`hello <name>\`
- \`commands/gh/issue/list.ts\` → \`gh issue list\`

\`\`\`typescript
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'echo',
  execute({ params, args }) {
    return args.join(' ') || String(params.text ?? '');
  },
});
\`\`\`

\`CommandContext\` 含 \`params\` / \`args\` / \`input?\` / \`scene?\` / \`sender?\`。
**不要**再写 \`new MessageCommand(...).action(...)\`。
`,

  'zhin://docs/component-system': `# 组件系统

\`\`\`typescript
// components/status.tsx
import { defineComponent } from 'zhin.js/component';

export default defineComponent({
  render() {
    return 'online';
  },
});
\`\`\`

IM JSX：\`jsxImportSource: "zhin.js"\`。
`,

  'zhin://docs/context-system': `# 资源与 Scope

\`\`\`typescript
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: 'svc',
  setup(context) {
    context.resources.provide(myToken, value, () => { /* dispose */ });
    // 消费：context.resources.has(token) && context.resources.use(token)
  },
});
\`\`\`

经典 \`provide\` / \`useContext\` / \`usePlugin\` 仅 legacy，新代码勿用。
`,

  'zhin://examples/basic-plugin': `import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: 'ping-bot',
  metadata: { displayName: 'Ping Bot' },
  setup() {},
});

// commands/ping.ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  execute: () => 'pong',
});
`,

  'zhin://examples/command-plugin': `// commands/echo/[text:string].ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '回声',
  execute({ params }) {
    return String(params.text ?? '');
  },
});

// commands/greet/[name:string=world].ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '问候',
  execute({ params }) {
    return \`你好，\${params.name}！\`;
  },
});
`,

  'zhin://examples/adapter': `import { defineAdapter } from 'zhin.js/adapter';

export default defineAdapter({
  name: 'my-platform',
  // Endpoint 工厂与 capabilities：对照 plugins/adapters/sandbox
});

// 同包 plugin.ts：definePlugin({ name: 'my-platform', ... })
`,
};

/**
 * 注册所有 MCP 资源
 */
export function registerResources(server: McpServer): void {
  for (const resource of resourceList) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
      },
      async (uri) => {
        const uriString = uri.toString();
        const content = resourceContents[uriString] || resourceContents[resource.uri];
        if (!content) {
          throw new Error(`Resource not found: ${uriString} (registered as ${resource.uri})`);
        }
        return {
          contents: [
            {
              uri: uriString,
              mimeType: 'text/markdown',
              text: content,
            },
          ],
        };
      },
    );
  }
}
