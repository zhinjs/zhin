# ADR 0036: Internal Room 层内协作（破坏性）

## Status

Accepted (Breaking).

## Context

同 Zhin 实例内，CollaborationScene 成员 Bot 之间曾默认经 IM `@mention`（`scene_mention` executor）触发与 handback。该路径：

- 依赖平台往返与 peer-policy，易风暴
- 将「触发 peer」与「人类可见投影」绑在同一 executor

行业上类似模式（非 Matrix 联邦）：

- **Matrix Application Service / mautrix**：桥进程内协调 + puppet 身份 + 房间为人类投影
- **Microsoft Agent Framework Workflows**：同进程 Executor + Event/Task Ledger
- **Sagents dual-view**：Agent State vs Display Messages 分离

Zhin 已有 OrchestrationKernel SSOT（ADR 0027）与 CollaborationScene（ADR 0023）；层间跨实例仍用 A2A（ADR 0035）。

## Decision

### 三平面

| 平面 | 职责 | 实现 |
| --- | --- | --- |
| Coordination | Run/Task SSOT | OrchestrationKernel + `orchestration_events` |
| Delivery | 同实例 Bot↔Bot 触发 | `internal_room` executor + `CollaborationDispatch` |
| Projection | 人类可见 IM | `im_projection` executor（opt-in `project_to_im`） |

### 破坏性变更

1. **`scene_mention` → `im_projection`**：仅发群 @ 投影，不触发 peer、不替代 kernel handback 主路径
2. **新增 `internal_room`**：校验 CollaborationScene 成员 → 对端 ZhinAgent `spawnSync` / kernel 完成
3. **TurnPlan**：跨 endpoint 默认 `delegateToPeer` → `CollaborationDispatch.dispatchPeerTask`（不再 `im_mention`）
4. **Handback**：`internal_room` **仅 kernel** 完成；IM `#taskId` 仅用于 `im_projection` 任务
5. **读时 alias**：`scene_mention` / `group_mention` 配置 → `im_projection`

### CollaborationDispatch（深模块）

```ts
dispatchPeerTask({ cell, fromEndpointId, toEndpointId, goal, message?, projectToIm? })
```

集中：成员 ACL、kernel dispatch、`internal_room` runTask、可选 `im_projection` 链式。

## Consequences

- ADR 0027 executor 表更新：`local` | `internal_room` | `im_projection` | `remote_mesh`
- Five-Agent / test-bot 需将 peer 委派改为 `internal_room`；纯群可见用 `im_projection`
- MVP 不暴露 Room REST/UI；Room = `collaborationSceneId` + kernel events 视图

## Related

- [ADR 0023](./0023-group-cell-multi-endpoint-agents.md)
- [ADR 0027](./0027-agent-run-orchestration-kernel.md)
- [ADR 0035](./0035-a2a-agent-mesh.md)
- [Agent Mesh](../advanced/agent-mesh.md)
