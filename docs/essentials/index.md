# 核心概念速查

一页看完 Zhin.js 的 6 个核心概念。代码示例见 [插件开发指南](/guide/plugin-development)。

## 插件（Plugin）

机器人的功能单元。每个 `.ts` 文件调用 `usePlugin()` 就是一个插件。

```typescript
import { usePlugin } from 'zhin.js'
const { addCommand, logger, onDispose } = usePlugin()
```

- **必须在文件顶层调用**，不能放在函数或回调里（AsyncLocalStorage 限制）
- 插件自动挂载到 `start()`，卸载到 `stop()`
- 详见 [插件系统](/essentials/plugins)

## 命令（Command）

用户触发机器人动作的方式。

```typescript
addCommand(new MessageCommand('echo <text>').desc('复读').action((_, r) => r.params.text))
```

- `<text>` 必填参数，`[text]` 可选参数
- 参数类型：`text`（整段）、`word`（单词）、`number`、`at`（@某人）
- 详见 [命令系统](/essentials/commands)

## 中间件（Middleware）

拦截消息流，在命令执行前后插入逻辑。

```typescript
addMiddleware(async (message, next) => {
  logger.debug(`收到: ${message.$raw}`)
  return next()
})
```

> **注意**：框架用 MessageDispatcher 做主路由。`addMiddleware` 主要在路由**之后**运行。要在路由**之前**拦截，用 Guardrail 或 [消息过滤](/essentials/message-filter)。
>
> 详见 [中间件](/essentials/middleware)

## 上下文（Context）

依赖注入系统。确保服务就绪后再使用。

```typescript
const { useContext, inject } = usePlugin()

// 等待数据库就绪后执行
useContext('database', (db) => { /* ... */ })

// 立刻获取（可能为 null）
const db = inject('database')
```

## 服务（Service）

跨插件共享功能。`provide` 注册，`inject` 或 `useContext` 消费。

```typescript
// 提供方
provide({ name: 'cache', value: new Map() })

// 使用方
const cache = inject('cache')
```

返回清理函数可在卸载时自动回收。

## 生命周期（Lifecycle）

```typescript
onMounted(() => { /* 插件启动，初始化资源 */ })
onDispose(() => { /* 插件卸载，清理资源 */ })
```

`onMounted` 回调中创建的定时器、连接等，应在 `onDispose` 中清理。

## 消息流转简图

```
用户消息 → Adapter → MessageDispatcher → Guardrail → 路由
                                                  ├→ 命令 → 回复
                                                  └→ AI Agent → 回复
回复 → renderSendMessage → before.sendMessage → Endpoint → 平台
```

完整流程见 [消息如何流转](/essentials/message-flow)。

## 下一步

- [消息如何流转](/essentials/message-flow) — 入站/出站一页弄清
- [插件开发指南](/guide/plugin-development) — 从创建到发布的完整流程
- [配置文件](/essentials/configuration) — 所有配置项
