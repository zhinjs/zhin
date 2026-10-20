---
title: "模块级状态"
description: "插件的数据库连接、配置、服务对象应该放在哪里：为什么不能用模块级变量，以及正确的写法"
---

# 模块级状态

插件经常需要在命令、工具和定时任务之间共享一些东西：数据库句柄、解析好的配置、发消息的函数。本页回答一个问题：**这些东西应该放在哪里？**

## 结论

**在 `setup` 里创建，用 `context.resources.provide(token, value)` 发布，在命令和工具里用 `use(token)` 取出。不要放在模块顶层的变量里。**

## 正确写法

**1. 定义一个 token**，把插件运行需要的东西聚合在一起：

```ts
// src/runtime-state.ts
import { createToken } from 'zhin.js';

export interface LotteryRuntime {
  readonly db: LotteryDb;
  readonly config: Readonly<LotteryConfig>;
  readonly enabledGames: readonly GameId[];
  readonly outbound: ((text: string) => Promise<void>) | null;
}

export const lotteryRuntimeToken = createToken<LotteryRuntime>(
  'zhin.lottery.runtime',
  'Owner-scoped Lottery runtime',
);
```

**2. 在 `setup` 里创建并发布一次：**

```ts
// plugin.ts
export default definePlugin<LotteryConfig>({
  name: 'lottery',
  async setup(context) {
    const config = resolveLotteryConfig(context.config.get());
    const db = createLotteryDatabase(context);
    const outbound = createLotteryOutbound(context, config);

    const runtime = Object.freeze({
      db,
      config,
      enabledGames: Object.freeze(lotteryEnabledGames(config)),
      outbound,
    });
    context.resources.provide(lotteryRuntimeToken, runtime);

    // 定时任务的回调直接捕获同一个 runtime，不去查模块变量
    context.resources.use(scheduleHostToken).register({
      id: 'lottery/daily-pipeline',
      cron: config.scheduleCron,
      execute: () => runLotteryPipeline(runtime),
    });
  },
});
```

**3. 在命令和工具里取出：**

```ts
// commands/lottery-today/index.ts
export default defineCommand({
  description: 'Show today report',
  async execute({ use }) {
    const runtime = use(lotteryRuntimeToken);
    return loadTodayReport(runtime.db);
  },
});

// tools/lottery-history/index.ts
export default defineAgentTool({
  description: 'Query lottery history',
  async execute(input, context) {
    const runtime = context.use(lotteryRuntimeToken);
    return loadDraws(runtime.db, input.game, input.count);
  },
});
```

`use()` 找不到 token 时会抛错。**不要 catch 之后退回到模块变量、内存假数据或空实现**：token 缺失说明插件没有正确装配，应该明确失败，而不是把配置错误伪装成正常结果。

## 为什么不能用模块级变量

```ts
// ❌ 不要这样写
let currentDb: Database | undefined;
export function setDb(value: Database) { currentDb = value; }
export function getDb() { return currentDb; }
```

模块变量只有一份，但 Zhin 运行时可能同时存在多份插件状态：

| 场景 | 模块变量会出什么问题 |
| --- | --- |
| 热重载准备新版本时 | 新版本还没验证通过，就提前覆盖了旧版本正在使用的值 |
| 新版本准备失败、回滚时 | 模块变量里留下的是失败版本的值 |
| 同一个插件挂载了两份（两个 `instanceKey`） | 两份实例共用一个变量，数据串在一起 |
| 切换版本时还有旧消息在处理 | 旧消息中途读到了新版本的值 |

把单个变量改成"最近注册的值"的栈也没用：它只改变了覆盖顺序，仍然不知道当前调用属于哪个插件、哪个版本。`createGenerationStore` 之类的全局仓库同理。

而 `resources.provide` 的值绑定在**这个插件实例的这个版本**上：新版本准备失败时从不可见；切换成功后，旧消息继续用旧值，新消息用新值；最后一条旧消息处理完，旧资源才会释放。原理见 [Generation 生命周期](../concepts/generation-lifecycle.md)。

## 自查清单

- 一个 runtime 对象是否包含了插件执行所需的全部数据库、配置和端口？
- 所有运行路径（命令、工具、定时任务）是否都通过 `use()` 取得资源，或在 `setup` 里捕获同一个 runtime？
- 删除所有模块级的 getter / setter / store 后，业务代码是否依然清晰？
- 同一插件挂两份、一次失败的热重载、一条跨越切换的旧消息，三者是否互不干扰？
- 资源缺失时是否明确报错，而不是返回 `undefined` 或悄悄降级？

某个回调"拿不到 context"时，应该修改定义它的接口，让 `setup` 注入一个绑定好资源的闭包或执行上下文，而不是用模块全局变量绕过去。

## 下一步

- [definePlugin · 把资源提供给自己的命令和工具](./define-plugin.md#把资源提供给自己的命令和工具)
- [Host Token 总览](./host-tokens.md)：框架提供了哪些可以 `use()` 的资源。
