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
  // 命令系统
  addCommand(command: MessageCommand): () => void
  
  // 中间件
  addMiddleware(middleware: Function): () => void
  
  // 组件系统
  addComponent(component: Component): () => void
  
  // 数据库
  defineModel<K>(name: K, definition: Definition): void
  
  // 上下文
  useContext<T>(name: T, callback: (ctx: T) => void): void
  inject<T>(name: T): T | undefined
  
  // 服务
  provide(service: Service): void
  
  // 生命周期
  onMounted(callback: () => void): void
  onDispose(callback: () => void): void
  
  // 工具
  logger: Logger
  root: Plugin
  name: string
  filePath: string
}
```

## MessageCommand

命令类，用于创建和处理命令。

### 构造函数

```typescript
new MessageCommand(pattern: string)
```

### 方法

```typescript
// 设置描述
.desc(...desc: string[]): this

// 设置用法
.usage(...usage: string[]): this

// 设置示例
.examples(...examples: string[]): this

// 设置权限
.permit(...permissions: string[]): this

// 设置处理函数
.action(callback: (message, result) => SendContent): this
```

### 示例

```typescript
import { MessageCommand } from 'zhin.js'

const cmd = new MessageCommand('hello <name:string>')
  .desc('打招呼')
  .usage('hello <名字>')
  .examples('hello Alice')
  .action((message, result) => {
    return `你好，${result.params.name}！`
  })
```

## defineComponent

定义函数式组件。

```typescript
import { defineComponent } from 'zhin.js'

const MyComponent = defineComponent((props, context) => {
  return `Hello, ${props.name}!`
}, 'MyComponent')
```

### 组件上下文

```typescript
interface ComponentContext {
  props: Record<string, any>     // 组件属性
  children?: string              // 子组件内容
  parent?: ComponentContext      // 父组件上下文
  root: string                   // 根模板
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

### Cron 表达式

```
* * * * *
│ │ │ │ └─ 星期 (0-7)
│ │ │ └─── 月份 (1-12)
│ │ └───── 日期 (1-31)
│ └─────── 小时 (0-23)
└───────── 分钟 (0-59)
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
      email: string
    }
  }
}
```

### Plugin.Contexts

扩展上下文类型：

```typescript
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      myService: MyService
    }
  }
}
```

### RegisteredAdapters

扩展适配器类型：

```typescript
declare module 'zhin.js' {
  interface RegisteredAdapters {
    myAdapter: MyAdapter
  }
}
```

## 工具函数

### Time

时间处理工具：

```typescript
import { Time } from 'zhin.js'

// 格式化时间
Time.formatTime(ms: number): string

// 解析时间
Time.parseTime(str: string): number

// 格式化日期
Time.formatTimeShort(ms: number): string
```

### segment

消息段构造工具：

```typescript
import { segment } from 'zhin.js'

// 文本
segment.text(text: string)

// 表情
segment.face(id: string, text?: string)

// 图片
segment.image(url: string)

// At 某人
segment.at(userId: string)

// 转义
segment.escape(text: string)
segment.unescape(text: string)
```

## Logger

日志工具：

```typescript
import { logger } from 'zhin.js'

logger.debug('调试信息')
logger.info('普通信息')
logger.warn('警告信息')
logger.error('错误信息')
```

## Schema

配置验证：

```typescript
import { Schema } from 'zhin.js'

const schema = Schema.object({
  name: Schema.string().required(),
  age: Schema.number().min(0).max(120),
  email: Schema.string().pattern(/^.+@.+$/)
})
```
