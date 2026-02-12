# 中间件与消息调度

## 消息处理架构

Zhin.js 使用 **MessageDispatcher**（消息调度器）处理所有收到的消息。调度器将消息处理分为三个阶段：

```
消息到达 → Guardrail（守卫） → Route（路由） → Handle（处理）
```

1. **Guardrail（守卫阶段）** - 安全检查、频率限制、日志记录等前置过滤
2. **Route（路由阶段）** - 判断消息应走「命令路径」还是「AI 路径」
3. **Handle（处理阶段）** - 交由命令系统或 AI Agent 处理

如果 MessageDispatcher 未注册（极少数情况），框架会回退到旧版中间件链。

## 中间件（Middleware）

中间件仍然是消息处理的重要组成部分。它以洋葱模型运行，每个中间件可以选择拦截消息或传递给下一个。

### 基础用法

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware } = usePlugin()

addMiddleware(async (message, next) => {
  console.log('收到消息:', message.$raw)
  return next()
})
```

### 拦截消息

```typescript
addMiddleware(async (message, next) => {
  // 拦截特定消息，不再传递
  if (message.$raw === 'stop') {
    return  // 不调用 next()，消息到此为止
  }
  
  return next()
})
```

### 日志记录

```typescript
addMiddleware(async (message, next) => {
  const start = Date.now()
  const result = await next()
  const time = Date.now() - start
  
  console.log(`处理耗时: ${time}ms`)
  
  return result
})
```

## 守卫（Guardrail）

守卫是 MessageDispatcher 提供的前置过滤机制，在路由之前执行。用于全局的安全检查、频率限制等。

```typescript
import { usePlugin } from 'zhin.js'

const { useContext } = usePlugin()

useContext('dispatcher', (dispatcher) => {
  // 添加守卫：频率限制
  dispatcher.addGuardrail(async (message, next) => {
    const key = message.$sender?.id
    if (isRateLimited(key)) {
      return  // 丢弃消息
    }
    return next()
  })
})
```

## 消息路由

MessageDispatcher 在路由阶段判断消息应该怎么处理：

- **命令路径**：消息匹配到已注册的命令 -> 交给 CommandFeature 处理
- **AI 路径**：消息满足 AI 触发条件（如 @机器人、私聊、AI 前缀） -> 交给 AI Agent 处理
- **中间件路径**：都不匹配时 -> 走传统中间件链

### AI 触发条件

AI 触发由以下条件决定（可在配置文件中调整）：

- `respondToAt: true` — @机器人 时触发
- `respondToPrivate: true` — 私聊时触发
- `prefixes: ["ai "]` — 消息以指定前缀开头时触发
- `ignorePrefixes: ["/", "!"]` — 以这些前缀开头的消息不触发 AI

## 完整示例

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware, useContext, logger } = usePlugin()

// 全局日志中间件
addMiddleware(async (message, next) => {
  logger.info(`[${message.$adapter}] ${message.$sender?.id}: ${message.$raw}`)
  return next()
})

// 敏感词过滤中间件
addMiddleware(async (message, next) => {
  if (message.$raw?.includes('敏感词')) {
    logger.warn('消息包含敏感词，已拦截')
    return
  }
  return next()
})

// 使用 Dispatcher 守卫
useContext('dispatcher', (dispatcher) => {
  // 添加守卫：只处理群聊消息
  const dispose = dispatcher.addGuardrail(async (message, next) => {
    if (message.$channel?.type !== 'group') {
      return  // 非群聊消息不处理
    }
    return next()
  })
  
  // 返回 dispose 函数，插件卸载时自动移除守卫
  return dispose
})
```
