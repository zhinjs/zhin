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
| **Task (`scene_mention`)** | Planner @ Researcher 等 Endpoint 的委派项 |
| **Kernel** | 唯一终态权威；被委派方实质群回复 → `tryCompleteKernelGroupMentionFromOutbound` → `completeTask` |
| **WorkflowStrategy `five-agent`** | 可选批量工作流；主叙事仍是路由 + Kernel |

## 配置清单

1. **多 Endpoint**：`zhin.config.yml` 中为同一 `icqq` 群配置多个 bot（见 [@zhin.js/adapter-icqq](/adapters/icqq)）
2. **协作 Cell**：在协作场景仓库中登记 `members[]`（`endpointId` + `pipelineRole`）
3. **Agent 发现**：各 Endpoint 对应 `agents/*.agent.md`（test-bot 含 `planner` / `researcher` / `evaluator` / `executor` 等）
4. **路由**：`ai.agents.*.match` 或群 @ 规则将入站路由到正确 `handlerProfile`

## 验证步骤（test-bot / 实机 ICQQ）

1. 群 @ Planner，下达可委派任务
2. Planner 路由为 `scene_mention` → Kernel 创建 task → 群 @ 目标 Endpoint
3. 目标 Bot 在群内 **实质公开回复**（≥12 字，非仅「已完成」）
4. Kernel task → `completed`；可选 handback @ Planner（`#taskId`）
5. `GET /api/agent/orchestration/runs?sessionKey=<群 sessionKey>` 可见 run / tasks

## 相关文档

- [ADR 0024 — Five-Agent Pipeline（Superseded）](/adr/0024-five-agent-aop-pipeline)
- [ADR 0027 — Agent Run Orchestration Kernel](/adr/0027-agent-run-orchestration-kernel)
- [Agent 包 CONTEXT — 编排词汇](https://github.com/zhinjs/zhin/blob/main/packages/im/agent/CONTEXT.md)
