# @zhin.js/types

Zhin 机器人框架的 TypeScript 类型定义包，提供完整的类型系统支持，确保类型安全的开发体验。

## 核心特性

- 🎯 **完整类型覆盖**: 涵盖框架所有核心概念的类型定义
- 🔧 **灵活扩展**: 支持模块扩展和类型增强
- 🧩 **上下文系统**: 强大的依赖注入类型支持
- ⚡ **异步友好**: 完整的 Promise/异步操作类型支持
- 📦 **零依赖**: 纯类型定义，无运行时依赖

## 类型系统

### GlobalContext - 全局上下文接口

框架的核心类型扩展点，所有模块都可以通过模块声明扩展此接口：

```typescript
// 基础接口定义
export interface GlobalContext extends Record<string, any> {}

// 各模块扩展示例
declare module '@zhin.js/types' {
  interface GlobalContext {
    // HTTP 模块扩展
    koa: Koa
    router: Router
    server: Server
    
    // 数据库模块扩展  
    database: Database
    redis: Redis
    
    // 自定义扩展
    myService: MyService
  }
}
```

**使用场景：**
- 定义全局可用的服务
- 模块间类型共享
- 依赖注入类型声明
- IDE 智能提示支持

### MaybePromise - 异步兼容类型

表示一个值可能是同步值或异步 Promise，提供灵活的异步编程支持：

```typescript
export type MaybePromise<T> = T extends Promise<infer U> ? T|U : T|Promise<T>

// 使用示例
function flexibleAsync(): MaybePromise<string> {
  if (Math.random() > 0.5) {
    return 'sync result'
  }
  return Promise.resolve('async result')
}

// 处理 MaybePromise
async function handleResult(result: MaybePromise<string>) {
  const value = await Promise.resolve(result)
  console.log(value) // 始终是字符串
}
```

**应用场景：**
- 中间件函数返回值
- 生命周期钩子函数
- 配置加载函数
- 插件初始化函数

## 上下文系统类型

### ArrayItem - 数组元素类型提取

从数组类型中提取元素类型的工具类型：

```typescript
export type ArrayItem<T> = T extends Array<infer R> ? R : unknown

// 使用示例
type StringArray = string[]
type StringItem = ArrayItem<StringArray> // string

type NumberArray = number[]
type NumberItem = ArrayItem<NumberArray> // number

// 复杂类型示例
type UserArray = Array<{ id: number; name: string }>
type User = ArrayItem<UserArray> // { id: number; name: string }
```

### SideEffect - 副作用函数类型

定义上下文依赖的副作用函数，支持清理函数返回：

```typescript
export type SideEffect<A extends (keyof GlobalContext)[]> = 
  (...args: Contexts<A>) => MaybePromise<void | DisposeFn<Contexts<A>>>

// 使用示例
const databaseEffect: SideEffect<['database', 'config']> = 
  async (db, config) => {
    // 初始化数据库连接
    await db.connect(config.url)
    console.log('数据库已连接')
    
    // 返回清理函数
    return async (context) => {
      await db.disconnect()
      console.log('数据库连接已关闭')
    }
  }

// 无清理函数的副作用
const loggerEffect: SideEffect<['config']> = (config) => {
  console.log('Logger initialized with config:', config)
  // 不返回清理函数
}
```

### DisposeFn - 清理函数类型

定义资源清理函数的类型：

```typescript
export type DisposeFn<A> = (context: ArrayItem<A>) => MaybePromise<void>

// 使用示例
const cleanupDatabase: DisposeFn<Database[]> = async (db) => {
  await db.close()
  console.log('数据库已关闭')
}

const cleanupFile: DisposeFn<FileHandle[]> = (file) => {
  file.close()
  console.log('文件已关闭')
}
```

### Contexts - 上下文类型数组构建

从上下文键数组构建对应的上下文值类型数组：

```typescript
export type Contexts<CS extends (keyof GlobalContext)[]> = 
  CS extends [infer L, ...infer R] 
    ? R extends (keyof GlobalContext)[] 
      ? [ContextItem<L>, ...Contexts<R>] 
      : never[] 
    : never[]

// 内部工具类型
type ContextItem<L> = L extends keyof GlobalContext ? GlobalContext[L] : never

// 使用示例
declare module '@zhin.js/types' {
  interface GlobalContext {
    database: Database
    config: Config
    logger: Logger
  }
}

// 自动推导上下文类型
type MyContexts = Contexts<['database', 'config']> // [Database, Config]
type AllContexts = Contexts<['database', 'config', 'logger']> // [Database, Config, Logger]
```

## 实际使用示例

### 1. 模块类型扩展

```typescript
// 在你的模块中扩展全局上下文
declare module '@zhin.js/types' {
  interface GlobalContext {
    // HTTP 服务
    httpServer: {
      start(port: number): Promise<void>
      stop(): Promise<void>
    }
    
    // 缓存服务
    cache: {
      get<T>(key: string): T | undefined
      set<T>(key: string, value: T, ttl?: number): void
      delete(key: string): boolean
    }
    
    // 事件总线
    eventBus: {
      emit(event: string, ...args: any[]): void
      on(event: string, handler: Function): () => void
    }
  }
}
```

### 2. 插件开发类型支持

```typescript
import { SideEffect, MaybePromise } from '@zhin.js/types'

// 定义插件配置类型
interface MyPluginConfig {
  apiKey: string
  timeout: number
  retries?: number
}

// 定义插件服务类型
interface MyPluginService {
  request(url: string, options?: object): Promise<any>
  uploadFile(file: Buffer, filename: string): Promise<string>
}

// 扩展全局上下文
declare module '@zhin.js/types' {
  interface GlobalContext {
    myPlugin: MyPluginService
  }
}

// 实现副作用函数
const myPluginEffect: SideEffect<['config']> = async (config) => {
  const service: MyPluginService = {
    async request(url, options = {}) {
      // 实现请求逻辑
      return fetch(url, { 
        timeout: config.timeout,
        ...options 
      })
    },
    
    async uploadFile(file, filename) {
      // 实现上传逻辑
      return `https://cdn.example.com/${filename}`
    }
  }
  
  // 返回清理函数
  return async () => {
    console.log('MyPlugin service disposed')
  }
}
```

### 3. 中间件类型定义

```typescript
import { MaybePromise } from '@zhin.js/types'

// 定义中间件类型
type Middleware<T> = (
  context: T, 
  next: () => Promise<void>
) => MaybePromise<void>

// HTTP 中间件
type HttpMiddleware = Middleware<{
  request: Request
  response: Response
}>

// 消息中间件
type MessageMiddleware = Middleware<{
  message: Message
  user: User
}>

// 实现中间件
const authMiddleware: HttpMiddleware = async (ctx, next) => {
  const token = ctx.request.headers.authorization
  if (!token) {
    ctx.response.status = 401
    return
  }
  
  await next()
}

const rateLimitMiddleware: MessageMiddleware = async (ctx, next) => {
  const userId = ctx.user.id
  const isAllowed = await checkRateLimit(userId)
  
  if (isAllowed) {
    await next()
  } else {
    throw new Error('Rate limit exceeded')
  }
}
```

### 4. 生命周期钩子类型

```typescript
import { MaybePromise } from '@zhin.js/types'

// 定义生命周期钩子类型
interface LifecycleHooks {
  beforeMount?: () => MaybePromise<void>
  mounted?: () => MaybePromise<void>
  beforeUpdate?: () => MaybePromise<void>
  updated?: () => MaybePromise<void>
  beforeDestroy?: () => MaybePromise<void>
  destroyed?: () => MaybePromise<void>
}

// 实现组件
class Component implements LifecycleHooks {
  async beforeMount() {
    console.log('Component is about to mount')
  }
  
  mounted() {
    console.log('Component mounted')
    // 可以返回同步值
  }
  
  async beforeDestroy() {
    await this.cleanup()
    console.log('Component will be destroyed')
  }
  
  private async cleanup() {
    // 异步清理逻辑
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
```

### 5. 配置类型定义

```typescript
import { MaybePromise } from '@zhin.js/types'

// 定义配置加载器类型
type ConfigLoader<T> = (env: Record<string, string>) => MaybePromise<T>

// 应用配置类型
interface AppConfig {
  port: number
  database: {
    url: string
    pool: number
  }
  redis: {
    host: string
    port: number
  }
}

// 实现配置加载器
const loadConfig: ConfigLoader<AppConfig> = async (env) => {
  if (env.CONFIG_URL) {
    // 异步加载远程配置
    const response = await fetch(env.CONFIG_URL)
    return response.json()
  }
  
  // 同步返回默认配置
  return {
    port: parseInt(env.PORT || '3000'),
    database: {
      url: env.DATABASE_URL || 'sqlite://./data.db',
      pool: parseInt(env.DB_POOL || '10')
    },
    redis: {
      host: env.REDIS_HOST || 'localhost',
      port: parseInt(env.REDIS_PORT || '6379')
    }
  }
}
```

## 高级类型技巧

### 条件类型推导

```typescript
// 根据输入类型推导输出类型
type InferResult<T> = T extends Promise<infer U>
  ? U
  : T extends Array<infer V>
  ? V
  : T

type StringResult = InferResult<Promise<string>> // string
type NumberResult = InferResult<number[]> // number
type DirectResult = InferResult<boolean> // boolean
```

### 类型保护

```typescript
// 类型保护函数
function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return value && typeof (value as any).then === 'function'
}

// 使用类型保护
async function handleMaybePromise<T>(value: MaybePromise<T>): Promise<T> {
  if (isPromise(value)) {
    return await value
  }
  return value
}
```

### 工具类型组合

```typescript
// 组合多个工具类型
type OptionalPromise<T> = MaybePromise<T | undefined>
type ArrayOrSingle<T> = T | T[]
type ConfigValue<T> = OptionalPromise<ArrayOrSingle<T>>

// 使用组合类型
const loadPlugins: () => ConfigValue<string> = () => {
  // 可以返回：
  // - 'single-plugin'
  // - ['plugin1', 'plugin2'] 
  // - Promise.resolve('async-plugin')
  // - Promise.resolve(['async1', 'async2'])
  // - undefined
  return Math.random() > 0.5 ? 'plugin' : ['plugin1', 'plugin2']
}
```

## 类型系统最佳实践

1. **使用模块声明扩展全局类型**
2. **为异步操作使用 `MaybePromise`**
3. **合理使用条件类型和类型推导**
4. **提供完整的类型注解**
5. **避免使用 `any`，优先使用 `unknown`**

## 开发工具支持

- ✅ **VSCode**: 完整的 IntelliSense 支持
- ✅ **WebStorm**: 智能代码补全
- ✅ **TypeScript**: 严格的类型检查
- ✅ **ESLint**: TypeScript 规则支持

## 许可证

MIT License