# 🧩 插件 API

Zhin.js 插件开发相关的 API 参考文档。

## 🎯 插件核心 API

### usePlugin
获取当前插件实例。

```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()
console.log('插件名称:', plugin.name)
console.log('插件文件:', plugin.filename)
```

### useLogger
获取插件专用的日志记录器。

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()
logger.info('插件信息')
logger.warn('插件警告')
logger.error('插件错误')
logger.debug('插件调试') // 仅在 debug: true 时显示
```

## 🔄 生命周期钩子

### onMounted
插件挂载完成时触发。

```typescript
import { onMounted } from 'zhin.js'

onMounted(() => {
  console.log('插件已挂载，可以安全使用其他服务')
})
```

### onDispose
插件销毁时触发，用于清理资源。

```typescript
import { onDispose } from 'zhin.js'

let timer: NodeJS.Timeout

onMounted(() => {
  timer = setInterval(() => {
    console.log('定时任务执行中...')
  }, 1000)
})

onDispose(() => {
  if (timer) {
    clearInterval(timer)
  }
  console.log('插件资源已清理')
})
```

## 💬 消息处理 API

### onMessage
监听所有消息。

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  console.log('收到消息:', message.$raw)
  console.log('发送者:', message.$sender.name)
  console.log('频道类型:', message.$channel.type)
})
```

### addCommand
添加命令处理器。

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

// 简单命令
addCommand(new MessageCommand('ping')
  .action(async () => {
    return 'pong'
  })
)

// 带参数的命令
addCommand(new MessageCommand('echo <text:text>')
  .action(async (message, result) => {
    return `回声: ${result.args.text}`
  })
)

// 带可选参数的命令
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.args.sides || 6
    const roll = Math.floor(Math.random() * sides) + 1
    return `掷出了 ${roll} 点！`
  })
)
```

### addMiddleware
添加消息中间件。

```typescript
import { addMiddleware } from 'zhin.js'

addMiddleware(async (message, next) => {
  const start = Date.now()
  console.log(`开始处理消息: ${message.$raw}`)
  
  await next()
  
  const duration = Date.now() - start
  console.log(`消息处理完成，耗时: ${duration}ms`)
})
```

## 🔧 上下文系统 API

### register
注册上下文服务。

```typescript
import { register } from 'zhin.js'

register({
  name: 'my-service',
  description: '我的自定义服务',
  async mounted(plugin) {
    // 初始化服务
    const service = new MyService()
    await service.initialize()
    return service
  },
  async dispose(service) {
    // 清理服务
    await service.cleanup()
  }
})
```

### useContext
使用上下文依赖。

```typescript
import { useContext } from 'zhin.js'

// 单个依赖
useContext('database', (db) => {
  addCommand(new MessageCommand('users')
    .action(async () => {
      const users = await db.query('SELECT * FROM users')
      return `用户数量: ${users.length}`
    })
  )
})

// 多个依赖
useContext('database', 'cache', (db, cache) => {
  addCommand(new MessageCommand('stats')
    .action(async () => {
      const dbStats = await db.getStats()
      const cacheStats = cache.getStats()
      return `数据库: ${dbStats}, 缓存: ${cacheStats}`
    })
  )
})
```

## 🧩 组件系统 API

### defineComponent
定义可复用组件。

```typescript
import { defineComponent, addComponent } from 'zhin.js'

const WeatherCard = defineComponent({
  name: 'weather-card',
  props: {
    city: String,
    temperature: Number,
    condition: String
  },
  async render(props) {
    return [
      `🌡️ **${props.city}天气**`,
      `温度：${props.temperature}°C`,
      `天气：${props.condition}`
    ].join('\n')
  }
})

addComponent(WeatherCard)
```

### addComponent
添加组件到全局。

```typescript
import { addComponent } from 'zhin.js'

addComponent(MyComponent)
```

## 📡 事件系统 API

### 消息事件
```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 处理所有消息
})

// 群消息
onMessage(async (message) => {
  if (message.$channel.type === 'group') {
    // 处理群消息
  }
})

// 私聊消息
onMessage(async (message) => {
  if (message.$channel.type === 'private') {
    // 处理私聊消息
  }
})
```

### 自定义事件
```typescript
import { usePlugin } from 'zhin.js'

const plugin = usePlugin()

// 监听自定义事件
plugin.on('custom-event', (data) => {
  console.log('收到自定义事件:', data)
})

// 触发自定义事件
plugin.emit('custom-event', { message: 'Hello' })
```

## 🛠️ 工具函数 API

### sendMessage
发送消息。

```typescript
import { sendMessage } from 'zhin.js'

await sendMessage({
  context: 'process',
  bot: `${process.pid}`,
  id: 'console',
  type: 'private',
  content: 'Hello World!'
})
```

### beforeSend
发送前处理钩子。

```typescript
import { beforeSend } from 'zhin.js'

beforeSend((options) => {
  // 为所有消息添加时间戳
  if (typeof options.content === 'string') {
    options.content = `[${new Date().toLocaleTimeString()}] ${options.content}`
  }
  return options
})
```

## 🔗 相关链接

- [核心 API](./core.md)
- [适配器 API](./adapter.md)
- [事件系统](./events.md)
- [类型定义](./types.md)
