# 中间件与消息调度

> **级别：L2～L3**。若尚未了解消息如何进入框架，请先读 [消息如何流转](./message-flow.md)。

## 消息处理架构 {#消息处理架构}

Zhin.js 使用 **MessageDispatcher**（消息调度器）处理所有收到的消息。调度器将消息处理分为三个阶段：

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '14px' }}}%%
flowchart LR
  A([" 📨 消息到达 "]) ==> B

  subgraph pipeline [" MessageDispatcher 三阶段管线 "]
    direction LR
    B(" 🛡️ Guardrail\n守卫 ") ==> C(" 🔀 Route\n路由 ") ==> D(" ⚡ Handle\n处理 ")
  end

  D ==> E(["📤 返回结果"])

  classDef input fill:#e3f2fd,stroke:#1565c0,color:#0d47a1,rx:20
  classDef output fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20,rx:20
  classDef guard fill:#d32f2f,stroke:#b71c1c,color:#fff,rx:8
  classDef route fill:#f57c00,stroke:#e65100,color:#fff,rx:8
  classDef handle fill:#2e7d32,stroke:#1b5e20,color:#fff,rx:8

  class A input
  class E output
  class B guard
  class C route
  class D handle

  linkStyle 0,1,2,3 stroke:#42a5f5,stroke-width:2.5px
```

1. **Guardrail（守卫阶段）** - 安全检查、频率限制、日志记录等前置过滤
2. **Route（路由阶段）** - 判断消息应走「命令路径」还是「AI 路径」
3. **Handle（处理阶段）** - 交由命令系统或 AI Agent 处理

正式运行时须 **`inject('dispatcher').dispatch` 可用**（`zhin.js` 默认会注册）。若缺失，入站命令/AI 路由会被跳过并记错误日志；**不会**再走旧版「根 `middleware` 包裹整条消息链」的兼容路径。

**路由阶段默认 `exclusive`**（命令与 AI 互斥）。需要「指令 + AI」同时判定时，在配置里显式设置 `dispatcher.mode: dual` 等，详见 [AI 模块：MessageDispatcher 路由](/advanced/ai.html#messagedispatcher-指令与-ai-路由)。

## 中间件（Middleware）何时运行 {#中间件-middleware-何时运行}

在已启用 MessageDispatcher 时，通过 `addMiddleware` 注册的函数会在 **`MessageDispatcher.dispatch` 完成命令/AI 等主处理之后** 执行（实现上为根插件上除内置命令中间件外的 `_getCustomMiddlewares` 链）。  
因此：**需要在路由之前拦截、过滤、限流**，优先使用 **`dispatcher.addGuardrail`** 或框架内置的 [消息过滤](./message-filter.md)。中间件更适合 **日志、指标、后处理** 等。

中间件仍以洋葱模型运行：每个中间件可选择不调用 `next()` 以终止本条链路。

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

- **命令路径**：消息匹配到已注册的命令 → 交给 `CommandFeature` 处理
- **AI 路径**：消息满足 AI 触发条件（如 @机器人、私聊、前缀）→ 交给 AI Handler / ZhinAgent
- **无双路径命中**：主处理阶段可能无回复；随后在 Dispatcher 末尾仍会执行上述 **用户自定义 `addMiddleware` 链**（若已注册）

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
