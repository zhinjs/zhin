# 模块级状态与 generation

插件免不了要共享运行时状态：数据库句柄、配置快照、给 Agent 工具用的依赖包。麻烦在于，命令 action、工具 execute、cron 回调这些**运行时路径拿不到 setup context**，状态只能放在模块作用域——而热重载（HMR）下裸模块单例是事故高发区。`createGenerationStore`（`@zhin.js/plugin-runtime`）就是为解决这个问题准备的。

## 反例：裸模块单例的三种死法

```ts
// ❌ 反例
let _db: LotteryDb | null = null;
export function setDb(db: LotteryDb) { _db = db; }
export function getDb() { return _db; }
```

HMR 一次「代」切换（旧代装配 → 新代激活 → 旧代回收）中，这种写法有三种典型死法。

第一种是**悬挂引用**：旧代回收后没有任何人把 `_db` 清掉，新代码读到的还是旧代的数据库连接——旧连接早已 `stop()`，查询静默失败或打到已关闭的句柄。第二种是**覆盖竞态**：新旧两代并存期间（激活事务进行中），旧代的在途命令经 `_db` 读到的是**新代**刚 set 的值——跨代串数据。第三种是**回滚污染**：新代激活失败回滚、旧代恢复时，`_db` 已被新代覆盖，旧代「复活」后用的却是已废弃的新代资源。

这类事故在 repeater 单例、rss `_db` 上都真实发生过。结构上缺的是一件事：**值的存活期必须绑定到代的存活期**。

## createGenerationStore

```ts
import { createGenerationStore } from '@zhin.js/plugin-runtime';

const store = createGenerationStore<MyDeps>('my-plugin/deps');
```

一个 store 就是一条**多代栈**（stack of registrations）：

| 方法 | 签名 | 语义 |
| --- | --- | --- |
| `provide` | `(context, value) => Dispose` | 把 `value` 发布为当前代的值，压入栈顶；`context.lifecycle` 回收时（代结束）**自动**摘除该注册，栈中上一代的值重新露出。返回的 `Dispose` 可手动提前摘除，幂等 |
| `use` | `() => T` | 取栈顶存活值；一个注册都没有时抛出带 store 名的错误（`Generation store "…" has no live value`） |
| `tryUse` | `() => T \| undefined` | 同上但不抛错，返回 `undefined` |
| `clear` | `() => void` | 清空所有代的注册，主要给测试用 |

`context` 参数是最小结构 `{ lifecycle: DisposeStack }`——`PluginSetupContext` 直接满足。它解决了上面三种死法：**代结束自动清理**，`provide` 内部把摘除逻辑挂进 `context.lifecycle`，不需要调用方记得「卸载时 set null」；**多代并存安全**，激活事务期间两代注册同时在栈里，新代（栈顶）生效，新代回滚摘除后旧代的值自动重新露出——回滚天然干净；**无悬挂**，旧代回收即摘除，之后 `use()` 要么拿到新一代的值，要么明确抛错，绝不会静默读到死句柄。

```mermaid
flowchart TB
  subgraph 栈（栈顶在下）
    R2["注册 #2 · 新一代（栈顶，use() 返回它）"]
    R1["注册 #1 · 旧一代"]
  end
  R2 -->|"新一代 lifecycle 回收（回滚）"| X["自动摘除 → use() 重新露出注册 #1"]
```

## 正面示例：lottery 的 deps 注入

`plugins/utils/lottery/src/lottery-agent-deps.ts` 是范式。背景：lottery 的 Agent 工具（`agent/tools/*`）的 `execute` 是运行时路径，严禁调插件定位器，依赖必须在 setup 时捕获：

```ts
import { createGenerationStore, DisposeStack, type Dispose } from '@zhin.js/plugin-runtime';

export interface LotteryAgentDeps {
  getDb: () => LotteryDb | null;
  getConfig: () => { pickCount: number; historyLimit: number; kl8: Kl8Config };
  enabledGames: () => GameId[];
  scheduleCron: () => string;
  scheduleEnabled: () => boolean;
  pipelinePush: boolean;
}

const agentDepsStore = createGenerationStore<LotteryAgentDeps>('lottery/agent-deps');

/**
 * Generation-owned Agent dependency binding used by Plugin Runtime setup().
 * The fresh lifecycle is detached: callers own the returned dispose (setup()
 * hooks it into context.lifecycle); provide() does not retain the context.
 */
export function registerLotteryAgentDeps(deps: LotteryAgentDeps): Dispose {
  return agentDepsStore.provide({ lifecycle: new DisposeStack() }, deps);
}

export function getLotteryAgentDeps(): LotteryAgentDeps {
  const deps = agentDepsStore.tryUse() ?? _deps;
  if (!deps) throw new Error('lottery agent deps not initialized');
  return deps;
}
```

setup 侧的接线（`plugins/utils/lottery/plugin.ts`）：

```ts
context.lifecycle.add(registerLotteryAgentDeps({
  getDb: () => db,
  getConfig: () => ({ pickCount: config.pickCount, historyLimit: config.historyLimit, kl8: lotteryKl8(config) }),
  enabledGames: () => lotteryEnabledGames(config),
  scheduleCron: () => config.scheduleCron,
  scheduleEnabled: () => config.scheduleEnabled,
  pipelinePush: config.pushTargets.length > 0,
}));
```

两个细节值得注意。其一，`register*` 返回 `Dispose`，由 setup 挂进 `context.lifecycle`——这里 `provide` 用了一个全新的 `DisposeStack` 而不是直接传 setup context，是刻意的解耦：注册函数不持有 context 引用，回收时机完全由调用方（setup）控制，`context.lifecycle.add(...)` 那一刻才绑定到代。其二，运行时路径（工具 execute）只调 `getLotteryAgentDeps()`，拿到的闭包在 setup 时已捕获 `db` / `config`，全程无定位器调用。

lottery 还有第二处同类状态——数据库句柄（`src/db-store.ts` 的 `registerLotteryDb`，同样的「注册表压栈 + 返回摘除函数」手写形态，挂 `context.lifecycle`），以及经 `context.resources.provide(lotteryRuntimeToken, { db })` 发布给命令 context 的 token 路径。三条通道的分工：

| 通道 | 消费方 | 机制 |
| --- | --- | --- |
| `resources.provide(token, value)` | 命令 / 中间件等能拿到 CapabilityContext 的运行时路径 | Scope 父子链解析（见 [definePlugin](./define-plugin.md)） |
| `createGenerationStore` | 拿不到 context 的运行时路径（Agent 工具 execute、cron） | 模块级代际栈 |
| `register*` 手写注册表 | 同上的轻量场景 | 与 store 同构的手写版（新代码优先用 store） |

## 使用要点

`provide` 只在 setup（装配期）调用，`use` / `tryUse` 可以在任意运行时路径调用。store 名起成 `插件名/用途`（如 `lottery/agent-deps`），报错信息直接可读。除非你确定 provide 一定先于 use 发生，优先 `tryUse` 加显式报错或降级。测试里用 `clear()` 复位，避免跨用例泄漏。最后一条最容易被忽略：禁止在模块顶层把 `provide` 的返回值丢掉不管——始终挂进 `context.lifecycle`（或显式持有 Dispose），否则回收语义形同虚设。
