---
title: "Generation 与生命周期"
description: "热重载为什么不会打断正在处理的消息、新代码出错时为什么旧版本还能继续服务，以及插件资源为什么必须登记清理"
---

# Generation 与生命周期

改完一个命令文件，不用重启进程，正在处理的消息也不会被打断。这是因为启动、热重载、配置变更在内部走的是同一条路径：先在后台把新版本**完整**构建出来，再一次性切换。每个版本叫一个 **generation**（代）。

## 你会观察到的行为

| 你做了什么 | 会发生什么 |
| --- | --- |
| 保存一个命令、中间件或工具文件 | 只重建受影响的部分，几百毫秒内生效，进程不重启 |
| 修改 `zhin.config.yml` 中某个插件的配置 | 重建该插件；新配置不合法时保留旧配置 |
| 新代码抛错、依赖缺失、外部连接失败 | 切换取消，**旧版本继续服务**，终端打印错误 |
| 切换时还有消息正在处理 | 这些消息用旧版本跑完；新消息使用新版本 |
| 增删子插件、修改 `package.json#zhin` 的结构 | 超出热重载能安全处理的范围，CLI 会重启进程 |

对插件作者只有一条要求：**在 `setup` 里申请的资源（定时器、连接、注册），要交给 `context.lifecycle` 或由 `setup` 返回的函数释放。**原因见下文 [为什么资源必须挂 lifecycle](#为什么资源必须挂-lifecycle)。

下面的内容解释这套机制如何实现，适合想深入理解或参与贡献的读者。

## 快照：一代的世界状态

每一代是一份不可变的 `RuntimeSnapshot`（从 `zhin.js` 导入类型）：

```ts
interface RuntimeSnapshot {
  readonly generation: number;                       // 代数，从 0 开始单调递增
  readonly root: PluginId;
  readonly tree: ReadonlyMap<PluginId, PluginNodeSnapshot>;   // 插件树
  readonly config: ReadonlyMap<PluginId, unknown>;            // 各插件的 ConfigView
  readonly resources: ReadonlyMap<PluginId, ReadonlyMap<TokenId, unknown>>;
  readonly capabilities: ReadonlyMap<CapabilityId, CapabilitySlot>;
  readonly projections: ReadonlyMap<FeatureId, unknown>;      // AdapterIndex、CommandIndex…
}
```

快照的集合结构使用只读视图；可序列化 descriptor 必须不可变，有状态 Resource 则只通过受控接口暴露。插件代码拿到的永远是某个确定代的世界状态。

`RuntimeSnapshot` 与 Runtime 的 ownership、generation model 等 sidecar 一起组成
`CommittedGeneration`。Root 只交换这一条完整 record，commit observer 不可能看到
“新 snapshot + 旧 ownership”的混合世界。

## 单一原子发布点

`RootController` 把所有控制操作串行化（promise 队列），每次事务执行同一条流水线：

```mermaid
sequenceDiagram
    participant C as RootController
    participant P as prepare（影子构建）
    participant H as GenerationHandoff
    participant S as SnapshotStore

    C->>P: prepare(current)
    Note over P: 扫描插件图、组合配置、创建 scope、<br/>投影 Feature……全部惰性，对外不可见
    P-->>C: PreparedGeneration（含 handoff + dispose）
    C->>H: activateNext(signal)
    Note over H: 正序完成所有可失败 readiness；<br/>候选准入 gate 仍关闭
    C->>S: commit（切换快照与全部准入 gate，generation+1）
    Note over S: commit 是同步、不可失败的最后发布点；<br/>旧代随最后一个 lease 释放后销毁
    alt prepare/readiness 失败
        C->>H: deactivateNext()（若已激活）
        C->>P: prepared.dispose()（销毁影子）
        Note over C: 旧代原样运行，事务整体作废
    end
```

对应的代码骨架（`RootController.transact`）：

```ts
const previous = this.snapshots.acquire();
try {
  prepared = await prepare(previous.value, signal);
  if (!prepared) return previous.value;      // 无变化，直接返回
  if (prepared.handoff) {
    await prepared.handoff.activateNext(signal);
  }
  return this.#commitGeneration(previous.value.generation, prepared);
} catch (error) {
  return this.#rollback(prepared, { activated }, error);
} finally {
  previous.release();
}
```

`GenerationHandoffStack` 只组合候选资源的 readiness：`activateNext` 按正序执行，失败时对已经成功激活的参与者逆序执行 `deactivateNext`。该栈不暂停旧代，也不决定旧任务的取消；补偿也失败时 Root fail-closed，不再接纳新操作。

### 插件自主处理热更事件

如果插件在后台维护了自己的任务队列，可以在 `setup` 中订阅 `hmr.pause` 与 `hmr.resume` 事件，在热重载交接前后保存检查点或恢复任务：

```ts
setup({ events }) {
  events.on('hmr.pause', async ({ signal, details }) => {
    await jobs.prepareReload({ signal, details });
  });
  events.on('hmr.resume', async ({ signal, details }) => {
    await jobs.completeReload({ signal, details });
  });
}
```

- `hmr.pause` 在候选代开始求值和 `setup` 之前触发；若处理器抛错，本次热重载中止，旧代继续运行。
- `hmr.resume` 在新一代提交或回滚后触发，用于通知插件恢复或接续工作。
- 这两个处理器运行在 Root 控制队列内，因此**只应做快速的本地状态检查点**，不要在处理器里递归调用 Runtime 控制接口，也不要阻塞等待外部网络或慢速 I/O（耗时任务应放到插件自己的异步队列中执行）。

### Adapter 的准入由快照原子切换

热重载时，平台连接不会先断开再重连：

1. 候选代的 `AdapterIndex` 在 `activateNext` 阶段完成 `start()` 与 `open()` 准备，但在 `commit` 之前，候选代的入站准入闸门（`GenerationAdmissionGate`）保持关闭。
2. `SnapshotStore` 提交新快照的瞬间，同步开放新代准入闸门并关闭被替换的旧闸门；未被替换的插件子树与连接投影保持无感复用。
3. 若候选代有任何已配置的 Endpoint 创建或启动失败，整个候选代会被拒绝，旧代保持原样在线服务。
4. 提交后，旧 Endpoint 随在途消息的快照租约自然排空（drain），排空后由旧代 disposer 执行 `close()` / `stop()`。共享的 HTTP listener、Console RPC 与 SSE 归属于进程级 Host，热重载期间始终保持可用。

## 快照租约：在途消息不被打断

commit 只换指针，旧代不立刻销毁——它可能还在服务在途消息。`SnapshotStore` 用租约（lease）管理：

- `acquire()` 拿到当前代快照并 +1 引用；用完 `release()`；
- `retain(lease)` 为仍有效的自有租约增加独立引用，固定同一代，不解析最新代；
- `retirementSignal` 表达该代被替换；`stopSignal` 在同一 Root 所有租约间共享，仅关闭 Root 时取消；
- 被替换的旧代标记 retired，等租约归零才真正 `dispose()`；
- `RootController.stop()` 会等所有历史代都释放完毕才返回，因此停机不会在消息处理中途掐断资源。

## HMR 语义

`HmrCoordinator`（`@zhin.js/runtime`）监听文件变更，把同一次文件系统操作产生的一批事件合并成一个事务，然后由 `InvalidationPlanner` 规划失效范围：

- **generation 级**：变更只影响某些插件子树或能力 slot → 只重建受影响部分（subtree / slot / topology 三种 preparer），走上面那套交接；
- **process 级**：模块加载器无法安全失效的变更、或 manifest 拓扑变更越过了重启边界（`RestartBoundaryPlanner` 判定，比如新增/删除子插件依赖）→ 交给 `onRestartRequired`，由外层（CLI）重启进程。

失败的 HMR 事务会作废本批次剩余变更并走 `onError`，不会静默重放。HMR stop
会先停止接纳新事件，再等待在途 reload settlement；process restart 一旦确定，当前
coordinator 不再接受新的 generation reload。commit 后的 Console/日志观察器失败只进入
诊断通道，不会把已经提交的 reload 改写成失败。

## 为什么资源必须挂 lifecycle

热重载 = 旧代销毁、新代重建。如果插件把资源挂在**模块级变量**里（`let _db = ...`），模块被重新加载时旧变量跟着旧代死了，但某些回调还持有旧引用——这就是"幽灵单例"事故的典型成因（定时器重复触发、拿到已关闭的数据库连接）。

规则很简单：**一切有生命周期的资源都注册进 `context.lifecycle`（一个 `DisposeStack`）**，generation 结束时统一反注册。

跨模块共享的代级状态必须作为 snapshot Resource 提供，并由一次 operation 持有的
`GenerationView` 解析。禁止模块级 latest-value stack、`createGenerationStore` 或任何
“当前活代”查询；它们既无法隔离多个 Root，也会让 shadow candidate 在 commit 前可见。
