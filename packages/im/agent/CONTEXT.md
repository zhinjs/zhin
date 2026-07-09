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
- **Kernel vs Dispatcher**：编排 Task 的 `completed` / `failed` / `cancelled` 仅由 **OrchestrationKernel** 写库；**AgentDispatcher** `recordResult` 不得作为编排终态权威（ADR 0027）。Port 契约见 [`src/orchestrator/PORTS.md`](src/orchestrator/PORTS.md)。

## 模块化重构（理想蓝图映射）

> SSOT：`.opencode/plans/refactor-agent-modular-architecture.md`（理想蓝图冻结；迁移路径严格执行）。

### 层级边界契约

```
@zhin.js/ai          stream / agentLoop / Context / Memory / Compaction
       ↑ 仅类型与循环，无 Message / Plugin / Endpoint
@zhin.js/agent       ZhinAgent 门面 + 8 理想模块（包内 src/*）+ Orchestration + Security
       ↑ 理解 IM，出站仍走 Message.$reply / Adapter.sendMessage（ADR 0004）
zhin.js + plugins    createZhinAgent、register-ai-trigger、activity-feedback、adapter 绑定
```

| 理想模块 | 包内路径 | 主要落层 | 与下层关系 |
|----------|----------|----------|------------|
| Agent Core | `src/core/` | agent | **委托** `@zhin.js/ai` `agentLoop`；禁止自有 LLM 迭代（ADR 0009） |
| Tool System | `src/tool/` | agent | 包装 orchestrator + builtin + MCP 生命周期 |
| Session System | `src/session/` | agent | IM/Agent 双 store + `resolveAgentTurnSessionKey` SSOT |
| Event System | `src/event/` | agent | Agent turn 域事件；不替代 Kernel RunEvent 或 plugin `before.*` |
| Skill System | `src/skill/` | agent | 包装 `SkillRegistry` + discovery |
| Memory System | `src/memory/` | agent → port → ai | `MemoryStore` 适配 `ContextRepository`；压缩委托 ai compaction |
| Subagent System | `src/subagent/` | agent | `SubagentSystem` spawn/cancel；`ResultSink` 对接 outbound |
| Context System | `src/context/` | agent | prompt-assembly / turn-user-message builder 链 |
| Orchestration（图内） | `src/orchestrator/` | agent | Kernel SSOT（ADR 0027）；不并入 Subagent |
| IM 组合 | `src/init/`、`collaboration/` | agent | 阶段 4：`inbound-turn-pipeline` 编排；`inbound-turn-enrich` / `inbound-turn-route` / `inbound-turn-outbound-stage` / `inbound-turn-endpoint` |

### 现状 → 理想模块映射

| 理想模块 | 实现路径 | 公开入口 |
|----------|----------|----------|
| Agent Core | `src/core/` | `@zhin.js/agent/core` |
| Tool System | `src/tool/` | `@zhin.js/agent/tool` |
| Session System | `src/session/`、`collaboration/resolve-agent-session-key.ts` | `@zhin.js/agent/session` |
| Event System | `src/event/`（含 `event-emitter.ts`、`session-events.ts`） | `@zhin.js/agent/event` |
| Skill System | `src/skill/`、`orchestrator/skill-registry.ts` | `@zhin.js/agent/skill` |
| Memory System | `src/memory/`、`ContextRepository`（ai） | `@zhin.js/agent/memory` |
| Subagent System | `src/subagent/`、`SubagentSystem` | `@zhin.js/agent/subagent` |
| Context System | `src/context/` | `@zhin.js/agent/context` |
| Prompt | `src/prompt/` | `@zhin.js/agent/prompt` |
| Turn | `src/turn/`（`turn-pipeline`、`turn-complete`） | `@zhin.js/agent/turn` |
| Config | `src/config/` | `@zhin.js/agent/config` |
| Orchestration | `src/orchestrator/` | 包根 export + [PORTS.md](src/orchestrator/PORTS.md) |
| IM 组合 | `src/init/`、`collaboration/`、`zhin-agent/`（门面） | 包根 export |
| Host 契约（包内） | `src/internal/agent-host.ts`、`as-private.ts` | 不对外 export |

各模块 `contracts.ts` 承载蓝图接口并与实现对齐（注明已实现 / 未实现项）；`index.ts` re-export 公开 API。ideal 模块仅依赖 `internal/agent-host` 类型与 `asPrivate()`，不 import `zhin-agent/` 实现。

### 事件总线分工

| 总线 | 职责 |
|------|------|
| **EventSystem**（蓝图，`src/event/`） | Agent turn：`turn_start`、`tool_call`、`chunk`、`turn_end` |
| **ZhinAgentEventEmitter** | 现有订阅方、`scheduleContext` 投影；迁移期作 EventSystem 后端 |
| **OrchestrationKernel RunEvent** | Run/Task 持久化事件流；**不合并** |
| **Plugin `before.*` / hooks** | IM 发送链、AI hook；仍走 `@zhin.js/core` |

### ADR 对齐确认（阶段 0）

| ADR | 约束 | 模块化重构符合性 |
|-----|------|------------------|
| [0009](../../../docs/adr/0009-pi-aligned-ai-agent-core.md) | 唯一 LLM 入口 `stream` / `agentLoop` | `AgentCore.runText()` AsyncGenerator + `runTextTurn` collector |
| [0004](../../../docs/adr/0004-normalize-queue-outbound-fields-before-im-send.md) | 出站走 `Message.$reply` / Adapter | Subagent `ResultSink`、proactive 不得旁路发送链 |
| [0027](../../../docs/adr/0027-agent-run-orchestration-kernel.md) | Kernel 为 Run/Task 终态 SSOT | Orchestration 保持 `src/orchestrator/`；Dispatcher 仅投影 |
| [0019](../../../docs/adr/0019-install-size-layering.md) | agent 可选 peer、依赖扁平 | 迁移期单包 + 子目录；阶段 5 前不拆 8 个 npm 包 |

**公开 API**：`ZhinAgent` 实现 `config/agent-interfaces.ts` 四接口（`IAgentTurnProcessor` 等）；`@zhin.js/agent` 与 `@zhin.js/agent/config` 均可 import 类型。

