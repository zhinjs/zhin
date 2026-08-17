# Orchestration Ports（ADR 0027）

> SSOT：`docs/adr/0027-agent-run-orchestration-kernel.md`  
> 词汇：`packages/im/agent/CONTEXT.md` §编排

本文件描述 **OrchestrationKernel** 与 **AgentDispatcher** 的 Port，供 Executor 实现方与 composition root 遵守。

## 原则

| 角色 | 职责 | 禁止 |
|------|------|------|
| **OrchestrationKernel** (`orchestration-service.ts`) | Run/Task 终态 SSOT；`completeTask` / `failTask` / `runTask` | 直接调用 IM 发送链 |
| **OrchestrationRepository** | Run/Task/RunEvent 持久化 | 业务逻辑 |
| **AgentExecutor** (`AgentExecutor` 接口) | 执行 Task；向 Kernel **上报** progress/result event | 直接写 Task 终态到 DB |
| **AgentDispatcher** (`agent-dispatcher.ts`) | 内存投影、`syncTaskFromRecord`、依赖调度缓存 | 作为编排终态权威（`recordResult` 不得替代 Kernel） |
| **Delivery Projection** | 将 Kernel 事件投影到 IM / Console | 把 IM 消息当作 Agent 间通信或终态事实源 |

## 对外 Port（组合层应使用的 Kernel API）

```ts
// 生命周期
findOrCreateRun(input) → Run
dispatchTask(input) → { task, runId }
runTask(taskId, message?, executorOverride?) → completed Task snapshot
completeTask(taskId, summary) → void
failTask(taskId, error) → void
taskProgress(taskId, note) → void
listRuns(sessionKey) → RunWithTasks[]

// 只读
repositoryHandle.getTask(taskId) → TaskRecord | null
```

Agent 委派只有两条执行路径：

1. **本地 Agent**：`dispatchTask(executorKind='local', assignedTo='<binding>')` → `runTask` → **SubagentSystem**。
2. **远程 Agent**：`dispatchTask(executorKind='remote_mesh')` → A2A transport。

IM 只可订阅 RunEvent 并投影进度或结果；不得用群 `@`、`#taskId` 回复或 Bot 消息完成 Task。

## AgentDispatcher Port（投影层）

```ts
syncTaskFromRecord(record: OrchestrationTaskRecord): void  // Kernel 写库后同步内存
getTask(taskId): AgentTask | undefined                     // 调度依赖查询
recordResult(result): void                                 // ⚠️ 仅 remote_mesh 等 legacy 路径；非 Kernel SSOT
```

Kernel 在 `completeTask` / `failTask` / `assignTask` 后 **必须** 调用 `this.dispatcherHandle.syncTaskFromRecord(...)`，保持 Dispatcher 投影与仓库一致（Dispatcher 由 Kernel 持有，随 generation 创建/销毁）。

## Executor Port

```ts
interface AgentExecutor {
  kind: ExecutorKind;
  execute(ctx: ExecutorContext): AsyncGenerator<AgentExecutionEvent>;
}
```

Executor **只产出** `AgentExecutionEvent`（progress / result / error）；由 Kernel `runTask` 消费并写入 RunEvent + Task 终态。

| Kind | 注册位置 | IM 关联 |
|------|----------|---------|
| `local` | `bootstrap-executors.ts` | **SubagentSystem** + configured Agent binding |
| `remote_mesh` | `remote-task-executor.ts` | A2A 远程 |

## 与 8 理想模块的关系

- **SubagentSystem** / **ZhinAgent**：`local` executor 执行面；spawn_task 经 Kernel 任务 + SubagentSystem.spawn；**不**拥有 Run/Task 持久化  
- **EventSystem**：Agent turn 域事件；**不**替代 Kernel `RunEvent`  
- **Delivery Projection**：只读 RunEvent 后向 IM / Console 展示，不参与 Task 执行或终态写入

## 迁移检查清单

- [x] Agent 委派是否通过 Kernel 创建/完成任务？
- [x] 是否避免在 pipeline 内直接 `repository.updateTaskStatus`？（`check:orchestration-ssot` 扫描）  
- [x] Dispatcher `recordResult` 是否仅用于非 Kernel 编排路径？  
- [x] 出站是否仍走 `Message.$reply` / `Adapter.sendMessage`（ADR 0004）？
