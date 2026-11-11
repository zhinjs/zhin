# @zhin.js/kernel

Zhin 的框架无关基础机制包。它提供调度、错误基类、IM identity 与少量通用工具，不拥有 Plugin 生命周期、Feature discovery 或 IM Runtime。

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

const engine = new ScheduleEngine({
  timezone: 'Asia/Shanghai',
  onError: (error, jobId) => console.error(jobId, error),
});

// register(id, kind, callback, options) 立即生效并返回取消函数；没有单独的 start()。
// kind: 'solar' | 'lunar' | 'workday' | 'freeDay' | 'holiday' | 'scatter' | 'every' | 'at'
const cancel = engine.register('daily-report', 'solar', (ctx) => sendDailyReport(ctx.scheduledAt), {
  cron: '0 9 * * *',
});
engine.register('poll', 'every', () => poll(), { everyMs: 60_000 });

engine.pause('daily-report');
engine.resume('daily-report');
engine.getStatus();   // MemoryScheduleRegistration[]
cancel();             // 等价于 engine.unregister('daily-report')
engine.dispose();
```

## 错误与工具

`ZhinError` 是带 `code`、`timestamp`、`context` 的结构化错误基类。

```ts
import { renderTemplatePaths, sleep, Time, ZhinError } from '@zhin.js/kernel';

renderTemplatePaths('你好 ${sender.name}，1+1=${1+1}', { sender: { name: 'Alice' } });
// => '你好 Alice，1+1=${1+1}'
```

`renderTemplatePaths` 只做白名单路径查找：占位符必须是纯属性路径（`a.b[0].c`），并且沿自有可枚举数据属性解析到已定义的非函数值才会被替换；表达式、函数调用、未知名称一律原样保留，不执行任何代码。

IM identity 使用 `resolveIMSceneIdForSession`、`resolveIMSceneSessionId` 和 `resolveIMSessionId`，避免不同上层包各自实现会话键规则。`isHeartbeatEmpty` 判断 `HEARTBEAT.md` 是否没有可执行行。

## 主要导出

| 导出 | 职责 |
|------|------|
| `ScheduleEngine` | 内存任务计划与日期规则解析 |
| `ZhinError` | 结构化错误基类 |
| `resolveIMSessionId` | canonical IM 会话 identity |
| `renderTemplatePaths` | `${path}` 白名单路径替换（不求值） |
| `isHeartbeatEmpty` | 心跳文件是否为空 |
| `Time` / `sleep` | 时间常量与延时 |

## 安装

```bash
pnpm add @zhin.js/kernel
```

MIT License
