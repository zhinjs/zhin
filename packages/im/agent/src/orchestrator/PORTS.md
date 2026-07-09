# Orchestration Ports（ADR 0027）

> SSOT：`docs/adr/0027-agent-run-orchestration-kernel.md`  
> 词汇：`packages/im/agent/CONTEXT.md` §编排

本文件描述 **OrchestrationKernel** 与 **AgentDispatcher** 的边界 Port，供 IM 组合层（`collaboration/`、`init/`）与 Executor 实现方遵守。

## 原则

| 角色 | 职责 | 禁止 |
|------|------|------|
| **OrchestrationKernel** (`orchestration-service.ts`) | Run/Task 终态 SSOT；`completeTask` / `failTask` / `runTask` | 直接调用 IM 发送链 |
| **OrchestrationRepository** | Run/Task/RunEvent 持久化 | 业务逻辑 |
| **AgentExecutor** (`AgentExecutor` 接口) | 执行 Task；向 Kernel **上报** progress/result event | 直接写 Task 终态到 DB |
| **AgentDispatcher** (`agent-dispatcher.ts`) | 内存投影、`syncTaskFromRecord`、依赖调度缓存 | 作为编排终态权威（`recordResult` 不得替代 Kernel） |
| **IM 组合层** (`inbound-turn-pipeline.ts` 等) | peer 策略、handback、出站 batch；**委托** Kernel 写终态 | 绕过 Kernel 改 Task status |

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

**IM 入站典型路径**

1. **Peer 委派**：`dispatchPeerTask` → Kernel `dispatchTask` + `scene_mention` / `internal_room` executor  
2. **Peer handback**：`tryHandlePeerInboundHandback` → Kernel `completeTask`（含 `#taskId` 解析）  
3. **spawn_task 路由**：`executeInboundSpawnTaskTurn` → Kernel `dispatchTask` + `runTask`（local executor）  
4. **出站完成投影**：`tryCompleteKernelImProjectionFromOutbound` → Kernel `completeTask` + 可选 handback @Planner  

## AgentDispatcher Port（投影层）

```ts
syncTaskFromRecord(record: OrchestrationTaskRecord): void  // Kernel 写库后同步内存
getTask(taskId): AgentTask | undefined                     // 调度依赖查询
recordResult(result): void                                 // ⚠️ 仅 remote_mesh 等 legacy 路径；非 Kernel SSOT
```

Kernel 在 `completeTask` / `failTask` / `assignTask` 后 **必须** 调用 `getAgentDispatcher().syncTaskFromRecord(...)`，保持 Dispatcher 投影与仓库一致。

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
| `local` | `bootstrap-executors.ts` | subagent / ZhinAgent turn |
| `im_projection` | `bootstrap-executors.ts` | 群 @ 委派 + handback |
| `scene_mention` | `bootstrap-executors.ts` | internal room peer |
| `remote_mesh` | `remote-task-executor.ts` | A2A 远程 |

## 与 8 理想模块的关系

- **SubagentSystem** / **ZhinAgent**：local executor 的执行面；**不**拥有 Run/Task 持久化  
- **EventSystem**：Agent turn 域事件；**不**替代 Kernel `RunEvent`  
- **IM 组合层**：调用 Kernel Port + 委托 `executeInboundAgentTurn` → `ZhinAgent.process`  

## 迁移检查清单

- [ ] 新 IM 路径是否通过 Kernel 创建/完成任务？  
- [ ] 是否避免在 pipeline 内直接 `repository.updateTaskStatus`？  
- [ ] Dispatcher `recordResult` 是否仅用于非 Kernel 编排路径？  
- [ ] 出站是否仍走 `Message.$reply` / `Adapter.sendMessage`（ADR 0004）？  
