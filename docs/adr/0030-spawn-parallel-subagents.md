# ADR 0030: spawn_task 并行子代理与并发治理

## Status

Accepted

## Context

Zhin 已具备 `spawn_task` 与 `SubagentManager`。本 ADR 落地前存在四个缺口（现已补齐）：

1. `agent-loop` 工具执行路径为单轮顺序执行，缺少分层并行能力。
2. `SubagentManager.runningTasks` 仅计数不设硬上限。
3. 缺少基于 `permission.task` 的子代理类型可见性过滤。
4. `spawn_task` 与主编排提示词对「同轮并行 spawn」引导不足。

另：异步子 agent 结果原先经 `resultSender` 直推 IM，与「主 Agent 编排后再回复用户」不一致；实现上改为 **结果先交还主 Agent（`onSubagentComplete` + auto-continue）**，IM 直发改为可选（`subagentDirectImDelivery`）或 hook（`ai.subagent.finish`）。

OpenCode 的实践表明，“同时开几个子代理”主要由 **LLM 分解 + Prompt 引导 + Permission 可见性** 决定，而不是框架静态拆分算法。Zhin 需要在保持现有 spawn 模型的前提下补齐并发治理与提示词工程。

## Decision

### D1 — 引入分层并行工具执行（agent-loop）

`toolExecution` 新增 `tiered` 模式：

- **Parallel bucket**：`spawn_task` + 只读工具（如 `read_file`、`grep`、`glob`、`web_search`、`list_dir`、`todo_read`，最终清单由配置类型 SSOT 维护）。
- **Sequential bucket**：有副作用或交互阻塞工具（如 `bash`、`write_file`、`edit_file`、`ask_user`、MCP 写操作）。

同一 turn 的执行顺序为：先并行执行 parallel bucket（`Promise.all`），再按原顺序执行 sequential bucket。

### D2 — 引入子代理并发硬上限（SubagentManager）

新增配置 `ai.agent.maxParallelSubagents`，默认值为 `5`。

在 `spawn` / `spawnSync` 入口统一检查：

- 当 `getRunningCount() >= maxParallelSubagents` 时，立即拒绝并返回结构化错误；
- 错误信息需包含当前 `running` 数、上限值和建议动作（拆分批次或等待已运行任务完成）。

并发计数 SSOT 继续使用 `SubagentManager.runningTasks`。

### D3 — 基于 permission.task 的子代理类型过滤

新增子代理可见性配置路径：`ai.agents.<name>.permission.task`（glob 白名单语义）。

设计要求：

- 在 `spawn_task` 工具描述生成阶段过滤不可用 agent 类型；
- 对主 Agent 隐藏未授权类型（“看不见即不可选”）；
- 执行阶段仍保留服务端权限校验，避免仅靠提示词约束。

### D4 — 并行 spawn 提示词双点注入

在两处同步加入并行引导：

1. `spawn_task` tool description：明确“可在单条 assistant 消息中并行发起多个 spawn_task”；
2. 主 Agent orchestration system prompt：明确“独立子任务优先并行 spawn”。

目标是让“并行数量由 LLM 决策”在 Zhin 中成为稳定行为，而不是偶发策略。

## Consequences

- Zhin 将形成“模型自主拆分 + 框架硬限流 + 权限可见性过滤”的混合并发策略。
- 主 Agent 在复杂任务上可提升吞吐，但写操作与交互操作仍保持顺序安全。
- 达到上限时将出现显式拒绝，调用方需自行重排计划，不做隐式排队。
- 子代理类型暴露面收敛，降低误用与越权尝试。
- 异步子 agent 结果默认经主 Agent 续聊出站；副作用（log、额外 IM）走事件 hook，不绑死在 `SubagentManager` 内。

## Non-Goals

- 本 ADR 不引入自动任务拆分算法。
- 本 ADR 不改变子 session 默认禁止嵌套 `spawn_task` 的约束。
- 本 ADR 不定义 background 注入消息协议变更。

## Related

- OpenCode `task.ts` / `task.txt` 按需并行子代理机制（参考实现）
- `packages/im/ai/src/llm/agent-loop.ts`
- `packages/im/agent/src/subagent.ts`
- `packages/im/agent/src/builtin/spawn-task-tool.ts`
- `packages/im/agent/src/spawn/permission-task.ts`
- `packages/im/agent/src/zhin-agent/persist-subagent-context.ts`
- `packages/im/agent/src/zhin-agent/subagent-auto-continue.ts`
- `packages/im/ai/src/llm/tiered-tool-buckets.ts`
- `docs/advanced/ai.md`（Subagent 章节）
