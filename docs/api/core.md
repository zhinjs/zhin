# 🎯 核心 API

Zhin.js 核心功能的 API 参考文档。

## 📦 应用管理

### createApp
创建 Zhin 应用实例。

```typescript
import { createApp } from 'zhin.js'

// 使用默认配置
const app = await createApp()

// 使用自定义配置
const app = await createApp({
  bots: [{ name: 'my-bot', context: 'process' }],
  plugins: ['adapter-process', 'http']
})

await app.start()
```

### App 类
应用实例类，提供应用管理功能。

```typescript
class App {
  // 启动应用
  async start(): Promise<void>
  
  // 停止应用
  async stop(): Promise<void>
  
  // 发送消息
  async sendMessage(options: SendOptions): Promise<void>
  
  // 获取配置
  getConfig(): AppConfig
}
```

## 🧩 插件系统

### usePlugin
获取当前插件实例。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
console.log('插件名称:', plugin.name)
console.log('插件文件:', plugin.filename)
```

### useLogger
获取日志记录器。

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()
logger.info('信息日志')
logger.warn('警告日志')
logger.error('错误日志')
logger.debug('调试日志') // 仅在 debug: true 时显示
```

### onMounted
插件挂载完成回调。

```typescript
import { onMounted } from 'zhin.js'

onMounted(() => {
  console.log('插件已挂载')
})
```

### onDispose
插件销毁时回调。

```typescript
import { onDispose } from 'zhin.js'

onDispose(() => {
  console.log('插件即将销毁')
})
```

## 💬 消息处理

### onMessage
监听所有消息。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  console.log('收到消息:', message.raw)
  await message.reply('你好！')
})
```

### addCommand
添加命令处理器。

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return 'Hello World!'
  })
)
```

### addMiddleware
添加消息中间件。

```typescript
import { addMiddleware } from 'zhin.js'

addMiddleware(async (message, next) => {
  console.log('处理消息前')
  await next()
  console.log('处理消息后')
})
```

## 🔧 上下文系统

### register
注册上下文服务。

```typescript
import { register } from 'zhin.js'

register({
  name: 'my-service',
  description: '我的服务',
  async mounted(plugin) {
    // 初始化逻辑
    return serviceInstance
  },
  async dispose(service) {
    // 清理逻辑
  }
})
```

### useContext
使用上下文依赖。

```typescript
import { useContext } from 'zhin.js'

useContext('my-service', (service) => {
  // 服务就绪后执行
  console.log('服务已就绪:', service)
})
```

## 🎨 消息段工具

### segment
创建消息段。

```typescript
import { segment } from 'zhin.js'

// 文本消息段
segment('text', { text: 'Hello World' })

// 图片消息段
segment('image', { url: 'https://example.com/image.jpg' })

// @消息段
segment('at', { id: '123456789' })
```

### segment.escape
转义特殊字符。

```typescript
import { segment } from 'zhin.js'

const escaped = segment.escape('<这不是标签>')
```

## ⏰ 时间工具

### Time
时间格式化工具。

```typescript
import { Time } from 'zhin.js'

// 格式化时间
Time.formatTime(process.uptime() * 1000)    // "1天10小时17分36秒"
Time.formatTimeShort(3661000)               // "1h1m1s"

// 解析时间
Time.parseTime('1h30m')                     // 5400000 (毫秒)

// 时区设置
Time.setTimezoneOffset(480)                 // 设置时区偏移（分钟）
Time.getTimezoneOffset()                    // 获取当前时区偏移
```

## 🔗 相关链接

- [插件 API](./plugin.md)
- [适配器 API](./adapter.md)
- [事件系统](./events.md)
- [类型定义](./types.md)
