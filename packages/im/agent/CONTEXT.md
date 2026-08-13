# Agent Runtime

Agent Runtime 在 Core IM 概念之上负责 AI 编排：ZhinAgent 回合、工具选择、技能、子代理、上下文预算和安全策略。它的边界是让 Agent 行为保持显式，同时不把 IM 语义下沉到 `@zhin.js/ai`。

## 语言

**ZhinAgent**:
消费 **Turn Ingress** 的 Agent 运行时，负责准备提示词、收集工具、运行模型回合，并产出 **Turn Outcome**；不接收或保存任何 IM `Message` 对象。
_避免使用_：assistant、bot brain、AI plugin

**Turn Ingress**:
Agent 唯一入站契约；由 IM、HTTP、A2A、Schedule 等入口在 composition root 构造。包含不可变的 origin、principal、content/media、session address、generation/trace/turn identity、policy context 和 cancellation signal，并注入 turn-scoped ports。网络能力必须由 policy context 显式授予；缺省为禁用，HTTPS/域名约束随 turn 固定。它属于 Agent 域，不是 IM Message 的别名。
_避免使用_：commMessage、synthetic Message、bridge message、Message.extra

**Turn Ports**:
仅在当前 turn 或明确派生 operation 内有效的能力端口，包括 `ReplyPort`、`DeliveryPort`、`ApprovalPort`、`ActivityPort`；Agent 核心通过端口请求副作用，不持有 Adapter、Endpoint、Plugin 或 Message。
_避免使用_：Message.$reply、Adapter.sendMessage、host Plugin、回调字段包

**Turn Context Envelope**:
从 canonical Turn 的 origin、principal 与 session address 生成模型可见的运行时上下文。它不解析 IM `Message`；IM 入口只能在最外层 adapter 将已认证的平台字段投影为 Turn，Schedule、HTTP、A2A 与 Internal 直接使用各自 origin。
_避免使用_：从 `$adapter/$endpoint/$channel/$sender` 读取上下文、为非 IM turn 伪造平台字段、Schedule 专用 prompt 分支

**Agent Prompt Profile**:
显式选择 `interactive | schedule` 的不可变 prompt 输入。Schedule profile 在进入公共 prompt assembly 前已固定 job、creator 与 security；公共层不得从 ALS 猜测执行域，也不得借用 synthetic IM identity 读取平台 prompt 或记忆。
_避免使用_：`getScheduleTurnContext()`、ambient prompt mode、Schedule 借用 IM file memory

**Turn Outcome**:
Agent 执行的唯一终态，判别为 `completed | failed | cancelled | budget_exceeded`，包含输出内容、usage、tool calls 与 terminal reason；每个 turn 恰好产生一次，并先进入 Event Journal，再由入口决定同步返回、流式投影或投递。
_避免使用_：string reply、throw-or-message 双轨、无终态 generator

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
在 Tool Selection 之后决定最终运行时工具列表、上下文工具注入和 Pre-executable Tool 路径的 Agent Runtime 模块。每次执行只接收 canonical Tool Execution Context（origin / principal / session / trace / signal / policy），不得读取 IM Message 第二参数。执行前必须统一经过 `runTurnToolPolicies`；文件 CRUD、敏感路径和 Bash 命令不得在 Tool 实现内另建策略链。网络 transport 的每个真实 hop 必须消费同一 context policy，禁止依赖 ALS 或执行域特判。
_避免使用_：tool glue、runtime helper

**Capability Feature**:
Plugin 侧可写能力表（Tool / Skill / Agent / MCP），承载装配与生命周期；**不是**回合执行时的运行时权威。
_避免使用_：tool service 真相源、双注册、registry bag

**ToolFeature** / **SkillFeature**:
Core IM 中的能力 Feature；插件与文件发现在装配期写入此处。
_避免使用_：Orchestrator 直写、回合 SSOT

**AgentFeature**:
Agent Runtime 中的专长 / 子代理预设 Feature（对齐 `*.agent.md`）；**不**替代配置里的主 Agent 选用。
_避免使用_：AgentPresetFeature（作为唯一对外名）、主绑定 SSOT

**MCPFeature**:
Agent Runtime 中的 MCP server **声明** Feature；不含已连接后的工具列表。
_避免使用_：已连接工具池、MCP host server

**Capability Ingress**:
把 Capability Feature（及常驻核心）按需装入 **Agent Orchestrator** 的 seam；Boot 装 reserved/builtin，入站按 `canAccessTool`（platforms / scopes / permissions）装载并按可达投影缓存；换出上一轮 on-demand 条目（有活动回合持有时延迟到 lease 释放再清除）。实现类为 `FeatureCapabilityIngress`（`src/ingress/`），与 `@zhin.js/agent/runtime` 的 Plugin Runtime `CapabilityIngress`（`src/plugin-runtime/`）区分。
_避免使用_：双写 bridge、mount 全量同步、作者侧第二套 adapter/scene/role 声明语言

**Tool Ingress**:
历史称呼；现由 **Capability Ingress** 覆盖 Tool 路径（作者写 Feature → Ingress → Orchestrator）。
_避免使用_：tool service、双注册、Feature 当回合 SSOT

**Permission Level**:
Tool 进入模型前用于比较调用者和工具权限的有序权限词汇；装载过滤复用 `platforms` / `scopes` / `permissions`。
_避免使用_：role、ACL、rank、独立的 adapter/scene_type/sender_role 轴

**Skill**:
面向任务的能力包，可以为用户请求浮现配套 Tool。
_避免使用_：plugin、prompt、recipe

**Subagent**:
用于更窄任务或角色的委派 Agent 预设（常来自 **AgentFeature**）。
_避免使用_：worker、child bot、helper

**Agent Binding**:
配置 `agents[].match` 解析出的主路径选用结果；入站选用权威在配置，不在 AgentFeature。
_避免使用_：Feature match、preset 当主绑定

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

**Schedule Tools**:
`schedule_*` 是原生 `AgentToolDefinition`，创建者与 IM notify 目标只从 canonical invocation principal/origin 派生。每组 definitions 闭包绑定当前 generation 的 `ScheduleManager`，禁止模块级“最新 manager”注册表。
_避免使用_：`ZhinTool`/`Message` 第二参数、跨 generation manager lookup、无 IM origin 时静默把 IM notify 降为 silent

**Schedule Execution Plan**:
预演确认后固化的 prompt / tools / skills 快照，经 `addScheduleJob` 持久化到 `schedule-jobs.json`；到点执行时由 **Schedule Execution Domain** 直接解析并装载，完全跳过 deferred snapshot 与 meta tools。
_避免使用_：optimizePrompt、extra 上的 executionPlan

**Schedule Turn**:
由 Schedule Execution Domain 直接构造的 **Turn Ingress**（`preview` 预演或 `scheduled` 到点执行）；没有 synthetic IM 载体，也不继承会话回复能力。Schedule authority 作为显式参数贯穿 Context、Prompt 与 Tool pipeline，不写入 ALS；正式执行的 Delivery Intent 在新 operation 中通过 `DeliveryPort` 投递并独立记录终态。
_避免使用_：synthetic Message、ambient scheduleContext、scheduleContext 兼容分支、mutate Message.extra

**Passive Group Context**:
群/频道未 @ 入站消息写入进程内 buffer（`MAX_PASSIVE_LINES=50`、`PASSIVE_TTL_MS=30min`），@ 触发时 drain 合并进 turn；session key 与 `resolveAgentTurnSessionKey` SSOT 一致；pipeline reset 后不继承旧 run buffer。
_避免使用_：持久化 passive、跨 run 继承旁听

## 智能家居（Home Assistant）

**HaHomeBackend**:
Home Assistant REST 客户端：别名解析、读状态、调用服务。当前唯一 smart-home 后端。
_避免使用_：HomeBackend、多 provider 工厂、Native 适配器

**HomeFacade**:
交互式控制门面：别名 + 权限（master / confirmServices）+ 意图方法（turnOn、setBrightness 等）；返回判别联合供 tools 映射。
_避免使用_：在每个 home_* tool 内重复 guard、把鉴权塞进 HaHomeBackend

**Home Tool**:
`home_*` 是原生 `AgentToolDefinition`，只从 canonical `ToolExecutionContext.principal` 读取已认证角色，参数校验后委托 **HomeFacade**。
_避免使用_：旧 `Message` 第二参数、直接调 REST、暴露 entity_id、在 Home 域重新推断平台身份

**HomeStateWatch** / **HaWsTransport**:
可选状态推送：Transport 负责 HA WebSocket 鉴权/订阅/重连；Watch 负责别名过滤、防抖与 NotificationRouter 投递。
_避免使用_：经 HomeFacade 鉴权推送、createEndpointLifecycle 硬套 HA 客户端

**Agent Turn Session Key**:
`resolveAgentTurnSessionKey`（transport + 可选 `pipeline:{runPrefix}:`）为 turn 级 SSOT；passive write / @ drain / auto-continue depth / persist 共用。
_避免使用_：私有 `resolveTurnSessionKey`、snapshot 与 cell 双轨 key

`agent_sessions` 只持有 origin-neutral session key / epoch / model / status；IM platform、endpoint、scene 仅属于 IM transcript projection。HTTP、A2A、Schedule 与 Internal turn 不得伪造 IM session address。
Session lifecycle 写权威只有 `ContextRepository`；archive 不得再代理后重复调用底层 Store。持久化异常不是 Not Found，入口必须 fail closed。

## 关系

- 插件与文件发现向 **Capability Feature** 写入；**Capability Ingress** 在 Boot（常驻核心）与入站（命中 **Agent Binding** 作用域）把能力装入 **Agent Orchestrator**；回合只读 Orchestrator。
- **ZhinAgent** 通过 **Agent Orchestrator** 发现已装载的 **Tool**、**Skill**、**Subagent** 与 Hook；MCP **声明** 在 **MCPFeature**，generation 激活时连接，入站再按 **Agent Binding** 的 `mcpServers` 过滤；工具以 `${qualifiedServer}__${tool}` 的 owner-qualified 名称并入工具池。
- 主路径 Agent 选用由配置 **Agent Binding**（`agents[].match`）决定；**AgentFeature** 仅提供专长 / **Subagent** 预设。
- **Tool Selection** 在 **Permission Level** 检查后把 **Tool** 转换为 **AgentTool**；装载过滤与 Selection 共用 `platforms` / `scopes` / `permissions`。
- **Tool Runtime** 基于 **Tool Selection** 的结果补充上下文工具，并决定 **Pre-executable Tool** 是走快速路径还是完整 Agent 路径。
- **Skill** 可以在通用相关性过滤前贡献 Tool。
- **Context Budget** 同时约束提示词历史裁剪和底层 `@zhin.js/ai` Agent 配置。
- **Pre-executable Tool** 在主模型回合前产出上下文。
- **Subagent** 使用与父级 Agent Runtime 相同的 Provider 和预算词汇。
- **Schedule Turn** 在 turn-pipeline 中顺序执行 resolve → preload → capture before → rehydrate skills；预演 delta 由 `getLastTurnToolSnapshot` 采集本 turn 新增 tools/skills。
- IM、HTTP、A2A、Schedule 只在 composition root 适配为 **Turn Ingress**；从该边界起，Session、Tool、Policy、Event、Subagent 与 Agent Core 不得读取 IM `Message`、`Plugin`、`Adapter` 或 `$adapter/$endpoint/$channel/$sender` 字段。
- 每个启用 Agent 的 generation 必须在 root resources 提供唯一 `AgentTurnEngine`；`AgentRuntime` 只从当前 turn 所持 snapshot 解析它。缺失时 fail-closed，禁止构造器捕获 runner、进程全局 runner 或跨 generation fallback。
- Prompt contributor 与 PromptController 只消费 canonical platform / session identity；不得接收或保存 IM `Message`。平台 Prompt 仅对 IM origin 生效，其他 origin 不伪造 IM 载体。
- Passive Group Context 只按 canonical session key 记录与 drain；IM/协作 adapter 在边界外解析 session、sender 后提交 observation，Session System 不保存 `Message` 或 `CollaborationScene`。
- 入站媒体处理只消费 `TurnMedia[]`；平台 segment / opaque file id 到 canonical media 的投影只存在于 ingress adapter，STT、物化与模型注入不得反向读取 IM `Message`。
- 同步 IM 回复由 snapshot-bound `ReplyPort` 完成；HTTP 流由 Event Journal projection 完成；主动或延迟投递持久化为 `DeliveryIntent`，以带 `parentTurnId` 的新 operation 执行，不偷偷重新获取 current generation 后冒充原 turn。

## 示例对话

> **开发者：** “我可以直接注册一个模型函数作为 **AgentTool** 吗？”
> **领域专家：** “装配期写入 **ToolFeature**（或 `defineAgentTool` 发现）。**Capability Ingress** 再装入 **Agent Orchestrator**；**Tool Selection** 负责权限检查、上下文注入，以及转换为 **AgentTool**。”

## 已标记歧义

- “tool” 过去同时指 Zhin 运行时工具和 Provider 工具。已决议：**Tool** 是面向 Zhin 的契约；**AgentTool** 是 `@zhin.js/ai` 的契约。
- “maxTokens” 过去混用了生成预算和上下文容量。已决议：**Context Budget** 表示历史/模型窗口；生成限制仍属于模型或 Provider 选项。
- **MCP Client vs Server**：Client（`mcp-client/`）消费外部 MCP 工具；`packages/host/mcp` 为 MCP **Server**（向外暴露 Zhin 工具）。SDK 为可选 peer；已配置 server 激活失败会使候选 generation 整体失败，旧代继续服务。
- **Kernel vs Dispatcher**：编排 Task 的 `completed` / `failed` / `cancelled` 仅由 **OrchestrationKernel** 写库；**AgentDispatcher** `recordResult` 不得作为编排终态权威（ADR 0027）。Port 契约见 [`src/orchestrator/PORTS.md`](src/orchestrator/PORTS.md)。

## 模块化重构（理想蓝图映射）

> SSOT：`.opencode/plans/refactor-agent-modular-architecture.md`（理想蓝图冻结；迁移路径严格执行）。

### 层级边界契约

```
@zhin.js/ai          stream / agentLoop / Context / Memory / Compaction
       ↑ 仅类型与循环，无 Message / Plugin / Endpoint
@zhin.js/agent       TurnIngress / TurnOutcome + 8 理想模块 + Orchestration + Security
       ↑ 不依赖 Message / Plugin / Adapter；副作用仅通过 Turn Ports
zhin.js + hosts      IM / HTTP / A2A / Schedule ingress adapters 与 delivery projections
```

| 理想模块 | 包内路径 | 主要落层 | 与下层关系 |
|----------|----------|----------|------------|
| Agent Core | `src/core/` | agent | **委托** `@zhin.js/ai` `agentLoop`；禁止自有 LLM 迭代（ADR 0009） |
| Tool System | `src/tool/` | agent | 包装 orchestrator + builtin + MCP 生命周期 |
| Session System | `src/session/` | agent | IM/Agent 双 store + HTTP `AgentSessionHostPort` + `SessionInteractionPort` |
| Event System | `src/event/` | agent | Agent turn 域事件 + **AgentStreamBus**（per-orchestrator egress）；不替代 Kernel RunEvent 或 plugin `before.*` |
| Skill System | `src/skill/` | agent | 包装 `SkillRegistry` + discovery |
| Memory System | `src/memory/` | agent → port → ai | `MemoryStore` 适配 `ContextRepository`；压缩委托 ai compaction |
| Subagent System | `src/subagent/` | agent | `SubagentSystem` spawn/cancel；`ResultSink` 对接 outbound |
| Context System | `src/context/` | agent | 只读 canonical Turn 的 prompt-assembly / turn-user-message builder 链；IM `Message` 投影仅存在于外层 ingress adapter |
| Orchestration（图内） | `src/orchestrator/` | agent | Kernel SSOT（ADR 0027）；不并入 Subagent |
| IM 组合 | `src/init/`、`collaboration/` | agent | 协作入站：`collaboration-dispatch` / `inbound-spawn-task` / `inbound-peer-handback` / `collaboration-kernel-bridge` / `inbound-turn-endpoint` |

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
| **Runtime Event Journal** | ingress / delivery / failure 的事实源；IM/Console/日志只做投影 |

### ADR 对齐确认（阶段 0）

| ADR | 约束 | 模块化重构符合性 |
|-----|------|------------------|
| [0009](../../../docs/adr/0009-pi-aligned-ai-agent-core.md) | 唯一 LLM 入口 `stream` / `agentLoop` | `AgentCore.runText()` AsyncGenerator + `runTextTurn` collector |
| [0004](../../../docs/adr/0004-normalize-queue-outbound-fields-before-im-send.md) | 出站不得旁路统一 delivery pipeline | ReplyPort / DeliveryPort 是唯一入口；Agent 不直接依赖 Message / Adapter |
| [0027](../../../docs/adr/0027-agent-run-orchestration-kernel.md) | Kernel 为 Run/Task 终态 SSOT | Orchestration 保持 `src/orchestrator/`；Dispatcher 仅投影 |
| [0019](../../../docs/adr/0019-install-size-layering.md) | agent 可选 peer、依赖扁平 | 迁移期单包 + 子目录；阶段 5 前不拆 8 个 npm 包 |

**公开 API**：`ZhinAgent` 实现 `config/agent-interfaces.ts` 四接口（`IAgentTurnProcessor` 等）；`@zhin.js/agent` 与 `@zhin.js/agent/config` 均可 import 类型。
