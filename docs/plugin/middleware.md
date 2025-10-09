# 🔧 中间件系统

深入了解 Zhin.js 的中间件系统和消息处理管道。

## 🎯 中间件概述

中间件是 Zhin.js 消息处理管道的核心组件，允许你在消息处理过程中插入自定义逻辑。

## 🔧 基础中间件

### 添加中间件
使用 `addMiddleware` 添加中间件。

```typescript
import { addMiddleware } from 'zhin.js'

addMiddleware(async (message, next) => {
  console.log('处理消息前:', message.raw)
  await next()
  console.log('处理消息后')
})
```

### 中间件执行顺序
中间件按照添加顺序执行，形成洋葱模型。

```typescript
addMiddleware(async (message, next) => {
  console.log('中间件1: 开始')
  await next()
  console.log('中间件1: 结束')
})

addMiddleware(async (message, next) => {
  console.log('中间件2: 开始')
  await next()
  console.log('中间件2: 结束')
})

// 执行顺序：
// 中间件1: 开始
// 中间件2: 开始
// 消息处理
// 中间件2: 结束
// 中间件1: 结束
```

## 🛡️ 权限控制中间件

### 用户权限检查
检查用户是否有权限执行操作。

```typescript
import { addMiddleware } from 'zhin.js'

const adminUsers = new Set(['admin1', 'admin2'])

addMiddleware(async (message, next) => {
  // 检查是否为管理员
  if (!adminUsers.has(message.sender.id)) {
    await message.reply('权限不足')
    return // 不继续处理
  }
  
  await next()
})
```

### 群组权限控制
根据群组设置不同的权限。

```typescript
const groupPermissions = new Map([
  ['group1', ['user1', 'user2']],
  ['group2', ['user3', 'user4']]
])

addMiddleware(async (message, next) => {
  if (message.channel.type === 'group') {
    const allowedUsers = groupPermissions.get(message.channel.id)
    if (allowedUsers && !allowedUsers.includes(message.sender.id)) {
      await message.reply('你在此群组中无权限')
      return
    }
  }
  
  await next()
})
```

## 🔍 内容过滤中间件

### 敏感词过滤
过滤敏感内容。

```typescript
const sensitiveWords = ['敏感词1', '敏感词2']

addMiddleware(async (message, next) => {
  const content = message.raw.toLowerCase()
  
  for (const word of sensitiveWords) {
    if (content.includes(word)) {
      await message.reply('消息包含敏感内容，已删除')
      return // 不继续处理
    }
  }
  
  await next()
})
```

### 垃圾信息检测
检测和过滤垃圾信息。

```typescript
addMiddleware(async (message, next) => {
  // 检测重复消息
  if (isSpamMessage(message)) {
    await message.reply('检测到垃圾信息')
    return
  }
  
  // 检测链接
  if (containsSuspiciousLinks(message.raw)) {
    await message.reply('消息包含可疑链接')
    return
  }
  
  await next()
})

function isSpamMessage(message: Message): boolean {
  // 实现垃圾信息检测逻辑
  return false
}

function containsSuspiciousLinks(content: string): boolean {
  // 实现链接检测逻辑
  return false
}
```

## 📊 日志记录中间件

### 消息日志
记录所有消息。

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()

addMiddleware(async (message, next) => {
  logger.info(`收到消息: ${message.raw} (用户: ${message.sender.name})`)
  
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  
  logger.info(`消息处理完成，耗时: ${duration}ms`)
})
```

### 性能监控
监控消息处理性能。

```typescript
addMiddleware(async (message, next) => {
  const start = Date.now()
  
  try {
    await next()
  } finally {
    const duration = Date.now() - start
    
    // 记录慢处理
    if (duration > 1000) {
      logger.warn(`慢消息处理: ${message.raw} (${duration}ms)`)
    }
    
    // 记录性能统计
    recordPerformanceStats(duration, message)
  }
})
```

## 🔄 重试机制中间件

### 自动重试
为失败的操作添加重试机制。

```typescript
addMiddleware(async (message, next) => {
  const maxRetries = 3
  let retries = 0
  
  while (retries < maxRetries) {
    try {
      await next()
      return // 成功，退出重试循环
    } catch (error) {
      retries++
      
      if (retries >= maxRetries) {
        logger.error(`消息处理失败，已重试 ${maxRetries} 次:`, error)
        await message.reply('处理失败，请稍后重试')
        return
      }
      
      logger.warn(`消息处理失败，第 ${retries} 次重试:`, error)
      await new Promise(resolve => setTimeout(resolve, 1000 * retries)) // 指数退避
    }
  }
})
```

## 🎨 消息转换中间件

### 消息格式化
统一格式化消息。

```typescript
addMiddleware(async (message, next) => {
  // 标准化消息内容
  message.raw = message.raw.trim()
  
  // 转换表情符号
  message.raw = convertEmojis(message.raw)
  
  await next()
})

function convertEmojis(text: string): string {
  return text
    .replace(/:\)/g, '😊')
    .replace(/:\(/g, '😢')
    .replace(/:D/g, '😄')
}
```

### 多语言支持
根据用户语言设置转换消息。

```typescript
const userLanguages = new Map<string, string>()

addMiddleware(async (message, next) => {
  const userLang = userLanguages.get(message.sender.id) || 'zh-CN'
  
  // 根据用户语言转换消息
  message.raw = translateMessage(message.raw, userLang)
  
  await next()
})
```

## 🔧 高级中间件

### 条件中间件
根据条件执行不同的中间件。

```typescript
function createConditionalMiddleware(condition: (message: Message) => boolean, middleware: Middleware) {
  return async (message: Message, next: () => Promise<void>) => {
    if (condition(message)) {
      await middleware(message, next)
    } else {
      await next()
    }
  }
}

// 只对群消息应用特定中间件
addMiddleware(createConditionalMiddleware(
  (message) => message.channel.type === 'group',
  async (message, next) => {
    console.log('群消息特殊处理')
    await next()
  }
))
```

### 中间件组合
组合多个中间件。

```typescript
function composeMiddlewares(...middlewares: Middleware[]): Middleware {
  return middlewares.reduceRight((next, middleware) => {
    return async (message, nextFn) => {
      await middleware(message, () => next(message, nextFn))
    }
  })
}

const combinedMiddleware = composeMiddlewares(
  authMiddleware,
  logMiddleware,
  filterMiddleware
)

addMiddleware(combinedMiddleware)
```

### 异步中间件
处理异步操作的中间件。

```typescript
addMiddleware(async (message, next) => {
  // 异步验证用户
  const isValidUser = await validateUser(message.sender.id)
  
  if (!isValidUser) {
    await message.reply('用户验证失败')
    return
  }
  
  // 异步记录用户活动
  await recordUserActivity(message.sender.id, message.raw)
  
  await next()
})
```

## 🧪 测试中间件

### 单元测试
测试中间件的功能。

```typescript
// tests/middleware.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('Auth Middleware', () => {
  it('should allow admin users', async () => {
    const message = createMockMessage({ sender: { id: 'admin1' } })
    const next = vi.fn()
    
    await authMiddleware(message, next)
    
    expect(next).toHaveBeenCalled()
  })
  
  it('should reject non-admin users', async () => {
    const message = createMockMessage({ sender: { id: 'user1' } })
    const next = vi.fn()
    
    await authMiddleware(message, next)
    
    expect(next).not.toHaveBeenCalled()
    expect(message.reply).toHaveBeenCalledWith('权限不足')
  })
})
```

### 集成测试
测试中间件与插件的集成。

```typescript
describe('Middleware Integration', () => {
  it('should process message through middleware chain', async () => {
    const app = await createApp({
      plugins: ['my-plugin']
    })
    
    await app.start()
    
    // 发送测试消息
    await app.sendMessage({
      context: 'process',
      bot: 'test-bot',
      id: 'test',
      type: 'private',
      content: 'test message'
    })
    
    // 验证中间件是否正确执行
    expect(logMiddleware).toHaveBeenCalled()
    expect(authMiddleware).toHaveBeenCalled()
  })
})
```

## 🔗 相关链接

- [插件开发指南](./development.md)
- [插件生命周期](./lifecycle.md)
- [上下文系统](./context.md)
- [定时任务](./cron.md)
