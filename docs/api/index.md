# API 参考

Zhin.js 核心 API 文档。

## usePlugin()

获取当前插件实例，返回插件 API：

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
```

### 返回值

```typescript
{
  // ── 命令系统（CommandFeature 扩展）──
  addCommand(command: MessageCommand): () => void
  
  // ── 中间件 ──
  addMiddleware(middleware: MessageMiddleware): () => void
  
  // ── 组件系统（ComponentFeature 扩展）──
  addComponent(component: Component): () => void
  
  // ── 工具系统（ToolFeature 扩展）──
  addTool(input: Tool | ZhinTool, generateCommand?: boolean): () => void
  
  // ── 技能系统（SkillFeature 扩展）──
  declareSkill(metadata: SkillMetadata): void
  
  // ── 定时任务（CronFeature 扩展）──
  addCron(cron: Cron): () => void
  
  // ── 配置（ConfigFeature 扩展）──
  addConfig(key: string, defaultValue: any): void
  
  // ── 数据库（DatabaseFeature 扩展）──
  defineModel<K extends keyof Models>(name: K, definition: ModelDefinition): void
  
  // ── 上下文与服务 ──
  useContext(...contexts: string[], callback: Function): void
  inject<T>(name: string): T | undefined
  provide(service: ContextDefinition | Feature): void
  
  // ── 生命周期 ──
  onMounted(callback: () => void): void
  onDispose(callback: () => void): void
  
  // ── 工具属性 ──
  logger: Logger        // 日志对象
  root: Plugin          // 根插件实例
  name: string          // 插件名称
  filePath: string      // 插件文件路径
}
```

## MessageCommand

命令类，用于创建和处理命令。基于模式匹配（pattern matching）。

### 构造函数

```typescript
new MessageCommand(pattern: string)
```

**pattern 格式**：
- `hello` - 简单命令
- `echo <message:string>` - 必需参数
- `greet [name:string]` - 可选参数
- `say [...content:text]` - 剩余参数
- `add <a:number> <b:number>` - 多参数

### 方法

```typescript
// 设置描述
.desc(...desc: string[]): this

// 设置用法说明
.usage(...usage: string[]): this

// 设置示例
.examples(...examples: string[]): this

// 设置权限
.permit(...permissions: string[]): this

// 设置处理函数
.action(callback: (message: Message, result: MatchResult) => SendContent): this
```

## Feature

所有内置功能的抽象基类。

```typescript
abstract class Feature<T> {
  abstract readonly name: string
  abstract readonly icon: string
  abstract readonly desc: string
  
  // 添加项目
  add(item: T, pluginName: string): () => void
  
  // 移除项目
  remove(item: T): boolean
  
  // 按插件获取
  getByPlugin(pluginName: string): T[]
  
  // 序列化（HTTP API 使用）
  toJSON(pluginName?: string): FeatureJSON
  
  // 插件扩展方法（由 provide 自动注入到 Plugin.prototype）
  get extensions(): Record<string, Function>
}
```

### 内置 Feature 列表

| Feature | name | 插件扩展方法 | 说明 |
|---------|------|-------------|------|
| `CommandFeature` | `command` | `addCommand()` | 命令管理 |
| `ToolFeature` | `tool` | `addTool()` | AI 工具管理 |
| `SkillFeature` | `skill` | `declareSkill()` | AI 技能管理 |
| `ConfigFeature` | `config` | `addConfig()` | 配置管理 |
| `CronFeature` | `cron` | `addCron()` | 定时任务 |
| `PermissionFeature` | `permission` | `addPermission()` | 权限管理 |
| `DatabaseFeature` | `database` | `defineModel()` | 数据库 |
| `ComponentFeature` | `component` | `addComponent()` | 消息组件 |

## ToolFeature / ZhinTool

### ToolFeature 方法

```typescript
// 添加工具
addTool(input: Tool | ZhinTool, pluginName?: string, generateCommand?: boolean): () => void

// 获取工具
get(name: string): Tool | undefined

// 获取所有工具
getAll(): Tool[]

// 按标签获取
getByTags(tags: string[]): Tool[]

// 收集所有工具（含适配器）
collectAll(): Tool[]

// 按上下文过滤
filterByContext(tools: Tool[], context: ToolContext): Tool[]
```

### ZhinTool（链式 DSL）

```typescript
import { ZhinTool } from 'zhin.js'

new ZhinTool('tool_name')
  .desc('工具描述')
  .param('city', 'string', '城市名称', true)   // 必需参数
  .param('unit', 'string', '温度单位', false)   // 可选参数
  .platform('icqq')                             // 限定平台
  .scope('group')                               // 限定场景
  .permission('group_admin')                    // 权限要求
  .execute(async (args) => {                    // 执行函数
    return { temp: 25 }
  })
```

### Tool 接口

```typescript
interface Tool {
  name: string
  description: string
  parameters: JSONSchema         // JSON Schema 格式
  execute: (args: any, context?: ToolContext) => any
  
  // 可选字段
  source?: string               // 来源标识
  tags?: string[]               // 分类标签
  keywords?: string[]           // 触发关键词
  platforms?: string[]          // 限定平台
  scopes?: ToolScope[]          // 限定场景 ('private' | 'group' | 'channel')
  permissionLevel?: ToolPermissionLevel  // 权限要求
  hidden?: boolean              // 是否对 AI 隐藏
  command?: CommandConfig | false // 是否同时生成命令
}
```

### ToolContext 接口

```typescript
interface ToolContext {
  platform?: string             // 平台名（如 'icqq'、'discord'）
  botId?: string                // Bot ID
  sceneId?: string              // 场景 ID（群号/频道 ID）
  senderId?: string             // 发送者 ID
  scope?: 'private' | 'group' | 'channel'
  senderPermissionLevel?: ToolPermissionLevel
  message?: Message
  isGroupAdmin?: boolean
  isGroupOwner?: boolean
  isBotAdmin?: boolean
  isOwner?: boolean
}
```

## SkillFeature

### Skill 接口

```typescript
interface Skill {
  name: string                  // 技能名称
  description: string           // 技能描述
  tools: Tool[]                 // 包含的工具列表
  keywords?: string[]           // 触发关键词
  tags?: string[]               // 分类标签
  pluginName: string            // 来源插件
}
```

### SkillFeature 方法

```typescript
// 按名称获取
get(name: string): Skill | undefined

// 获取所有
getAll(): Skill[]

// 搜索（按关键词/标签匹配评分排序）
search(query: string, options?: { maxResults?: number }): Skill[]

// 收集所有 Skill 的工具（扁平化）
collectAllTools(): Tool[]
```

### SkillMetadata（declareSkill 参数）

```typescript
interface SkillMetadata {
  description: string           // 技能描述（必填）
  keywords?: string[]           // 触发关键词
  tags?: string[]               // 分类标签
}
```

## MessageDispatcher

消息调度器，管理消息的三阶段处理流程。

```typescript
// 创建调度器
const dispatcher = createMessageDispatcher(plugin)

// 添加守卫
dispatcher.addGuardrail(middleware): () => void

// 设置命令匹配器
dispatcher.setCommandMatcher(matcher: (message) => boolean): void

// 设置 AI 触发匹配器
dispatcher.setAITriggerMatcher(matcher: (message) => boolean): void

// 设置 AI 处理器
dispatcher.setAIHandler(handler: (message) => Promise<void>): void

// 是否已注册 AI 处理器
dispatcher.hasAIHandler(): boolean

// 调度消息
dispatcher.dispatch(message: Message): Promise<void>
```

## ZhinAgent

AI Agent 核心类，处理与大语言模型的交互。

```typescript
// 处理文本消息
agent.process(
  content: string,
  context: ToolContext,
  externalTools?: Tool[],
  onChunk?: OnChunkCallback
): Promise<OutputElement[]>

// 处理多模态消息（图片+文本）
agent.processMultimodal(
  parts: MultimodalPart[],
  context: ToolContext,
  onChunk?: OnChunkCallback
): Promise<OutputElement[]>

// 注册外部工具
agent.registerTool(tool: AgentTool): () => void

// 连接 SkillRegistry
agent.setSkillRegistry(registry: SkillFeature): void
```

## Adapter

适配器基类。

```typescript
abstract class Adapter<R extends Bot> {
  bots: Map<string, R>
  tools: Map<string, Tool>
  
  // 注册工具
  addTool(input: Tool | ZhinTool): () => void
  
  // 获取所有工具
  getTools(): Tool[]
  
  // 声明 Skill（聚合所有工具为一个 Skill）
  declareSkill(metadata: {
    description: string
    keywords?: string[]
    tags?: string[]
    conventions?: string   // 平台调用约定
  }): void
  
  // 启动/停止
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  
  // 发送消息
  sendMessage(options: SendOptions): Promise<string>
}
```

## defineComponent

定义函数式消息组件。

```typescript
import { defineComponent } from 'zhin.js'

const MyComponent = defineComponent((props, context) => {
  return `Hello, ${props.name}!`
}, 'MyComponent')
```

### ComponentContext

```typescript
interface ComponentContext {
  props: Record<string, any>
  children?: string
  parent?: ComponentContext
  root: string
  render(template: string): Promise<SendContent>
  getValue(template: string): any
  compile(template: string): string
}
```

## Cron

定时任务类。

```typescript
import { Cron } from 'zhin.js'

const task = new Cron('0 8 * * *', () => {
  console.log('早上好')
})
```

## 类型扩展

### Models

扩展数据库模型类型：

```typescript
declare module 'zhin.js' {
  interface Models {
    users: {
      id: number
      name: string
    }
  }
}
```

### Plugin.Contexts

扩展上下文/服务类型：

```typescript
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyServiceType
    }
  }
}
```

### Adapters

扩展适配器类型：

```typescript
declare module 'zhin.js' {
  interface Adapters {
    myAdapter: MyAdapter
  }
}
```

## 工具函数

### segment

消息段构造工具：

```typescript
import { segment } from 'zhin.js'

segment.text(text: string)
segment.face(id: string, text?: string)
segment.image(url: string)
segment.at(userId: string)
segment.escape(text: string)
segment.unescape(text: string)
segment.raw(content: MessageSegment[]): string  // 消息段转原始文本
```

### Logger

日志工具：

```typescript
import { logger } from 'zhin.js'

logger.debug('调试信息')
logger.info('普通信息')
logger.warn('警告信息')
logger.error('错误信息')
```

### Schema

配置验证：

```typescript
import { Schema } from 'zhin.js'

const schema = Schema.object({
  name: Schema.string().required(),
  age: Schema.number().min(0).max(120),
  email: Schema.string().pattern(/^.+@.+$/)
})
```

### ToolPermissionLevel

工具权限级别枚举：

```typescript
type ToolPermissionLevel = 
  | 'user'          // 普通用户（默认）
  | 'group_admin'   // 群管理员
  | 'group_owner'   // 群主
  | 'bot_admin'     // 机器人管理员
  | 'owner'         // 机器人拥有者
```
