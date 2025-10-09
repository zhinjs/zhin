# 🏷️ 类型定义

Zhin.js 的 TypeScript 类型定义参考文档。

## 🎯 核心类型

### App 相关类型

```typescript
// 应用配置
interface AppConfig {
  bots?: BotConfig[]           // 机器人配置列表
  plugin_dirs?: string[]      // 插件目录列表
  plugins?: string[]          // 启用的插件列表
  disable_dependencies?: string[]  // 禁用的依赖列表
  debug?: boolean            // 调试模式
}

// 机器人配置
interface BotConfig {
  name: string               // 机器人名称
  context: string           // 适配器上下文名
  [key: string]: any        // 其他适配器特定配置
}

// 发送选项
interface SendOptions extends MessageChannel {
  context: string           // 适配器上下文
  bot: string              // 机器人名称
  content: SendContent      // 消息内容
}
```

### 消息相关类型

```typescript
// 消息接口
interface Message {
  id: string                    // 消息 ID
  adapter: string               // 适配器名称
  bot: string                   // 机器人名称
  content: MessageSegment[]     // 消息段数组
  sender: MessageSender         // 发送者信息
  channel: MessageChannel       // 频道信息
  timestamp: number             // 时间戳
  raw: string                   // 原始消息内容
  reply(content: SendContent, quote?: boolean|string): Promise<void>
}

// 消息段
interface MessageSegment {
  type: string                  // 段类型：text, image, at, face 等
  data: Record<string, any>     // 段数据
}

// 发送者信息
interface MessageSender {
  id: string      // 用户 ID
  name?: string   // 用户名（可选）
}

// 频道信息
interface MessageChannel {
  id: string      // 频道 ID
  type: 'private' | 'group' | 'channel'  // 频道类型
}

// 发送内容类型
type SendContent = MaybeArray<string | MessageSegment>
type MaybeArray<T> = T | T[]
```

## 🧩 插件相关类型

### 插件生命周期

```typescript
// 插件实例
interface Plugin {
  name: string                 // 插件名称
  filename: string            // 插件文件路径
  logger: Logger              // 日志记录器
  emit(event: string, ...args: any[]): void
  on(event: string, listener: Function): void
  off(event: string, listener: Function): void
}

// 日志记录器
interface Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}
```

### 命令相关类型

```typescript
// 消息命令
class MessageCommand {
  constructor(
    public template: string,                    // 命令模板
    public options: CommandOptions = {}         // 命令选项
  ) {}
  
  action(handler: ActionHandler): this
  async handle(message: Message): Promise<any>
}

// 命令选项
interface CommandOptions {
  at?: boolean                 // 是否需要@机器人
  [key: string]: any          // 其他选项
}

// 动作处理器
type ActionHandler = (message: Message, result: MatchResult) => Promise<any> | any

// 匹配结果
interface MatchResult {
  args: Record<string, any>    // 解析的参数
  params: Record<string, any>  // 原始参数
  remaining: string           // 剩余文本
}
```

### 上下文相关类型

```typescript
// 上下文定义
interface Context<T = any, P = any> {
  name: string                // 上下文名称
  description?: string        // 上下文描述
  value?: T                   // 上下文值
  mounted?: (plugin: P) => T | Promise<T>  // 挂载函数
  dispose?: (value: T) => void | Promise<void>  // 清理函数
}

// 副作用函数
type SideEffect<T extends (keyof GlobalContext)[]> = (
  ...args: Contexts<T>
) => void | Promise<void> | (() => void) | Promise<() => void>

// 上下文类型
type Contexts<T extends (keyof GlobalContext)[]> = {
  [K in keyof T]: GlobalContext[T[K]]
}
```

## 🔌 适配器相关类型

### 适配器基类

```typescript
// 适配器基类
abstract class Adapter {
  constructor(
    public name: string,
    private botFactory: (plugin: Plugin, config: BotConfig) => Bot
  ) {}
  
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  createBot(plugin: Plugin, config: BotConfig): Bot
}

// Bot 接口
interface Bot<T extends BotConfig = BotConfig> {
  connected: boolean
  config: T
  
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(options: SendOptions): Promise<void>
}
```

### 平台特定类型

```typescript
// ICQQ 配置
interface ICQQBotConfig extends BotConfig {
  name: string
  context: 'icqq'
  uin: number
  password?: string
  platform?: number
  log_level?: 'off' | 'info' | 'debug'
}

// KOOK 配置
interface KookBotConfig extends BotConfig {
  name: string
  context: 'kook'
  token: string
  mode: 'websocket' | 'webhook'
  logLevel?: 'off' | 'info' | 'debug'
  ignore?: 'bot' | 'none'
}

// OneBot 配置
interface OneBotBotConfig extends BotConfig {
  name: string
  context: 'onebot11'
  url: string
  access_token?: string
  options?: {
    heartbeat_interval?: number
    reconnect_interval?: number
  }
}
```

## 🎨 组件相关类型

### 组件定义

```typescript
// 组件定义
interface ComponentDefinition<T = any> {
  name: string
  props?: Record<string, PropDefinition>
  render: (props: T, context?: any) => string | MessageSegment[] | Promise<string | MessageSegment[]>
}

// 属性定义
interface PropDefinition {
  type: any
  default?: any
  required?: boolean
}

// 组件实例
interface Component {
  name: string
  render(props: any, context?: any): string | MessageSegment[]
}
```

## 🛠️ 工具类型

### 时间工具

```typescript
// 时间工具类
class Time {
  static formatTime(ms: number): string
  static formatTimeShort(ms: number): string
  static parseTime(timeStr: string): number
  static setTimezoneOffset(offset: number): void
  static getTimezoneOffset(): number
}
```

### 消息段工具

```typescript
// 消息段工具
interface SegmentUtils {
  (type: string, data: Record<string, any>): MessageSegment
  escape(text: string): string
}

declare const segment: SegmentUtils
```

## 🌍 全局类型扩展

### 全局上下文类型

```typescript
// 扩展全局上下文类型
declare module '@zhin.js/types' {
  interface GlobalContext {
    database: DatabaseService
    cache: CacheService
    http: HttpService
    // 添加更多服务类型...
  }
}
```

### 适配器消息类型

```typescript
// 扩展适配器消息类型
declare module '@zhin.js/types' {
  interface AdapterMessages {
    icqq: ICQQMessage
    kook: KookMessage
    onebot11: OneBotMessage
    // 添加更多适配器消息类型...
  }
}
```

## 🔧 泛型类型

### 条件类型

```typescript
// 条件类型示例
type IsString<T> = T extends string ? true : false

// 工具类型
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
type Required<T, K extends keyof T> = T & Required<Pick<T, K>>
```

### 映射类型

```typescript
// 映射类型示例
type Partial<T> = {
  [P in keyof T]?: T[P]
}

type Readonly<T> = {
  readonly [P in keyof T]: T[P]
}
```

## 📝 类型守卫

### 类型守卫函数

```typescript
// 消息类型守卫
function isGroupMessage(message: Message): message is Message & { channel: { type: 'group' } } {
  return message.channel.type === 'group'
}

function isPrivateMessage(message: Message): message is Message & { channel: { type: 'private' } } {
  return message.channel.type === 'private'
}

// 使用类型守卫
onMessage(async (message) => {
  if (isGroupMessage(message)) {
    // TypeScript 知道这是群消息
    console.log('群ID:', message.channel.id)
  }
})
```

## 🔗 相关链接

- [核心 API](./core.md)
- [插件 API](./plugin.md)
- [适配器 API](./adapter.md)
- [事件系统](./events.md)
