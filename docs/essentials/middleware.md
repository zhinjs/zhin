# 中间件

中间件用于拦截和处理消息。

## 基础用法

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware } = usePlugin()

addMiddleware(async (message, next) => {
  console.log('收到消息:', message.content)
  return next()
})
```

## 拦截消息

```typescript
addMiddleware(async (message, next) => {
  // 拦截特定消息
  if (message.content === 'stop') {
    return '已停止'
  }
  
  return next()
})
```

## 修改消息

```typescript
addMiddleware(async (message, next) => {
  // 修改消息内容
  message.content = message.content.toLowerCase()
  
  return next()
})
```

## 权限检查

```typescript
addMiddleware(async (message, next) => {
  const { inject } = usePlugin()
  const permission = inject('permission')
  
  if (!permission.check(message.user_id, 'admin')) {
    return '权限不足'
  }
  
  return next()
})
```

## 日志记录

```typescript
addMiddleware(async (message, next) => {
  const start = Date.now()
  const result = await next()
  const time = Date.now() - start
  
  console.log(`处理耗时: ${time}ms`)
  
  return result
})
```

## 完整示例

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware, logger } = usePlugin()

// 日志中间件
addMiddleware(async (message, next) => {
  logger.info(`[${message.user_id}] ${message.content}`)
  return next()
})

// 过滤中间件
addMiddleware(async (message, next) => {
  // 过滤敏感词
  if (message.content.includes('敏感词')) {
    return '消息包含敏感词'
  }
  
  return next()
})

// 权限中间件
addMiddleware(async (message, next) => {
  // 检查权限
  const { inject } = usePlugin()
  const permission = inject('permission')
  
  if (!permission.check(message.user_id)) {
    return '权限不足'
  }
  
  return next()
})
```

