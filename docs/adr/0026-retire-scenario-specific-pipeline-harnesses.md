# ADR 0026：废弃场景专用 Pipeline Harness

## 状态

**Superseded** — 由 [ADR 0027](./0027-agent-run-orchestration-kernel.md) 的 `OrchestrationKernel`、`WorkflowStrategy`、`AgentExecutor` 接管。

## 背景

早期协作实现把某些群聊场景写成内置 harness：入站关键词触发、post-turn 自动 @ 下一位、cell 级临时状态、工具 ACL 和 prompt 文案互相耦合。这类实现能解决单一演示场景，但会把通用 pipeline 变成特定剧本。

问题集中在三点：

- 编排状态散落在 cell 状态、入站 pipeline、工具和 prompt 中，唯一状态推进者不清晰。
- 关键词触发会把用户自然语言误判为固定流程，阻塞普通 agent 自由规划。
- 新增不同 pipeline 时需要继续加特殊分支，通用框架会逐步退化为场景集合。

## 决策

1. 默认运行时不再内置场景专用 harness，也不在入站路径按关键词启动固定流程。
2. 通用 pipeline 的公共能力只保留为：
   - `WorkflowStrategy`：把目标展开为任务图。
   - `AgentExecutor`：执行一种任务交付方式，例如 local、group_mention、remote_mesh。
   - `RunEvent`：表达状态、进度、思考摘要、结果回收。
   - `Projection`：把 run/task/event 投影到 IM、Console 或 REST。
3. 群聊多 bot 协作是投影和 executor 能力，不是 pipeline 状态机本身。
4. 场景需求应实现为可选策略或应用层插件；不得写入默认入站 pipeline、默认 tool ACL 或 CollaborationCell 状态。
5. `collaboration_cells.round_state` 这类历史字段仅作为迁移兼容保留，运行时不再读写或导出对应类型。

## 影响

- 删除默认注册的专用 workflow strategy（`five-agent` 改为显式 opt-in）。
- **已删除** 模型面向的 `cell_*` pipeline 工具及 `createPipelineTools`。
- 删除专用 helper、测试与 public export（`resolvePipelineTurnHint`、`buildPipelineRoleRichSystemPrompt` 等）。
- `ActiveDelegation.mode` 降级为 legacy 字符串元数据，不能再驱动状态分支。
- `cell_submit_artifact` / `cell_advance_stage` 只检查通用 pipeline 规则，不再识别具体场景。

## 实现准则

新增 pipeline 时遵守以下准则：

- 状态推进只能通过 `OrchestrationKernel`。
- 策略只生成任务图，不直接发送 IM、不修改 cell 状态。
- executor 只执行任务并回报事件，不直接改 run/task 状态。
- IM 群聊只负责消息投影、成员目录、endpoint 映射和结果回收。
- 所有场景策略都必须显式启用，不能靠入站关键词在默认路径自动接管。

## 相关

- [ADR 0023 — GroupCell 多 Endpoint 协作](./0023-group-cell-multi-endpoint-agents.md)
- [ADR 0024 — Five-Agent Pipeline（Superseded）](./0024-five-agent-aop-pipeline.md)
- [ADR 0027 — Agent Run Orchestration Kernel](./0027-agent-run-orchestration-kernel.md)
