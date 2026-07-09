# Agent Runtime

Agent Runtime 在 Core IM 概念之上负责 AI 编排：ZhinAgent 回合、工具选择、技能、子代理、上下文预算和安全策略。它的边界是让 Agent 行为保持显式，同时不把 IM 语义下沉到 `@zhin.js/ai`。

## 语言

**ZhinAgent**:
理解 IM 上下文的 Agent 运行时，负责准备提示词、收集工具、运行模型回合，并通过 Core 回复。
_避免使用_：assistant、bot brain、AI plugin

**Agent Orchestrator**:
工具、技能、子代理、MCP 服务和 AI 生命周期 Hook 的注册表所有者。
_避免使用_：manager、registry bag、service locator

**Tool**:
面向 Zhin 运行时的可调用能力，带有元数据、权限级别和可选的上下文注入参数。
_避免使用_：function、command、action

**AgentTool**:
`@zhin.js/ai` 消费的、面向 Provider 的可调用形状。
_避免使用_：raw tool、model tool、function

**Tool Selection**:
把候选 Tool 转换为 AgentTool 的共享流程，包含规范化、权限检查、相关性过滤和 allow/deny 开关。
_避免使用_：tool collection、tool filtering

**Tool Runtime**:
在 Tool Selection 之后决定最终运行时工具列表、上下文工具注入和 Pre-executable Tool 路径的 Agent Runtime 模块。
_避免使用_：tool glue、runtime helper

**Permission Level**:
Tool 进入模型前用于比较调用者和工具权限的有序权限词汇。
_避免使用_：role、ACL、rank

**Skill**:
面向任务的能力包，可以为用户请求浮现配套 Tool。
_避免使用_：plugin、prompt、recipe

**Subagent**:
用于更窄任务或角色的委派 Agent 预设。
_避免使用_：worker、child bot、helper

**Context Budget**:
用于裁剪历史并配置底层 AI Agent 的已解析上下文窗口。
_避免使用_：max tokens、history size、window

**Pre-executable Tool**:
可以在模型回合前执行、用于收集新鲜上下文的 Tool。
_避免使用_：preload、setup action、preflight

## 编排（Orchestration）

**OrchestrationKernel**:
Run 与 Task 持久化状态迁移的唯一权威；Executor 只产出 execution event，由 Kernel 写入终态。
_避免使用_：orchestrator service、mission runner、dispatcher SSOT

**Run**:
用户可见的一单元工作，常源于 IM session 或协作场景（Cell）。
_避免使用_：mission、job、pipeline run（非 Kernel 语境时）

**Task**:
Run 内有生命周期的工作项，可委派给不同 Executor。
_避免使用_：subagent id、spawn id、job item

**Executor**:
执行 Task 的运行时策略（local / scene_mention / remote_mesh），向 Kernel 上报 progress/result/error event。
_避免使用_：worker、handler、直接改 task status

**RunEvent**:
Run/Task 的只追加事件流，供快照与投影消费。
_避免使用_：log line、debug 输出

**Projection**:
从 Kernel 状态派生的只读视图（Console API、REST、IM 进度文案）。
_避免使用_：dispatcher 内存缓存、recordResult

**AgentDispatcher**:
内存中的 Task 投影与依赖调度缓存；从 Kernel 仓库 `syncTaskFromRecord`，不拥有持久化终态。
_避免使用_：SSOT、source of truth、终态写入方

## 调度（Schedule）

**Schedule Execution Plan**:
预演确认后固化的 prompt / tools / skills 快照，经 `addScheduleJob` 持久化到 `schedule-jobs.json`；到点执行时由 `schedule-tool-runtime` 预加载 deferred snapshot，不再写入 `commMessage.extra`。
_避免使用_：optimizePrompt、extra 上的 executionPlan

**Schedule Turn**:
带 TurnContext ALS `scheduleContext` 的 agent turn（`preview` 预演或 `scheduled` 到点执行）；`buildScheduleTurnMessage` 提供 synthetic 载体，hookContext 由 event-emitter 从 ALS 投影。
_避免使用_：mutate 入站 Message.extra、augmentPromptWithExecutionPlan

**Passive Group Context**:
群/频道未 @ 入站消息写入进程内 buffer（`MAX_PASSIVE_LINES=50`、`PASSIVE_TTL_MS=30min`），@ 触发时 drain 合并进 turn；session key 与 `resolveAgentTurnSessionKey` SSOT 一致；pipeline reset 后不继承旧 run buffer。
_避免使用_：持久化 passive、跨 run 继承旁听

**Agent Turn Session Key**:
`resolveAgentTurnSessionKey`（transport + 可选 `pipeline:{runPrefix}:`）为 turn 级 SSOT；passive write / @ drain / auto-continue depth / persist 共用。
_避免使用_：私有 `resolveTurnSessionKey`、snapshot 与 cell 双轨 key

## 关系

- **ZhinAgent** 通过 **Agent Orchestrator** 发现 **Tool**、**Skill**、**Subagent** 与 Hook；MCP 条目经 `addMcp` / `ai.mcpServers` / 可选 `ai.memoryMcp`（`server-memory`）注册，在每次 AI 回合前懒连接，工具以 `mcp_{server}_{tool}` 并入工具池（不再使用内置 `read_memory`/`write_memory`）。
- **Tool Selection** 在 **Permission Level** 检查后把 **Tool** 转换为 **AgentTool**。
- **Tool Runtime** 基于 **Tool Selection** 的结果补充上下文工具，并决定 **Pre-executable Tool** 是走快速路径还是完整 Agent 路径。
- **Skill** 可以在通用相关性过滤前贡献 Tool。
- **Context Budget** 同时约束提示词历史裁剪和底层 `@zhin.js/ai` Agent 配置。
- **Pre-executable Tool** 在主模型回合前产出上下文。
- **Subagent** 使用与父级 Agent Runtime 相同的 Provider 和预算词汇。
- **Schedule Turn** 在 turn-pipeline 中顺序执行 resolve → preload → capture before → rehydrate skills；预演 delta 由 `getLastTurnToolSnapshot` 采集本 turn 新增 tools/skills。

## 示例对话

> **开发者：** “我可以直接注册一个模型函数作为 **AgentTool** 吗？”
> **领域专家：** “优先向 **Agent Orchestrator** 注册 **Tool**。**Tool Selection** 负责权限检查、上下文注入，以及转换为 **AgentTool**。”

## 已标记歧义

- “tool” 过去同时指 Zhin 运行时工具和 Provider 工具。已决议：**Tool** 是面向 Zhin 的契约；**AgentTool** 是 `@zhin.js/ai` 的契约。
- “maxTokens” 过去混用了生成预算和上下文容量。已决议：**Context Budget** 表示历史/模型窗口；生成限制仍属于模型或 Provider 选项。
- **MCP Client vs Server**：Client（`mcp-client/`）消费外部 MCP 工具；`packages/host/mcp` 为 MCP **Server**（向外暴露 Zhin 工具）。SDK 为可选 peer；单 server 连接失败不阻塞 AI 回合。
- **Kernel vs Dispatcher**：编排 Task 的 `completed` / `failed` / `cancelled` 仅由 **OrchestrationKernel** 写库；**AgentDispatcher** `recordResult` 不得作为编排终态权威（ADR 0027）。

