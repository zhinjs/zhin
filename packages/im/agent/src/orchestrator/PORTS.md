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

**IM 入站典型路径**（阶段 4 模块划分）

| 阶段 | 模块 | Kernel Port |
|------|------|-------------|
| 编排 wiring | `inbound-turn-pipeline.ts` | — |
| 路由 | `inbound-turn-route.ts` | `dispatchPeerTask` → `dispatchTask`；`executeInboundSpawnTaskTurn` → `dispatchTask` + `runTask` |
| Handback | `inbound-peer-handback.ts` | `completeTask` / `taskProgress` |
| 本地 turn | `inbound-turn-execute.ts` → `ZhinAgent.process` | — |
| 出站 | `inbound-turn-outbound-stage.ts` | `tryCompleteKernelImProjectionFromOutbound` → `completeTask` |

1. **Peer 委派**：`inbound-turn-route` → `dispatchPeerTask` → Kernel `dispatchTask` + `internal_room` / `scene_mention` executor  
2. **Peer handback**：`tryHandlePeerInboundHandback` → Kernel `completeTask`（含 `#taskId` 解析）  
3. **spawn_task 路由**：`executeInboundSpawnTaskTurn` → Kernel `dispatchTask` + `runTask`（`local` executor → **SubagentSystem**）  
4. **出站完成投影**：`executeInboundOutboundStage` → `tryCompleteKernelImProjectionFromOutbound` → `completeTask` + 可选 handback @Planner  

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
| `local` | `bootstrap-executors.ts` | **SubagentSystem** / ZhinAgent turn |
| `im_projection` | `bootstrap-executors.ts` | 群 @ 委派 + handback |
| `scene_mention` | `bootstrap-executors.ts` | internal room peer |
| `remote_mesh` | `remote-task-executor.ts` | A2A 远程 |

## 与 8 理想模块的关系

- **SubagentSystem** / **ZhinAgent**：`local` executor 执行面；spawn_task 经 Kernel 任务 + SubagentSystem.spawn；**不**拥有 Run/Task 持久化  
- **EventSystem**：Agent turn 域事件；**不**替代 Kernel `RunEvent`  
- **IM 组合层**：`inbound-turn-pipeline` 仅 IM 策略编排；turn 执行委托 `inbound-turn-route` / `inbound-turn-execute` → `ZhinAgent.process`  

## 迁移检查清单

- [x] 新 IM 路径是否通过 Kernel 创建/完成任务？（route / handback / spawn / outbound-stage）  
- [x] 是否避免在 pipeline 内直接 `repository.updateTaskStatus`？（`check:orchestration-ssot` 扫描）  
- [x] Dispatcher `recordResult` 是否仅用于非 Kernel 编排路径？  
- [x] 出站是否仍走 `Message.$reply` / `Adapter.sendMessage`（ADR 0004）？（`inbound-turn-outbound-stage` → `replyOutbound` 闭包）  
