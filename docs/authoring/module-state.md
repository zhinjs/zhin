# 运行时状态与 generation

插件的数据库句柄、配置快照和出站端口必须同时绑定到 **owner** 与 **generation**。理想状态下，运行时状态只有一个权威：setup 阶段写入候选 Scope 的 typed resource；generation commit 后，持有该 snapshot lease 的运行路径才能读取它。

## 反例：模块级“当前值”

```ts
// ❌ 裸单例、注册栈、createGenerationStore 都不是 owner resource
let currentDb: Database | undefined;
export function setDb(value: Database) { currentDb = value; }
export function getDb() { return currentDb; }
```

这类模块状态无法表达调用所属的 root、plugin owner、generation 与 snapshot lease。shadow prepare 可能提前覆盖旧代；两个同包实例会串资源；旧请求跨越 commit 后会读到新代；回滚还可能重新暴露错误值。把单值改成“最新注册栈”只改变覆盖顺序，并没有建立调用身份，因此不能作为 Plugin Runtime 的依赖注入方案。

## 正确模型：owner-bound resource

先定义一个聚合该插件运行能力的 token：

```ts
// src/runtime-state.ts
import { createToken } from '@zhin.js/plugin-runtime';

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

setup 只向候选 generation 的 owner Scope 发布一次完整 runtime：

```ts
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

    // cron 回调在 setup 中捕获同一个 owner runtime；不查询模块全局状态。
    context.resources.use(scheduleHostToken).register({
      id: 'lottery/daily-pipeline',
      cron: config.scheduleCron,
      execute: () => runLotteryPipeline(runtime),
    });
  },
});
```

`resources.provide` 只写 shadow Scope；失败候选不会发布。成功 commit 后，旧请求仍持旧 snapshot lease，新请求读取新 runtime，最后一个旧 lease 释放后旧资源才可销毁。

## Command 与 Tool

Command 和 Tool 都有 `CapabilityContext.use()`，必须直接读取所属 owner 的 resource：

```ts
export default defineCommand({
  description: 'Show today report',
  async execute({ use }) {
    const runtime = use(lotteryRuntimeToken);
    return loadTodayReport(runtime.db);
  },
});

export default defineAgentTool({
  description: 'Query lottery history',
  async execute(input, context) {
    const runtime = context.use(lotteryRuntimeToken);
    return loadDraws(runtime.db, input.game, input.count);
  },
});
```

不要 catch `use()` 再退回模块变量。token 缺失代表装配不完整，应 fail-closed；伪造 memory DB、空能力或“最近一次注册”都会把配置错误伪装成正常结果。

## 设计检查

- 一个 runtime resource 是否包含该 owner 执行所需的完整 DB/config/ports？
- 所有运行路径是否由固定 snapshot 的 `CapabilityContext` 解析资源，或在 setup 中捕获同一 runtime？
- 删除模块级 getter/setter/store 后，是否没有业务复杂度回流？
- 两个相同插件实例、一次失败 prepare、一个跨 commit 的旧请求是否互不串线？
- 资源缺失是否明确失败，而不是返回 `undefined` 或启用 fallback？

如果某个回调“拿不到 context”，应修改定义它的 Host/Feature 接口，让 setup 注入 owner-bound closure 或 execution context；不要用模块全局状态绕过生命周期。
