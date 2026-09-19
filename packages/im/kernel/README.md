# @zhin.js/kernel

Zhin 的框架无关基础机制包。它提供调度、错误、IM identity 与少量通用工具，不拥有 Plugin 生命周期、Feature discovery 或 IM Runtime。

## 模块边界

```text
@zhin.js/plugin-runtime  → Plugin tree / Scope / generation
@zhin.js/feature-kit     → Feature provider / discovery / projection
@zhin.js/kernel          → schedule / errors / identity / utilities
@zhin.js/core            → canonical IM Runtime
```

Kernel 与 Plugin Runtime 是并列的底层包。插件资源由 `Scope + Token` 管理，能力由 Feature provider 投影；Kernel 不维护第二套 Plugin 类、字符串 DI 或可变 Feature registry。

## ScheduleEngine

`ScheduleEngine` 负责解析 cron、农历、节假日和散列时间。Plugin Runtime 插件通过 owner-scoped `scheduleHostToken` 注册任务，由 composition root 管理 generation 生命周期。

```ts
import { ScheduleEngine } from '@zhin.js/kernel';

const engine = new ScheduleEngine();
engine.register(
  { id: 'daily-report', kind: 'cron', cron: '0 9 * * *' },
  () => sendDailyReport(),
);
engine.start();
```

## Scheduler

`Scheduler` 提供带 `JobStore` 端口的持久化任务调度。

```ts
import { Scheduler } from '@zhin.js/kernel';

const scheduler = new Scheduler({ checkInterval: 60_000 });
await scheduler.addJob({
  name: 'cleanup',
  schedule: { type: 'cron', cron: '0 3 * * *' },
  callback: cleanup,
});
await scheduler.start();
```

## 错误与工具

错误层级包括 `ZhinError`、`ConfigError`、`ConnectionError`、`ValidationError`、`PermissionError` 与 `TimeoutError`，并提供 `RetryManager`、`CircuitBreaker`。

通用工具包括受限表达式求值、模板编译、时间常量和入口解析：

```ts
import { compiler, evaluate, resolveEntry, Time } from '@zhin.js/kernel';
```

IM identity 使用 `resolveIMSceneIdForSession`、`resolveIMSceneSessionId` 和 `resolveIMSessionId`，避免不同上层包各自实现会话键规则。

## 主要导出

| 导出 | 职责 |
|------|------|
| `ScheduleEngine` | 内存任务计划与日期规则解析 |
| `Scheduler` | 持久化任务调度 |
| `ZhinError` 及子类 | 结构化错误契约 |
| `RetryManager` / `CircuitBreaker` | 失败恢复机制 |
| `resolveIMSessionId` | canonical IM 会话 identity |
| `evaluate` / `compiler` | 受限表达式和模板工具 |

## 安装

```bash
pnpm add @zhin.js/kernel
```

MIT License
