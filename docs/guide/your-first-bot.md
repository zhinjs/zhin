# 你的第一个机器人

通过这个教程，你将学会创建一个功能完整的机器人插件。

## 插件基础

Zhin.js 中的插件就是一个 TypeScript 文件，使用框架提供的 API 来添加功能。

### 创建插件文件

在 `src/plugins/` 目录下创建 `my-plugin.ts`：

```typescript
import {
  addCommand,
  MessageCommand,
  useLogger
} from 'zhin.js'

const logger = useLogger()

logger.info('我的插件已加载')
```

保存文件后，框架会自动加载插件，你会看到日志输出。

## 添加命令

命令是机器人最基本的功能。让我们添加一个简单的命令：

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

// 添加一个 hello 命令
addCommand(new MessageCommand('hello')
  .action(async (message) => {
    return '你好！我是机器人'
  })
)
```

现在在控制台输入 `hello`，机器人会回复 "你好！我是机器人"。

### 带参数的命令

命令可以接收参数：

```typescript
// 骰子命令，可指定骰子面数（扩展示例）
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.params.sides || 6
    const roll = Math.floor(Math.random() * sides) + 1
    return `🎲 你掷出了 ${roll} 点！（${sides} 面骰子）`
  })
)
```

> **注意：** 这是一个扩展示例，CLI 生成的代码中不包含此命令。你需要手动添加到插件中。

测试命令：

```bash
> roll
< 🎲 你掷出了 3 点！（6 面骰子）

> roll 20
< 🎲 你掷出了 15 点！（20 面骰子）
```

### 命令参数类型

支持多种参数类型：

```typescript
// 字符串参数
addCommand(new MessageCommand('say <text...>')
  .action(async (message, result) => {
    return result.params.text.join(' ')
  })
)

// 数字参数
addCommand(new MessageCommand('add <a:number> <b:number>')
  .action(async (message, result) => {
    const sum = result.params.a + result.params.b
    return `${result.params.a} + ${result.params.b} = ${sum}`
  })
)

// At 参数（仅特定平台）
addCommand(new MessageCommand('赞 [...users:at]')
  .scope('icqq')  // 仅在 ICQQ 适配器生效
  .action(async (message, result) => {
    const users = result.params.users || [message.$sender.id]
    return `已为 ${users.length} 位用户点赞`
  })
)
```

## 获取系统信息

让我们创建一个系统状态命令：

```typescript
import { addCommand, MessageCommand, useApp, Adapter } from 'zhin.js'
import * as os from 'node:os'

// 格式化内存大小
function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  
  while (size > 1024 && unit < sizes.length - 1) {
    size = size / 1024
    unit++
  }
  
  return `${size.toFixed(2)}${sizes[unit]}`
}

// 格式化时间
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}天 ${hours % 24}小时`
  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`
  return `${seconds}秒`
}

const app = useApp()

addCommand(new MessageCommand('zt')
  .action(async () => {
    const totalmem = os.totalmem()
    const freemem = os.freemem()
    const usedmem = totalmem - freemem
    
    return [
      '-------概览-------',
      `操作系统：${os.type()} ${os.release()} ${os.arch()}`,
      `内存占用：${formatBytes(usedmem)}/${formatBytes(totalmem)} ${((usedmem / totalmem) * 100).toFixed(2)}%`,
      `运行环境：NodeJS ${process.version}`,
      `运行时长：${formatTime(process.uptime() * 1000)}`,
      `内存使用：${formatBytes(process.memoryUsage().rss)}`,
      '-------框架-------',
      `适配器：${app.adapters.length}个`,
      `插件：${app.dependencyList.length}个`,
      '-------机器人-------',
      ...app.adapters.map((name) => {
        return `  ${name}：${app.getContext<Adapter>(name).bots.size}个`
      })
    ].join('\n')
  })
)
```

测试效果：

```bash
> zt
< -------概览-------
  操作系统：Darwin 23.6.0 arm64
  内存占用：1.23GB/16.00GB 7.69%
  运行环境：NodeJS v18.17.0
  运行时长：5分钟32秒
  内存使用：45.67MB
  -------框架-------
  适配器：3个
  插件：8个
  -------机器人-------
    process：1个
    icqq：2个
    qq：2个
```

## 使用上下文依赖

上下文依赖允许你的插件依赖其他服务或适配器：

```typescript
import { useContext, addCommand, MessageCommand } from 'zhin.js'

// 等待 ICQQ 适配器就绪后执行
useContext('icqq', (adapter) => {
  // 添加仅在 ICQQ 平台可用的命令
  addCommand(new MessageCommand('赞 [...users:at]')
    .scope('icqq')
    .action(async (message, result) => {
      const userIds = result.params.users || [+message.$sender.id]
      const bot = adapter.bots.get(message.$bot)
      
      const results: string[] = []
      for (const userId of userIds) {
        // 每个用户点赞 50 次（每次10个赞，共5次）
        const likeResults = await Promise.all(
          new Array(5).fill(0).map(() => bot?.sendLike(userId, 10))
        )
        const success = likeResults.filter(Boolean).length > 0
        results.push(`为用户(${userId})赞${success ? '成功' : '失败'}`)
      }
      
      return results.join('\n')
    })
  )
})
```

## 组件系统

组件可以让你创建可复用的消息元素：

```typescript
import { addComponent, ComponentContext } from 'zhin.js'

// 定义一个简单组件
addComponent(async function greeting(
  props: { name: string },
  context: ComponentContext
) {
  return `你好，${props.name}！`
})

// 在命令中使用组件
addCommand(new MessageCommand('greet <name>')
  .action(async (message, result) => {
    return [
      { type: 'greeting', data: { name: result.params.name } }
    ]
  })
)
```

## 监听消息

除了命令，你还可以直接监听所有消息：

```typescript
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  // 监听所有包含"帮助"的消息
  if (message.$raw.includes('帮助')) {
    await message.$reply('你可以输入以下命令：\n- hello\n- roll\n- zt')
  }
  
  // 监听特定关键词
  if (message.$raw === '你好' || message.$raw === 'hi') {
    await message.$reply('你好！有什么可以帮你的吗？')
  }
})
```

## 中间件

中间件可以在消息处理前后执行逻辑：

```typescript
import { addMiddleware, useLogger } from 'zhin.js'

const logger = useLogger()

// 日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now()
  logger.info(`收到消息: ${message.$raw}`)
  
  // 继续处理
  await next()
  
  const duration = Date.now() - start
  logger.debug(`消息处理耗时: ${duration}ms`)
})

// 过滤中间件
addMiddleware(async (message, next) => {
  // 过滤来自特定用户的消息
  if (message.$sender.id === 'blocked_user_id') {
    return  // 不继续处理
  }
  
  await next()
})
```

## 完整示例

这里是一个功能完整的插件示例：

```typescript
import {
  useContext,
  addCommand,
  addMiddleware,
  onMessage,
  useLogger,
  MessageCommand,
  useApp,
  Adapter
} from 'zhin.js'
import * as os from 'node:os'

const logger = useLogger()
const app = useApp()

// ======= 工具函数 =======

function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size > 1024 && unit < sizes.length - 1) {
    size = size / 1024
    unit++
  }
  return `${size.toFixed(2)}${sizes[unit]}`
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}天 ${hours % 24}小时`
  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`
  return `${seconds}秒`
}

// ======= 命令 =======

// 问候命令
addCommand(new MessageCommand('hello')
  .action(async () => '你好！我是机器人')
)

// 骰子命令
addCommand(new MessageCommand('roll [sides:number=6]')
  .action(async (message, result) => {
    const sides = result.params.sides || 6
    const roll = Math.floor(Math.random() * sides) + 1
    return `🎲 你掷出了 ${roll} 点！（${sides} 面骰子）`
  })
)

// 系统状态命令
addCommand(new MessageCommand('zt')
  .action(() => {
    const totalmem = os.totalmem()
    const freemem = os.freemem()
    const usedmem = totalmem - freemem
    
    return [
      '-------概览-------',
      `操作系统：${os.type()} ${os.release()} ${os.arch()}`,
      `内存占用：${formatBytes(usedmem)}/${formatBytes(totalmem)} ${((usedmem / totalmem) * 100).toFixed(2)}%`,
      `运行环境：NodeJS ${process.version}`,
      `运行时长：${formatTime(process.uptime() * 1000)}`,
      `内存使用：${formatBytes(process.memoryUsage().rss)}`,
      '-------框架-------',
      `适配器：${app.adapters.length}个`,
      `插件：${app.dependencyList.length}个`,
      '-------机器人-------',
      ...app.adapters.map((name) => {
        return `  ${name}：${app.getContext<Adapter>(name).bots.size}个`
      })
    ].join('\n')
  })
)

// 发送任意消息段
addCommand(new MessageCommand('send')
  .action((message, result) => result.remaining)
)

// ======= 中间件 =======

addMiddleware(async (message, next) => {
  logger.info(`收到消息: ${message.$raw}`)
  await next()
})

// ======= 消息监听 =======

onMessage(async (message) => {
  if (message.$raw.includes('帮助')) {
    await message.$reply(
      '可用命令：\n' +
      '- hello - 问候\n' +
      '- roll [sides] - 掷骰子\n' +
      '- zt - 系统状态'
    )
  }
})

// ======= 上下文依赖 =======

useContext('process', () => {
  logger.info('Process 适配器已就绪，可以在控制台输入消息测试')
})

useContext('icqq', (adapter) => {
  logger.info(`ICQQ 适配器已就绪，共 ${adapter.bots.size} 个机器人`)
  
  // ICQQ 专属命令
  addCommand(new MessageCommand('赞 [...users:at]')
    .scope('icqq')
    .action(async (message, result) => {
      const userIds = result.params.users || [+message.$sender.id]
      const bot = adapter.bots.get(message.$bot)
      
      const results: string[] = []
      for (const userId of userIds) {
        const likeResults = await Promise.all(
          new Array(5).fill(0).map(() => bot?.sendLike(userId, 10))
        )
        results.push(`为用户(${userId})赞${likeResults.filter(Boolean).length ? '成功' : '失败'}`)
      }
      
      return results.join('\n')
    })
  )
})

logger.info('我的插件已加载')
```

## 测试插件

在控制台测试所有功能：

```bash
> hello
< 你好！我是机器人

> roll 20
< 🎲 你掷出了 15 点！（20 面骰子）

> zt
< -------概览-------
  操作系统：Darwin 23.6.0 arm64
  ...

> 帮助
< 可用命令：
  - hello - 问候
  - roll [sides] - 掷骰子
  - zt - 系统状态
```

## 下一步

- 💾 [数据库使用](/guide/database) - 学习如何存储和查询数据
- 🎨 [JSX 支持](/guide/jsx) - 使用 JSX 构建富文本消息
- 🔔 [定时任务](/guide/cron) - 创建定时执行的任务
- 💬 [Prompt 交互](/guide/prompts) - 创建交互式对话

