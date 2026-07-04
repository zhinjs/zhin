# @zhin.js/kernel

zhin 运行时内核，提供插件 DI、Feature 抽象、ScheduleEngine 调度、错误体系和通用工具函数。

可用于 Web 后端、CLI 工具、自动化脚本等任意 Node.js 应用。

## 架构

`@zhin.js/kernel` 位于 Zhin.js 分层底部，**不含 IM / Endpoint 概念**。上层 `@zhin.js/core` 继承本包的 `Feature`、`Scheduler` 并扩展 IM 运行时：

```
basic/ (@zhin.js/logger, schema, database, cli)
  ↓
@zhin.js/kernel          ← 本包
  ↓
@zhin.js/ai
  ↓
@zhin.js/core
  ↓
@zhin.js/agent
  ↓
zhin.js
```

详见 [架构文档索引](../../docs/architecture/README.md)、[架构概览](../../docs/architecture-overview.md) 与上层包 README（[`packages/README.md`](../../README.md)）。

## 核心模块

### PluginBase（插件基类）

轻量级插件系统，支持依赖注入、生命周期管理、事件传播和插件树结构。

```typescript
import { PluginBase } from '@zhin.js/kernel'

const root = new PluginBase({ name: 'my-app' })

// 依赖注入
root.provide(configService)
const config = root.inject('config')

// 加载子插件
await root.loadPlugin('./plugins/analytics')

// 生命周期
await root.start()
await root.stop()
```

上层框架可在此基础上扩展自己的 Plugin 子类（实现 `PluginLike` 接口）。

### Feature（特性抽象）

所有可追踪、可序列化的插件功能的基类，提供统一的注册/注销、插件归属追踪、JSON 序列化和变更事件通知。

```typescript
import { Feature } from '@zhin.js/kernel'

class MyFeature extends Feature<MyItem> {
  constructor() {
    super('my-feature')
  }
}

const feature = new MyFeature()
feature.on('add', (item, pluginName) => {
  console.log(`${item.name} 已注册 (来自 ${pluginName})`)
})
```

### ScheduleEngine（日历调度）

Kernel 侧包装 `@zhin.js/schedule`，支持 solar / lunar / holiday / workday / scatter 等语义（见 ADR 0028）。

```typescript
import { ScheduleEngine, getScheduleEngine, setScheduleEngine } from '@zhin.js/kernel'

const engine = new ScheduleEngine()
setScheduleEngine(engine)
engine.register('daily-report', { kind: 'solar', cron: '0 9 * * *' }, () => {
  console.log('每天 9:00 执行')
})
```

### Scheduler（任务调度器）

支持持久化的定时任务调度系统，可自定义 `JobStore` 存储后端。

```typescript
import { Scheduler, getScheduler, setScheduler } from '@zhin.js/kernel'

const scheduler = new Scheduler({ checkInterval: 60_000 })
await scheduler.addJob({
  name: 'cleanup',
  schedule: { type: 'cron', cron: '0 3 * * *' },
  callback: async () => { /* 清理逻辑 */ },
})
await scheduler.start()
```

### 错误体系

结构化的错误层级，支持错误码、重试和熔断机制。

```typescript
import {
  ZhinError, ConfigError, PluginError, ValidationError,
  RetryManager, CircuitBreaker, ErrorManager,
} from '@zhin.js/kernel'

// 带重试的操作
const retry = new RetryManager({ maxRetries: 3, baseDelay: 1000 })
await retry.execute(() => fetchData())

// 熔断器
const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 30000 })
await breaker.execute(() => callExternalService())
```

### 工具函数

```typescript
import {
  evaluate,    // 安全表达式求值 (vm sandbox)
  execute,     // 安全代码执行 (vm sandbox)
  compiler,    // 模板编译 ({{ var }})
  sleep,       // Promise 延时
  Time,        // 时间常量 (Time.second, Time.minute, ...)
  isEmpty,     // 空值检测
  remove,      // 数组元素移除
  resolveEntry // 插件入口解析
} from '@zhin.js/kernel'
```

## 主要导出

| 导出 | 说明 |
|------|------|
| `PluginBase` | 框架无关的插件基类 |
| `pluginStorage` | AsyncLocalStorage 插件上下文 |
| `PluginLike` | 最小插件接口（用于 Feature 等依赖） |
| `Feature` | 特性抽象基类 |
| `ScheduleEngine` | 日历语义调度（包装 `@zhin.js/schedule`） |
| `Scheduler` | 持久化任务调度器 |
| `ZhinError` | 基础错误类 |
| `ErrorManager` | 全局错误管理器 |
| `RetryManager` | 重试管理器 |
| `CircuitBreaker` | 熔断器 |
| `evaluate` / `execute` | 安全沙盒求值/执行 |
| `compiler` | 模板编译 |
| `Time` | 时间常量 |

## 安装

```bash
pnpm add @zhin.js/kernel
```

> 也可通过上层框架包间接引入。

## 许可证

MIT License
