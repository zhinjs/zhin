
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * 资源列表定义
 */
export const resourceList = [
  {
    uri: "zhin://docs/architecture",
    name: "Zhin 架构文档",
    description: "Zhin 框架的五层架构设计和核心概念",
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

Zhin.js 采用 **五层抽象** + 插件生态的分层架构：

## 五层架构

\`\`\`
zhin.js          — 应用入口：配置解析、Endpoint 连接、插件加载、信号处理
  ↓
@zhin.js/agent   — AI Agent 层：多模型编排、会话管理、工具调用、ZhinAgent
  ↓
@zhin.js/core    — IM 核心：Adapter / Endpoint / Message / Plugin / 命令 / 组件 / 中间件
  ↓
@zhin.js/ai      — AI 引擎：Provider 抽象、流式补全、Agent 循环
  ↓
@zhin.js/kernel  — 通用基座：PluginBase / HMR / 依赖注入 / 事件 / 配置
  ↓
basic/           — 零依赖原子库：segment / segment-matcher / schema / logger 等
\`\`\`

### 各层职责

- **basic/** — 无外部依赖的原子包，提供 segment 解析、模式匹配、Schema 验证、Logger 等
- **@zhin.js/kernel** — 通用插件基座，提供 \`PluginBase\`、HMR 热重载引擎、依赖注入 (\`provide\` / \`useContext\`)、事件广播
- **@zhin.js/ai** — AI 引擎层，抽象 LLM Provider 接口 (OpenAI/Anthropic/Ollama/DeepSeek 等)、流式 chat、Agent 循环
- **@zhin.js/core** — IM 核心层，继承 kernel 的 \`PluginBase\` 为 IM 特化的 \`Plugin\`，提供 Adapter/Endpoint/Message 抽象、命令系统、组件系统、中间件链
- **@zhin.js/agent** — AI Agent 编排层，组合 core + ai，提供 \`AIService\`、\`ZhinAgent\`、会话管理、上下文压缩、cron 引擎、子代理
- **zhin.js** — 应用入口包，负责配置解析、Endpoint 连接、插件加载、信号处理等启动流程

## 核心 API 风格

Zhin 采用 **函数式** API，在插件文件顶层调用：

\`\`\`typescript
import { usePlugin, provide, useContext, addCommand, MessageCommand } from 'zhin.js'

const { root, logger, onDispose } = usePlugin()

provide({
  name: 'myService',
  description: 'My custom service',
  async mounted() { return new MyService() },
  async dispose(svc) { svc.close() },
})

useContext('database', (db) => {
  logger.info('Database ready')
})

addCommand(
  new MessageCommand('hello <name:text>')
    .action(async (msg, result) => \`Hello, \${result.params.name}!\`)
)
\`\`\`
`,

  "zhin://docs/plugin-development": `# 插件开发指南

## 基础结构

插件文件通常放在 \`src/plugins/\` 或 \`plugins/\` 目录：

\`\`\`typescript
import { usePlugin, addCommand, MessageCommand } from 'zhin.js'

const { logger } = usePlugin()

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    return \`Hello, \${result.params.name}!\`
  })
)
\`\`\`

## 核心概念

1. **函数式依赖注入**: 使用 \`provide\` 注册服务，\`useContext\` 消费服务
2. **热重载 (HMR)**: 开发模式下文件修改自动重载插件
3. **命令系统**: 基于 segment-matcher 的模式匹配，支持类型化参数
4. **组件系统**: 支持 JSX 的消息组件，可用于富文本消息
5. **中间件**: 洋葱模型的消息处理管道

## 插件生命周期

\`\`\`
加载 → mounted → (运行中) → dispose → 卸载
                     ↑                    |
                     └────── reload ──────┘
\`\`\`

## 注册服务 (Context)

\`\`\`typescript
import { provide, useContext } from 'zhin.js'

provide({
  name: 'cache',
  description: 'In-memory cache',
  async mounted() {
    return new Map()
  },
  dispose(cache) {
    cache.clear()
  },
})

useContext('cache', (cache) => {
  cache.set('key', 'value')
})
\`\`\`

## 注册工具 (ZhinTool)

\`\`\`typescript
import { usePlugin, ZhinTool } from 'zhin.js'

const { addTool } = usePlugin()

addTool(
  new ZhinTool('weather')
    .description('查询天气')
    .param('city', 'string', '城市名', true)
    .execute(async ({ city }) => {
      const data = await fetchWeather(city)
      return \`\${city}: \${data.temp}°C, \${data.desc}\`
    })
)
\`\`\`
`,

  "zhin://docs/best-practices": `# Zhin 开发最佳实践

## 1. 导入路径
- 使用 \`.js\` 扩展名导入 TypeScript 文件
- 示例: \`import { foo } from './bar.js'\`

## 2. 资源清理
- 使用 \`onDispose\` 或 \`provide\` 的 \`dispose\` 回调释放资源
- 避免内存泄漏

## 3. 避免循环依赖
- 不要在 Context 注册中创建循环依赖
- 在 \`useContext\` 中消费依赖

## 4. 性能优化
- 避免监听大目录
- 精确配置扩展名
- 及时清理监听器

## 5. 配置管理
- 使用 \`root.inject('config').getPrimary()\` 读取主配置
- 配置变更通过 \`.set()\` 自动持久化

## 6. 数据库使用
- 使用 \`defineModel\` 定义模型
- 在 \`useContext('database', ...)\` 中访问数据库
- 声明 \`Models\` 接口获得类型支持
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

## 创建命令

\`\`\`typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(
  new MessageCommand('echo <text:text>')
    .desc('复读机')
    .usage('echo 你好')
    .examples('echo hello')
    .action(async (message, result) => {
      return result.params.text
    })
)
\`\`\`

## 权限控制

\`\`\`typescript
addCommand(
  new MessageCommand('admin-cmd')
    .permit((message) => message.$sender.isMaster === true)
    .action(async () => '仅管理员可用')
)
\`\`\`
`,

  "zhin://docs/component-system": `# 组件系统

## 定义组件

\`\`\`typescript
import { defineComponent, addComponent } from 'zhin.js'

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

addComponent(MyComp)
\`\`\`

## 使用组件

在命令或中间件中渲染组件消息：

\`\`\`typescript
addCommand(
  new MessageCommand('stats')
    .action(async () => {
      return <my-comp title="统计" count={42} />
    })
)
\`\`\`
`,

  "zhin://docs/context-system": `# Context 系统

Zhin 的 Context 系统是一个 **函数式依赖注入** 机制，允许插件注册和消费服务。

## 注册 Context

\`\`\`typescript
import { provide } from 'zhin.js'

provide({
  name: 'database',
  description: 'Database connection',
  async mounted() {
    const db = new Database()
    await db.connect()
    return db
  },
  async dispose(db) {
    await db.disconnect()
  }
})
\`\`\`

## 消费 Context

\`\`\`typescript
import { useContext } from 'zhin.js'

useContext('database', (db) => {
  // db 已经就绪
  db.query('SELECT 1')
})
\`\`\`

## 多 Context 依赖

\`\`\`typescript
useContext('database', 'cache', (db, cache) => {
  // 两个服务都就绪后才执行
})
\`\`\`

## 内置 Context

| 名称 | 类型 | 说明 |
|------|------|------|
| config | ConfigFeature | 配置管理 |
| database | DatabaseFeature | 数据库服务 |
| command | CommandFeature | 命令注册 |
| component | ComponentFeature | 组件注册 |
| server | http.Server | HTTP 服务器 |
| koa | Koa | Koa 应用实例 |
| router | Router | HTTP 路由器 |
| ai | AIService | AI 服务 |
`,

  "zhin://examples/basic-plugin": `import { usePlugin, addCommand, MessageCommand } from 'zhin.js'

const { logger } = usePlugin()

logger.info('基础插件已加载')

addCommand(
  new MessageCommand('ping')
    .desc('测试命令')
    .action(async () => {
      return 'pong!'
    })
)
`,

  "zhin://examples/command-plugin": `import { addCommand, MessageCommand, usePlugin } from 'zhin.js'

const { logger } = usePlugin()

addCommand(
  new MessageCommand('echo <text:text>')
    .desc('复读消息')
    .action(async (message, result) => {
      return result.params.text
    })
)

addCommand(
  new MessageCommand('greet [name:text]')
    .desc('打招呼')
    .action(async (message, result) => {
      const name = result.params.name || message.$sender.name || '朋友'
      return \`你好, \${name}!\`
    })
)
`,

  "zhin://examples/adapter": `import {
  Endpoint,
  Adapter,
  registerAdapter,
  Message,
  SendOptions,
  usePlugin,
  useContext,
} from "zhin.js";

const { logger } = usePlugin();

export interface MyEndpointConfig extends Endpoint.Config {
  context: "my-platform";
  name: string;
  token: string;
}

export class MyEndpoint implements Endpoint< MyEndpointConfig> {
  $config: MyEndpointConfig;
  $connected = false;

  constructor(config: MyEndpointConfig) {
    this.$config = config;
  }

  async $connect(): Promise<void> {
    this.$connected = true;
    logger.info(\`Bot \${this.$config.name} connected\`);
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  $formatMessage(raw: any): Message<any> {
    return Message.from({
      id: raw.id,
      type: "private",
      content: raw.text,
      $sender: { id: raw.userId, name: raw.userName },
      $reply: async (content) => {
        return await this.$sendMessage({
          context: this.$config.context,
          endpoint: this.$config.name,
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

  async $recallMessage(id: string): Promise<void> {}
}

registerAdapter(
  new Adapter("my-platform", (config: MyEndpointConfig) => new MyEndpoint(config))
);
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
