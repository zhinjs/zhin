
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * 资源列表定义
 */
export const resourceList = [
  {
    uri: "zhin://docs/architecture",
    name: "Zhin 架构文档",
    description: "Zhin 框架的四层抽象设计和核心架构",
  },
  {
    uri: "zhin://docs/plugin-development",
    name: "插件开发指南",
    description: "如何开发 Zhin 插件的完整指南",
  },
  {
    uri: "zhin://docs/best-practices",
    name: "最佳实践",
    description: "Zhin 开发的最佳实践和常见模式",
  },
  {
    uri: "zhin://docs/command-system",
    name: "命令系统",
    description: "Zhin 命令系统的使用方法",
  },
  {
    uri: "zhin://docs/component-system",
    name: "组件系统",
    description: "Zhin 消息组件系统的使用方法",
  },
  {
    uri: "zhin://docs/context-system",
    name: "Context 系统",
    description: "函数式依赖注入和 Context 管理",
  },
  {
    uri: "zhin://examples/basic-plugin",
    name: "基础插件示例",
    description: "一个完整的基础插件示例",
  },
  {
    uri: "zhin://examples/command-plugin",
    name: "命令插件示例",
    description: "包含多个命令的插件示例",
  },
  {
    uri: "zhin://examples/adapter",
    name: "适配器示例",
    description: "如何实现一个平台适配器",
  },
] as const;

/**
 * 资源内容映射
 */
export const resourceContents: Record<string, string> = {
  "zhin://docs/architecture": `# Zhin 架构设计

Zhin.js 采用四层抽象设计：

## 四层架构
\`\`\`
App 层 (应用入口)
  ↓
HMR 层 (热重载引擎)
  ↓
Dependency 层 (依赖注入基类)
  ↓
Plugin 层 (业务逻辑)
\`\`\`

- **App**: 继承自 HMR，管理适配器、机器人实例、消息路由
- **HMR**: 组合 FileWatcher、ModuleLoader、PerformanceMonitor、ReloadManager
- **Dependency**: 提供生命周期管理、Context 系统、事件广播机制
- **Plugin**: 继承 Dependency，处理中间件、命令、组件
`,

  "zhin://docs/plugin-development": `# 插件开发指南

## 基础结构

插件文件通常放在 \`src/plugins/\` 目录：

\`\`\`typescript
import { addCommand, MessageCommand, useLogger } from 'zhin.js'

const logger = useLogger()

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    return \`Hello, \${result.params.name}!\`
  })
)
\`\`\`

## 核心概念

1. **函数式依赖注入**: 使用 \`register\` 和 \`useContext\`
2. **热重载**: 文件修改自动重载
3. **命令系统**: 基于 segment-matcher 的模式匹配
4. **组件系统**: 支持 JSX 的消息组件
`,

  "zhin://docs/best-practices": `# Zhin 开发最佳实践

## 1. 导入路径
- 使用 \`.js\` 扩展名导入 TypeScript 文件
- 示例: \`import { foo } from './bar.js'\`

## 2. 资源清理
- 在 \`dispose\` 或返回的清理函数中释放资源
- 避免内存泄漏

## 3. 避免循环依赖
- 不要在 Context 注册中创建循环依赖
- 在 \`useContext\` 中使用依赖

## 4. 性能优化
- 避免监听大目录
- 精确配置扩展名
- 及时清理监听器
`,

  "zhin://docs/command-system": `# 命令系统

## 命令模式

- \`<name:text>\`: 必需参数
- \`[name:text]\`: 可选参数
- \`[...items:at]\`: 可变参数

## 内置类型

- \`text\`: 文本
- \`number\`: 数字
- \`at\`: @提及
- \`image\`: 图片
- \`face\`: 表情
`,

  "zhin://docs/component-system": `# 组件系统

## 定义组件

\`\`\`typescript
import { defineComponent } from 'zhin.js'

const MyComp = defineComponent({
  name: 'my-comp',
  props: {
    title: String,
    count: Number,
  },
  render(props) {
    return \`\${props.title}: \${props.count}\`
  }
})
\`\`\`
`,

  "zhin://docs/context-system": `# Context 系统

## 注册 Context

\`\`\`typescript
import { register } from 'zhin.js'

register({
  name: 'database',
  async mounted(plugin) {
    const db = new Database()
    await db.connect()
    return db
  },
  async dispose(db) {
    await db.disconnect()
  }
})
\`\`\`
`,

  "zhin://examples/basic-plugin": `import { usePlugin, addCommand, MessageCommand } from 'zhin.js'

const plugin = usePlugin()

addCommand(
  new MessageCommand('ping')
    .description('测试命令')
    .action(async () => {
      return 'pong!'
    })
)
`,

  "zhin://examples/command-plugin": `import { addCommand, MessageCommand } from 'zhin.js'

addCommand(
  new MessageCommand('echo <text:text>')
    .action(async (message, result) => {
      return result.params.text
    })
)
`,

  "zhin://examples/adapter": `import {
  Bot,
  Adapter,
  registerAdapter,
  Message,
  SendOptions,
} from "zhin.js";

export class MyBot implements Bot<any, any> {
  async $connect(): Promise<void> {}
  async $disconnect(): Promise<void> {}
  $formatMessage(raw: any): Message<any> { return null as any; }
  async $sendMessage(options: SendOptions): Promise<string> { return ""; }
}
`,
};

/**
 * 注册所有 MCP 资源
 */
export function registerResources(server: McpServer) {
  resourceList.forEach((resource) => {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
      },
      async (uri) => {
        // URI 参数可能是 URL 对象或字符串，统一转换为字符串
        const uriString = uri.toString();
        const content = resourceContents[uriString] || resourceContents[resource.uri];
        if (!content) {
          throw new Error(`Resource not found: ${uriString} (registered as ${resource.uri})`);
        }
        return {
          contents: [
            {
              uri: uriString,
              mimeType: "text/markdown",
              text: content,
            },
          ],
        };
      }
    );
  });
}
