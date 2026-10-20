---
title: "插件测试"
description: "用 @zhin.js/testing 的假运行环境测试插件：不再手工拼上下文、不再写 as never"
---

# 插件测试

给插件写测试，不需要自己拼 `setup` 的上下文，也不需要 `as never`。`@zhin.js/testing` 提供两层工具：

| 层 | 用途 | 入口 |
| --- | --- | --- |
| **假运行环境**（单元测试） | 快、无需测试应用；直接跑 `setup()`、命令、中间件、处理器 | `createFakePlugin` / `runPluginSetup` / `runCommand` … |
| **真实运行时**（集成测试） | 真实的模块发现、命令解析、权限、发送链路 | `PluginTestKit` |

```bash
pnpm add -D @zhin.js/testing
```

## 跑 setup

假环境用的是**真正的** `Scope`、`DisposeStack`、`GenerationHandoffStack`，以及真正的按插件隔离的 `databaseHostToken` / `scheduleHostToken` / `outboundHostToken` 外观，底层换成内存实现。

```ts
import { runPluginSetup } from '@zhin.js/testing';
import plugin from '../plugin.js';

it('每 30 秒往目标群发一条消息', async () => {
  const fake = await runPluginSetup(plugin, { config: { target: 'g1' } });

  await fake.clock.advance(65_000);                     // 推进假时钟，到点的 cron 会被执行

  expect(fake.sent.map(call => call.kind)).toEqual(['send', 'send']);
  expect(fake.rows('notes')).toEqual([{ text: 'hello' }]); // setup 里 define 的表
  await fake.dispose();                                  // 触发 lifecycle 里的清理函数
});
```

`createFakePlugin(options)` 只创建环境，不跑 `setup`；之后用 `fake.setup(plugin)` 运行，或直接把 `fake.context` 交给自己的函数。

| 选项 | 作用 |
| --- | --- |
| `name` / `config` | 插件名与 `context.config.get()` 的值 |
| `resources` | 额外的 token 绑定：`[fakeResource(token, value)]`，类型由 token 决定，无需断言 |
| `hosts` | `{ database, schedule, outbound }`，设为 `false` 可模拟宿主缺失（配合 `resources.has()` 的分支） |
| `clock` | 起始时间或共享的 `FakeClock` |

| 成员 | 说明 |
| --- | --- |
| `fake.context` / `resources` / `lifecycle` / `handoff` / `signal` | 传给 `setup` 的各部分 |
| `fake.database` / `schedule` / `outbound` | 与 `resources.use(token)` 拿到的是同一个外观 |
| `fake.rows(name)` | 读取插件 `define(name)` 建的表（内存实现，`where` 只支持等值） |
| `fake.sent` | 记录所有主动发送（`send`、`sendTarget`、反应、撤回、编辑、输入中），`sendTarget` 带发送方插件 |
| `fake.outboundHost.failNext(error)` | 让下一次发送失败，用来测失败路径 |
| `fake.clock` | `advance(ms)` 推进并按时间顺序执行到期任务；`set(time)` 只改时间不触发 |
| `fake.scheduleHost.trigger(id)` | 立即执行某个已注册任务 |
| `fake.features` | `setup` 里通过 `addFeature` / `addCommand` 等登记的能力 |
| `fake.missingRequirements(plugin)` | 检查 `requires` 里有没有没提供的 token |

cron 为六段（秒 分 时 日 月 周），支持 `*`、`*/n`、列表和范围，按本地时间计算。`database.state` 的 TTL 使用真实的 `Date.now()`，不受假时钟影响。

## 跑命令、中间件、处理器

约定目录里的定义可以直接拿来执行，上下文由假环境构造：

```ts
import { createFakeMessage, createFakePlugin, fakeResource, runCommand, runMiddleware, runHandler } from '@zhin.js/testing';
import checkin from '../commands/checkin/index.js';

const fake = createFakePlugin({ resources: [fakeResource(greeterToken, greeter)] });
const message = createFakeMessage({ sender: { id: 'u1', name: 'Ann', roles: ['admin'] } });

await runCommand(fake, checkin, { input: message, params: { days: 3 } });
expect(message.replies).toEqual(['签到成功']);          // $reply 被记录在 replies

const { continued } = await runMiddleware(fake, gate, createFakeMessage({ content: 'skip' }));
expect(continued).toBe(false);                          // 中间件是否调用了 next()

await runHandler(fake, onReceive, createFakeMessage()); // this 即能力上下文
```

::: warning 这不是完整的派发
`runCommand` 直接调用 `execute()`：不做路由匹配、参数解析、`permit` 校验和准入检查，`params` 需要你自己给出已解析的值。要验证这些，用下面的真实运行时。
:::

## 局部假对象：`fakeOf`

内部协作者或事件载荷只需要几个成员时，用 `fakeOf<T>({...})` 代替 `{...} as never`——强制转换集中在这一处，调用处仍由 `Partial<T>` 检查成员名和类型：

```ts
const orchestrator = fakeOf<ActivityFeedbackOrchestrator>({ startPhase: vi.fn(), stopPhase: vi.fn() });
```

有真实或套件自带的假对象时优先用它们，`fakeOf` 只用于窄协作者。

## 真实运行时：`PluginTestKit`

假环境不经过渲染器、出站中间件和端点协商。需要验证"消息真的按这条链路发出去"时，用 `PluginTestKit`：它挂载一个一次性的真实测试应用，合成端点记录最终载荷。用法与限制见套件 [README](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/testing/README.md)。

`kit.messageDiagnostics` 与 Console `GET /api/messages/diagnostics` 读取的是同一份有界、无正文的诊断，可以断言每条消息的路由、派发状态和投递结果。

## 官方示例

`plugins/services/activity-feedback/tests/activity-feedback-runtime.test.ts` 已迁移到这套工具：`setup` 用 `createFakePlugin` 提供事件总线和宿主，载荷与编排器用 `fakeOf`，文件内不再有 `as never`。

## 下一步

- [Host Token 总览](./host-tokens.md)：假环境提供的各个 token。
- [插件完整交付](./plugin-delivery.md)：测试与发布清单。
- [消息场景试验台](./message-scenarios.md)：本地预览作者预期消息，导出并显式运行独立测试项目的真实回归。
