---
title: 五角色群协作（高级配方）
---

# 五角色群协作（高级配方）

> **非默认产品路径。** Stable / L4 黄金验收以 [full-bot](https://github.com/zhinjs/zhin/tree/main/examples/full-bot) + `pnpm check:l4` 为准。五角色（Planner / Researcher / Evaluator / Executor / …）是 **ICQQ 多 Endpoint 群协作** 的可选演示配方，参考实现位于 [test-bot](https://github.com/zhinjs/zhin/tree/main/examples/test-bot)（厨房水槽，不进 CI 主路径）。

## 何时使用

- 同一 QQ 群内有 **多个真实 Bot Endpoint**（每个 Endpoint 绑定不同 Agent）
- 需要 **群内可见** 的 @ 委派与 handback，而非单 Bot 内的 `spawn_task`
- 已理解 [OrchestrationKernel](/adr/0027-agent-run-orchestration-kernel)：`scene_mention` Executor + Kernel `completeTask`

## 架构要点（ADR 0027）

| 概念 | 群协作中的含义 |
|------|----------------|
| **Run** | 群会话（`sessionKey` = `platform:endpointId:group:sceneId`）上的编排单元 |
| **Task (`internal_room`)** | Planner 通过 `orchestration_add_task` 委派 peer Endpoint |
| **Kernel** | 唯一终态权威；`orchestration_status` 查询进度与结果 |
| **WorkflowStrategy `five-agent`** | **显式 opt-in** 批量建 DAG；不再默认注册 |
| **已移除** | 模型面向的 `cell_*` pipeline 工具（`cell_submit_artifact` 等） |

> 群协作主路径：`orchestration_*` + `internal_room` / 可选 `im_projection`。详见 [ADR 0026](/adr/0026-retire-scenario-specific-pipeline-harnesses)。

## 配置清单

1. **多 Endpoint**：`zhin.config.yml` 中为同一 `icqq` 群配置多个 bot（见 [@zhin.js/adapter-icqq](/adapters/icqq)）
2. **协作 Cell**：在协作场景仓库中登记 `members[]`（`endpointId` + `pipelineRole`）
3. **Agent 发现**：各 Endpoint 对应 `agents/*.agent.md`（test-bot 含 `planner` / `researcher` / `evaluator` / `executor` 等）
4. **路由**：`ai.agents.*.match` 或群 @ 规则将入站路由到正确 `handlerProfile`

## 验证步骤（test-bot / 实机 ICQQ）

1. 群 @ Planner，下达可委派任务
2. Planner 调用 `orchestration_add_task(executor="internal_room", assigned_to="<peerEndpointId>")`
3. 目标 Bot 处理任务并在群内回复（可选 `project_to_im: true` 投影 @）
4. `orchestration_status` 可见 task 完成；`#taskId` 仅用于 `im_projection` handback
5. `GET /api/agent/orchestration/runs?sessionKey=<群 sessionKey>` 可见 run / tasks

## 相关文档

- [ADR 0024 — Five-Agent Pipeline（Superseded）](/adr/0024-five-agent-aop-pipeline)
- [ADR 0027 — Agent Run Orchestration Kernel](/adr/0027-agent-run-orchestration-kernel)
- [Agent 包 CONTEXT — 编排词汇](https://github.com/zhinjs/zhin/blob/main/packages/im/agent/CONTEXT.md)
