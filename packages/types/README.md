# @zhin.js/types

Zhin 机器人框架的 TypeScript 核心类型定义包。

## 特性

- 🎯 **核心类型** - 提供框架的基础类型定义
- 🔧 **模块扩展** - 支持通过 TypeScript 模块扩展添加自定义类型
- 📚 **零依赖** - 纯类型定义，无运行时依赖
- 🚀 **类型安全** - 完整的 TypeScript 类型支持

## 安装

```bash
pnpm add @zhin.js/types
```

通常不需要单独安装，它已作为 peer dependency 包含在其他 Zhin 包中。

## 导出的类型

### MaybePromise\<T\>

表示可能是 Promise 的类型，既可以是同步值也可以是异步 Promise。

```typescript
type MaybePromise<T> = T extends Promise<infer U> ? T | U : T | Promise<T>
```

**使用示例：**

```typescript
import type { MaybePromise } from '@zhin.js/types'

// 函数可以返回同步或异步值
function getData(): MaybePromise<string> {
  if (cached) {
    return 'cached data'  // 同步返回
  }
  return fetch('/api/data')  // 异步返回
    .then(res => res.text())
}
```

### ArrayItem\<T\>

提取数组类型的元素类型。

```typescript
type ArrayItem<T> = T extends Array<infer R> ? R : unknown
```

**使用示例：**

```typescript
import type { ArrayItem } from '@zhin.js/types'

type Numbers = number[]
type Item = ArrayItem<Numbers>  // number
```

### RegisteredAdapters

注册的适配器类型映射接口，可通过模块扩展添加自定义适配器类型。

```typescript
interface RegisteredAdapters {}
```

**扩展示例：**

```typescript
// 定义你的适配器消息类型
interface MyAdapterMessage {
  id: string
  content: string
  userId: string
}

// 扩展注册的适配器
declare module '@zhin.js/types' {
  interface RegisteredAdapters {
    myAdapter: MyAdapterMessage
  }
}
```

### GlobalContext

全局上下文接口，继承自 `RegisteredAdapters`，可扩展添加全局服务。

```typescript
interface GlobalContext extends RegisteredAdapters, Record<string, any> {}
```

**扩展示例：**

```typescript
// 定义服务类型
interface MyService {
  doSomething(): string
}

// 扩展全局上下文
declare module '@zhin.js/types' {
  interface GlobalContext {
    myService: MyService
  }
}
```

### Models

数据模型类型映射接口，用于定义数据库模型类型。

```typescript
interface Models extends Record<string, object> {}
```

**扩展示例：**

```typescript
// 定义模型类型
interface User {
  id: number
  username: string
  email: string
}

interface Post {
  id: number
  title: string
  content: string
}

// 扩展模型类型
declare module '@zhin.js/types' {
  interface Models {
    User: User
    Post: Post
  }
}
```

### SideEffect\<A\>

副作用函数类型，用于 `useContext` 等 Hook 的回调函数。

```typescript
type SideEffect<A extends (keyof GlobalContext)[]> = (
  ...args: Contexts<A>
) => MaybePromise<void | DisposeFn<Contexts<A>>>
```

**使用示例：**

```typescript
import { useContext } from 'zhin.js'
import type { SideEffect } from '@zhin.js/types'

// 使用上下文，并返回清理函数
useContext(['myService'], (myService) => {
  // 使用服务
  myService.doSomething()
  
  // 返回清理函数
  return () => {
    // 清理资源
  }
})
```

### DisposeFn\<A\>

销毁函数类型，用于清理上下文资源。

```typescript
type DisposeFn<A> = (context: ArrayItem<A>) => MaybePromise<void>
```

### Contexts\<CS\>

上下文数组类型，用于从上下文名称数组推断具体的上下文类型。

```typescript
type Contexts<CS extends (keyof GlobalContext)[]> = 
  CS extends [infer L, ...infer R]
    ? R extends (keyof GlobalContext)[]
      ? [ContextItem<L>, ...Contexts<R>]
      : never[]
    : never[]
```

**使用示例：**

```typescript
// 自动推断上下文类型
useContext(['http', 'database'], (http, database) => {
  // http 和 database 的类型会自动推断
})
```

## 模块扩展

### 扩展适配器类型

```typescript
// adapter-types.d.ts
import '@zhin.js/types'

declare module '@zhin.js/types' {
  interface RegisteredAdapters {
    discord: DiscordMessage
    telegram: TelegramMessage
    qq: QQMessage
  }
}
```

### 扩展全局上下文

```typescript
// context-types.d.ts
import '@zhin.js/types'

declare module '@zhin.js/types' {
  interface GlobalContext {
    http: HttpService
    database: Database
    cache: CacheService
  }
}
```

### 扩展模型类型

```typescript
// model-types.d.ts
import '@zhin.js/types'

declare module '@zhin.js/types' {
  interface Models {
    User: User
    Post: Post
    Comment: Comment
  }
}
```

## 完整使用示例

```typescript
// types.d.ts
import '@zhin.js/types'

// 定义服务接口
interface HttpService {
  get(url: string): Promise<any>
  post(url: string, data: any): Promise<any>
}

interface Database {
  query(sql: string): Promise<any[]>
}

// 定义消息类型
interface DiscordMessage {
  id: string
  content: string
  channelId: string
  authorId: string
}

// 定义模型类型
interface User {
  id: number
  username: string
  email: string
}

// 扩展类型
declare module '@zhin.js/types' {
  interface GlobalContext {
    http: HttpService
    database: Database
  }
  
  interface RegisteredAdapters {
    discord: DiscordMessage
  }
  
  interface Models {
    User: User
  }
}
```

```typescript
// main.ts
import { useContext, onMessage, defineModel } from 'zhin.js'

// 使用扩展的类型
useContext(['http', 'database'], async (http, database) => {
  // http 和 database 都有完整的类型提示
  const data = await http.get('/api/users')
  await database.query('SELECT * FROM users')
})

// 消息处理有类型提示
onMessage(async (message) => {
  if (message.$adapter === 'discord') {
    // message 类型缩小为 DiscordMessage
    console.log(message.channelId)
  }
})

// 模型有类型提示
const UserModel = defineModel<User>('User', schema)
```

## TypeScript 配置

在 `tsconfig.json` 中确保正确配置：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "types": ["@zhin.js/types"]
  }
}
```

## 最佳实践

### 1. 集中管理类型定义

创建单独的类型文件：

```
src/
  types/
    adapters.d.ts
    contexts.d.ts
    models.d.ts
    index.d.ts
```

### 2. 使用命名空间组织类型

```typescript
declare module '@zhin.js/types' {
  namespace MyPlugin {
    interface Config {
      apiKey: string
      endpoint: string
    }
  }
  
  interface GlobalContext {
    myPlugin: MyPlugin.Config
  }
}
```

### 3. 导出复用类型

```typescript
// shared-types.ts
export interface BaseMessage {
  id: string
  content: string
  timestamp: number
}

// adapter-types.d.ts
import { BaseMessage } from './shared-types'

declare module '@zhin.js/types' {
  interface RegisteredAdapters {
    myAdapter: BaseMessage & {
      customField: string
    }
  }
}
```

## 相关资源

- [TypeScript 模块扩展](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)
- [Zhin 完整文档](https://docs.zhin.dev)
- [类型安全指南](https://docs.zhin.dev/guide/typescript)

## 许可证

MIT License
