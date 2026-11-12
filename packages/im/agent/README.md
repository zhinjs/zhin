# @zhin.js/agent

Zhin AI Agent 组合层：根入口提供 Agent 创作与领域 API；`@zhin.js/agent/runtime` 提供 CLI composition root 使用的 Host 装配和 generation-owned 执行机制。

领域词汇见 [CONTEXT.md](./CONTEXT.md)。用户向文档：[AI 模块](https://zhin.js.org/ai/)、[消息如何流转](../../../docs/concepts/message-flow.md)。

## Plugin Runtime 入口

`@zhin.js/agent/runtime` 提供目标执行边界 `AgentRuntime`。一次 `execute()` 在完整执行期间持有同一个
immutable snapshot，并从 Tool、Skill、Agent、MCP 四个 Feature projection 生成
owner-visible 能力句柄；公开输入/输出只有 `TurnRequest` / `TurnOutcome`：

```ts
import {
  AgentRuntime,
  AgentTurnCoordinator,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
} from '@zhin.js/agent/runtime';

const coordinator = new AgentTurnCoordinator(); // one per Root, shared by all generations
const runtime = new AgentRuntime({ coordinator });
runtime.attach(snapshotReader);

// Each Agent-enabled generation provides its complete engine during setup.
resources.provide(agentTurnEngineToken, createFullAgentTurnEngine({
  host,
  core,
  sessionSystem,
  contextSystem,
}));

const outcome = await runtime.execute(pluginId, request, {
  mcpServers: activeBinding.mcpServers,
});
```

Tool/MCP 执行 handle 只在 turn lease 内有效，防止访问已 retire 的 generation。
Turn engine 也只从该 lease 的 snapshot 解析；缺失时 fail-closed，不回退到进程全局
runner 或其他 generation。这是迁移完成后的唯一权威契约，不能用缩减执行器替代。

`ZhinAgent` 的 Host 装配函数 `composeZhinAgentRuntime` 属于 runtime 内部面，统一从
`@zhin.js/agent/runtime` 导入；它返回显式的 `host` 契约，composition root 不再通过
`asPrivate` 取得内部状态。根入口也不再导出 classic `ToolRuntime`、builtin policy resolver、
数据库激活或运行时内省函数，避免插件作者依赖生产 `TurnToolRuntime` 之外的第二套执行权威。

`ask_user` 也是 generation-owned Tool capability：工具只拿当前 Turn 的 `QuestionPort`。
IM 入口由 `createRuntimeQuestionPort` 把它接到 `@zhin.js/core` 的会话交互（`ImRuntime.createInteraction`），
后续回复由 core 在 middleware/command/Agent fallback 前认领。HTTP/A2A 等入口若要支持交互，
必须显式提供自己的 QuestionPort；Schedule 等 unattended Turn 缺省 fail-closed。

## Turn Isolation

IM、HTTP、A2A 与 Schedule 只构造 immutable `TurnRequest`，再调用 process-owned
`AgentRuntime`。完整 engine、Tool/Skill/Agent/MCP capability 与 prompt runtime 均从
该请求持有的 generation lease 解析；不得在消息前改写 `ZhinAgent.activeBinding`、
`bootstrapContext`，也不得用 synthetic IM `Message` 调 `processTurn()` 充当新入口。

### Turn Cancellation

`TurnRequest.signal` is propagated through `AgentTurnCoordinator`,
`PromptController`, provider streaming, and tool execution. A
cancelled queued message is removed before execution; a running turn receives
the same signal and cannot publish a late reply. `ai.trigger.timeout` uses this
path, rather than racing a Promise and leaving work running in the background.

`TurnSupersededError` means a newer message replaced the same-session turn.
`TurnCancelledError` means an explicit caller cancellation. Hosts should not
turn either condition into an ordinary assistant reply.

### Incremental reply parsing

Each answering attempt owns one append-only JSON candidate. Standard prefixes scan only new
input and reuse unchanged nodes; non-public reactions do not materialize the growing message
body. The existing decoder/schema still validate segments and the complete final response.
SDK-specific repair syntax retains the original parser as a compatibility fallback; its worst-case
cumulative parsing cost remains. Signed, fractional and exponential numbers use it temporarily
while their partial spelling needs repair, then resume the incremental path once reliably retained.
No parsing delay or new input/depth limit is introduced.

Differential tests use a frozen pre-migration parser, prefix/chunk corpora, and real reply scheduling.
Run the synthetic comparison from the repository root with
`node --expose-gc --conditions=development --import tsx packages/im/agent/tests/benchmarks/reply-parser.ts`.
Its timings and sampled heap are local parser evidence, not provider latency or a production bound.

### Shared-session intent

`TurnRequest.intent` 明确描述一条入站消息如何影响同 session 的 active turn：
`supersede`、`steer`、`follow_up`、`new`（FIFO）或 `observe`。产品入口应显式解析 intent；
为兼容现有行为，省略时以及普通 IM 入站默认解析为 `supersede`。现有
`ai.agent.mailbox.groupMode: fifo` 会将普通重叠消息解析为 `new`（FIFO），但 Agent Runtime
不会自动猜测多人共识。
`steer` / `follow_up` 可用 `targetTurnId` 精确指向 active turn；intent 由 adapter、
command 或产品策略解析，Agent Runtime 不推断多人共识。跨 principal 的 `steer` / `follow_up`
必须由 Host 的可信产品策略显式设置 `authorizedBy: 'product_policy'`，避免未授权参与者继承
active turn 的工具 authority。
该标记只能由 Host 的 `resolveTurnIntent` 回调产生；入站消息 metadata 自行声明会被拒绝。
授权表示产品策略明确允许控制 active turn，工具仍按 active turn 的 authority 执行。
Endpoint-owning plugin 也可通过 `turnIntentResolverToken` 注册按 adapter / scene 生效的可信
resolver；Host 从当前 generation snapshot 读取它，因而热重载与 capability ownership 保持一致。
Tool Journal 同时记录 active-turn `principal` 与最近参与者消息的 `causedBy`，用于区分
“谁拥有该 Turn 的执行 authority”和“哪个参与者 Turn 导致了该工具调用”。

Composition root 为每个 generation 创建独立的 `ScheduleManager`，并将它传给
`createScheduleTools(manager)`；返回的 Tool definitions 闭包绑定该 manager，随 snapshot
一起发布和退休。禁止通过模块级注册表解析“最新”调度引擎，否则旧 generation 的在途
turn 会跨代执行。

## 功能特性

- 🤖 **agentLoop 统一路径**：主回合与受限 Actor 回合均经 `@zhin.js/ai` 的 `agentLoop`
- 📝 **会话持久化**：`AgentSessionStore` + `ContextRepository`；IM 事实由 `ConversationEventStore` 独占
- 🧠 **ZhinAgent**：与 Zhin 消息流集成的智能体（SOUL/TOOLS/AGENTS、工具收集、执行策略）
- 🔍 **明确模型目录**：管理员确认协议与能力后写入 Service；刷新仅返回观察结果，不自动扩大可用模型
- 🔄 **固定模型与重试**：聊天、多模态主回合与 standalone 固定本轮选定模型；失败仅按原配置在同一模型上重试，不跨模型降级。媒体感知保留显式配置的 perception 用途的 fallbacks 备用链
- 🛡️ **6 层 Bash 安全**：`ExecPolicy` 纵深防御（危险黑名单、环境变量剥离、wrapper 剥离、复合命令拆分、只读放行、交互式审批）
- 📂 **文件访问安全**：`FilePolicy` 路径检查、设备路径拦截、命令读写分类
- 📋 **精简系统提示词**：`PromptSegmentRegistry` 组装 `system` → `environment` → `role_rules` → `platform` → `scene` 五层文本分段，并在缓存断点处切分 `SystemPromptSplit`（ADR 0041 / 0042）
- 🧩 **代际提示词能力**：插件通过 `promptSegmentToken`（或 `@zhin.js/prompt-section`）向当前 Runtime generation 贡献文本段，随 generation 发布与释放，并在 `systemPromptMaxChars` 预算下明确保留或失败
- 🔌 **框架挂载**：Plugin Runtime (basic/cli) 装配 Agent 服务，通过 Scope+Token 提供
- 📦 **上下文与记忆**：`ContextRepository`（`agent_messages`）、`AgentSessionStore`；聊天事件从 `ConversationEventStore` 游标消费
- ⏰ **定时任务**：`ScheduleManager` + `createScheduleTools`（`schedule_*` 工具）、`schedule-domain/` 执行记录
- 🔧 **内置工具**：bash、read_file、write_file、ask_user、web_search、`inspect_conversation_reference` 等
- 📐 **Compaction（ADR 0010）**：生产 `agentLoop` 接线 L1 micro + L2 LLM；IM `/compact`；yaml `ai.agent.compaction`
- 🌳 **会话树**：`parent_id` + `active_leaf`；IM `/tree`、`/reset`；branch summarization；Console `GET/POST /api/agent/sessions/...`
- 🪝 **Hook 系统**：generation-owned `AgentResourceHub.hooks` 与 canonical stream events

## 定时任务执行记录

更新 Host 与 Console 后，在「定时提醒 → 执行记录」查看每次运行的时间、各次尝试、基本过程、最终结果和独立的通知投递结果。读取及清理需要当前 Host 的 `full` 权限；模型诊断轨迹按需读取，继续沿用原有 Trace 保留规则。

执行记录沿用部署的文件或 SQL 存储，保留一个 UTC 自然月。删除任务定义仍可查看未到期历史；「清理过期记录」只清理到期且非活动的执行记录。重启前没有结算的记录显示为中断或待核对，不自动续跑。

失败后，只有实际调用能够证明整次尝试可安全重放时，才在既有次数内重试。已提交或无法确定副作用的调用不会从头重跑；通知或观察记录失败也不触发任务重放。插件的 `readOnly` 声明必须真实，不按工具名或返回文字猜测。

记录写入与任务执行分离。慢存储时合并同次运行的快照，待保存终态最多 128 份／16 MiB（含正在写入的一份）；超大、满载或写入失败时显示记录缺口，不能据此判断任务没有执行。详细设计与验收见[定时任务方案](../../../docs/plans/schedule-outcome-retry-safety.md)。

## 依赖关系

- 依赖 **@zhin.js/core**（IM 类型与消息链）与 **@zhin.js/ai**（`agentLoop`、Provider 抽象）
- **zhin.js 1.1.x 稳定线**主包为 optional peer；运行时通过 `zhin.js/agent` 子路径或本包 import

## PromptSegmentRegistry 与提示词组装（ADR 0041 / 0042）

`buildRichSystemPromptParts()` 通过 `PromptSegmentRegistry` 按固定五层文本段顺序
（`system` → `environment` → `role_rules` → `platform` → `scene`）与段内 `weight` 降序组装系统提示词，
并在 `scene` 段之前设置缓存断点，将无时钟的稳定前缀与易变尾部切分为 `SystemPromptSplit`
（`{ stable, scene }`）下发给 Provider 以复用前缀缓存。

插件通过 `promptSegmentToken`（或 `@zhin.js/prompt-section`）注册文本段，随所在 generation 生命周期自动挂载与释放；
重复 `id` 会在组装时被拒绝，最终内容按 `retention`、`budgetOrder` 和 `maxChars` 执行预算策略。
`PromptAssemblyRegistry` 仅作为向文本段投影的 `@deprecated` 兼容适配层保留。

## 模块化架构（理想蓝图 8 模块）

`src/` 按职责拆分为 8 个理想模块：

```
packages/im/agent/src/
  core/          Agent Core — agentLoop 薄适配（ADR 0009）
  tool/          Tool System — Source/Filter、deferred 解析、运行时
  session/       Session System — Agent session/history；IM conversation context 由 ConversationEventStore 游标提供
  event/         Event System — Agent turn 域事件（不替代 Kernel RunEvent）
  skill/         Skill System — SkillRegistry 统一出口
  memory/        Memory System — Port → ContextRepository + host-owned compaction runtime
  collaboration/ Actor Collaboration — HostMailbox + ask/delegate/tell/follow_up/board/escalate（ADR 0048）
  context/       Context System — builder/injector 链、tail limit
  prompt/        系统提示词、assembly、workspace 模板
  turn/          Turn pipeline、inbound 队列、auto-continue、metrics
  config/        ZhinAgent 配置 SSOT、model harness
  resource-hub/  Skill / SubAgent / MCP / Hook support resources
  zhin-agent/    ZhinAgent 门面类（单文件 index.ts）
  init/          Plugin Runtime 组合、数据库激活与 ZhinAgent dispose 生命周期
```

Actor 间协作（`ask` / `delegate` / `tell` / `follow_up` / `board_read` / `board_write` / `escalate`）与权限单调衰减、预算守恒、Engagement Journal 由 [`@zhin.js/harness`](../harness/README.md) 承载；多 Bot 同场 Venue 路由与发言席位锁由 [`@zhin.js/core`](../core/README.md) `venue` 模块承载（见 [ADR 0048](../../../docs/adr/0048-agent-harness.md)）。

`AgentResourceHub` 是 generation-owned 的 Agent 支持资源入口，管理 Skill、Agent、MCP 与 Hook，不拥有 Tool 状态。Tool 只通过 `tools/<name>/index.ts` 或 `context.addTool()` 进入候选 generation，由唯一 `ToolIndex` 发布。

Agent 生命周期事件由本包的 `AIEventPayload` / `AIEventName` 定义。Runtime 消费方通过
`subscribeAIEventsOnTarget` 订阅显式 event target；事件契约不再挂在经典 `Plugin` namespace，
也不再写入经典 `Plugin.dispatch()` 链或依赖 Plugin AsyncLocalStorage 恢复隐式上下文。
组合根为每个 generation 创建 `AgentEventBus`，以 `agentEventBusToken` 发布给同代服务并在
retire 时清理；旧代在途事件不会进入候选代。`ZhinAgent`、ToolRuntime 与事件系统都不持有
经典 `Plugin` 对象。请求者角色来自 IM 入站阶段写入的消息身份，Skill 来自 generation
capability projection 与标准工作区目录，不再遍历可变 Plugin 树。

Root Host 若要接入远程 Tool / Skill Provider，可在 generation Scope 提供
`capabilitySeamToken`。`CapabilityIngress` 会把 `SeamIntegration` 投影进同一份 immutable
`AgentCapabilities`；Tool 仍只能由 `TurnToolRuntime` 执行，因此不会跳过 owner 可见性、
permission、approval、generation lease 或 Journal。普通 npm 插件继续优先使用 Tool / Skill
Feature；Capability Seam 属于 Advanced Root Host 扩展口，详见
[能力接缝](../../../docs/concepts/capability-seams.md)。

**Agent Core**：`AgentCore.runText()` 为 `AsyncGenerator<TurnEvent>` SSOT；`runTextTurn` 为 collector（图片回合同样走 `runText`，以媒体块输入）。组合层经 `composeZhinAgentRuntime` 注入 8 模块 + `createAgentCoreDepsForCompose`。

可选 subpath（`package.json` `exports`）：

```typescript
import { AgentCore } from '@zhin.js/agent/core'
import { ToolSystem } from '@zhin.js/agent/tool'
import { SessionSystem } from '@zhin.js/agent/session'
// …/event、/skill、/memory、/context、/prompt、/turn、/config、/security、/trace、/runtime
```

词汇与边界见 [CONTEXT.md](./CONTEXT.md)。

## 安装

```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # 示例：按厂商安装 provider SDK
```

仅 IM、不需要 Agent 时可只装 `zhin.js`（见 ADR 0019）。

## 使用

### 在 Zhin 项目中

实例装配根（`zhin.js/instance`）装配 Agent Host；Service、Account、Profile 和用途在 Console 管理。向导只生成 `ai.plan.yml` 导入提案，保存后由管理员预览并显式导入。模型能力必须明确声明，不由模型名字推测。见[模型服务与订阅账号](../../../docs/ai/providers.md)。

普通命令／工具通过 `context.use(aiInferenceClientToken)` 使用本次受控执行作用域的 `list/generate/stream/evaluate/image`，不持有全局 Provider 或填写 owner。框架不会自动执行普通推理返回的工具调用。

## 核心导出

| 类别 | 导出 |
|------|------|
| 初始化 | Plugin Runtime composition root 自动装配 |
| Agent | `AgentCore`（`@zhin.js/agent/core`）；底层循环使用 `@zhin.js/ai` 的 `agentLoop` |
| Model harness | `MODEL_HARNESS_DEFAULTS`, `resolveModelHarness`, `mergeModelHarnessValues` |
| 服务与会话 | `AIService`；会话/context 类型见 `@zhin.js/ai`（`ContextRepository`、`AgentSessionStore`） |
| ZhinAgent | `ZhinAgent`，以及 config / exec-policy / file-policy / `@zhin.js/agent/tool` / prompt 等 |
| 安全策略 | `OwnerApprovalRuntime`；`checkExecPolicy`, `applyExecPolicyToTools`, `isDangerousCommand`, `stripEnvVarPrefix`, `stripSafeWrappers`, `splitCompoundCommand`, `extractCommandName`, `ExecPolicyResult`, `checkFileAccess`, `classifyBashCommand`, `isBlockedDevicePath` |
| 提示词构建 | `buildRichSystemPrompt`, `buildRichSystemPromptParts`, `buildUserMessageWithHistory`, `PromptSegmentRegistry` |
| 上下文与记忆 | `ContextRepository`, `AgentSessionStore`（`@zhin.js/ai`）；`ConversationEventStore`（`@zhin.js/im-contract`） |
| 定时 | `ScheduleManager`, `createScheduleTools` |
| 压缩与 Bootstrap | `@zhin.js/agent/memory` 导出实例级 `AgentCompactionRuntime`（IM `/compact` 经 `ZhinAgent.compactSession`）；`loadBootstrapFiles`, `loadSoulPersona`, `loadToolsGuide`, `loadAgentsMemory` |
| Hook | `AgentResourceHub`、`HookRegistry`、`aiHookRuntimeBus` |
| 内置工具 | generation-owned definitions 见 `src/plugin-runtime/native-*-tools.ts`；回合统一经 `ToolIndex` / `TurnToolRuntime` 执行 |
| 输出与检测 | `parseOutput`, `renderToPlainText`, `detectTone`（`@zhin.js/ai`） |
| 支持资源 | `AgentResourceHub`、`SkillRegistry`、`SubAgentRegistry`、`McpRegistry`、`HookRegistry` |
| MCP 客户端 | `McpClientManager`、`McpClientConnection`、`mcpToolToAgentTool`、`ensureMcpConnections`（见下方「MCP」） |
| 限流 | `RateLimiter`（`@zhin.js/ai`）、`UsageQuota` |

类型（如 `ZhinAgentConfig`、`ContextConfig`、`AgentState`、`McpServerEntry` 等）均从包入口导出或从 `@zhin.js/core` 再导出。

## 执行上下文

插件能力通过 Plugin Runtime 注册，运行时通过正式 capability context 使用资源。普通 AI 调用的 token 是 `@zhin.js/ai/provider` 的 `aiInferenceClientToken`。命令与工具结束后 Host 关闭本次资源；流必须完整消费或主动关闭，不能把 client 保存到下一次执行。底层 AI 库不依赖 IM/Core。

## MCP（Client）

通过 `ai.mcpServers` 注册 Server；MCP 声明进入候选 generation，激活时建立连接，工具以 owner-qualified 名称进入能力目录。任一已配置连接未 ready 都会阻止候选代发布（fail-closed）。需可选安装 `@modelcontextprotocol/sdk`（peer dependency）。

**记忆**：默认 **文件三层**（`ai.memory` → `data/memory/`）；内置 `read_memory` / `write_memory` 与旧 `ai.memoryMcp` 配置均已移除。工作区 `AGENTS.md` / `TOOLS.md` 由 bootstrap 注入。

```yaml
ai:
  mcpServers:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/zhin-mcp-test"]
```

**限制**：已配置 server 未 ready 时候选 generation 激活失败，旧 generation 原样继续（fail-closed）；resources/prompts 暂不注入模型。与 **`packages/host/mcp`**（MCP **Server**）方向相反。验收见 [examples/test-bot/ACCEPTANCE.md](../../../examples/test-bot/ACCEPTANCE.md)。

## 多 Agent 使用方式

### 1. Actor 协作与委派（ADR 0048）

基于 `@zhin.js/harness` 的统一 Actor 邮局模型：主 Actor 通过 `agents`、`ask`、`delegate`、`tell`、`follow_up`、`cancel_delegation`、`board_read`、`board_write`、`escalate` 与其他具名 Agent 或临时受限 Actor 协作。每次委派携带单调衰减的 `Authority` 与守恒的 `Budget`（`modelCalls` / `tokens` / `wallMs` / `sideEffects`），全链路记入 `EngagementJournal`，可通过 `zhin trace <engagement>` 审计。

关键路径：

- `src/collaboration/host-mailbox.ts` — `HostMailbox` 入站队列、合并窗/弹幕窗与 Engagement 生命周期
- `src/collaboration/tools.ts` — 协作工具定义与 `GuardKernel` / `BudgetLedger` 对接
- `src/collaboration/actor-turn.ts` — 受限 Actor 回合执行器
- `src/collaboration/turn-collaboration.ts` — 回合级协作会话与 Venue 可见性投影
- `packages/im/ai/src/llm/tiered-tool-buckets.ts` — tiered 并行工具 SSOT

### 2. 多 Bot 同场协作（Venue）

通过 `ai.venues` 声明同群多 Bot 成员与可见性（`visible` / `summary` / `backstage`），由 `@zhin.js/core` 的 `VenueRegistry`、`routeVenueMessage`、`VenueFloorController` 与 `VenueProjector` 驱动同群点名协作与后台静默协作。详见 [多 Agent 协作与同场 Venue](../../../docs/ai/multi-agent-harness.md)。

## 工具命名策略

- 保留/内置工具名（如 `bash`、`read_file`、`ask_user`）不可被插件或文件化工具覆盖。
- 非保留工具同名时采用 **后注册覆盖前注册**。
- 冲突统一以 warn 记录：包含 `name`、`source`、`action`（`ignored`/`overridden`）。

## 模型配置

运行时图是唯一选型权威：Service 定义协议与公开设置，Account 持有私有认证身份，Profile 绑定账号、native model 与生成参数；用途和个人 Session 选择 Profile。配置更新下一回合生效，在途请求保留原图。同 Profile 改模型后，已有 Session 下回合跟随；跨 Account/incarnation 不自动继承。

目录刷新是显式管理操作，只返回上游观察结果；管理员确认协议与能力后才能纳入 Service。普通调用不自动 `/models` 探测。旧 Provider／ModelCatalog／model-policy 接口及升级版本边界见[公开升级说明](../../../docs/ai/provider-upgrade.md)。

## Model harness

按真实 Service 与 native model 调整执行预算；采样参数与输出上限仍由 Profile 管理。

合并顺序：内置 exact Driver／native model 默认 → `services.<Service ID>.defaults` → `services.<Service ID>.models.<native model>`。旧 Provider 别名、通配符和 `provider:model` 键不能继续使用，迁移时须明确选择目标 Service。

```yaml
ai:
  agent:
    modelHarness:
      services:
        service-7f42:          # Console 中的真实 Service ID
          defaults: { maxIterations: 7 }
          models:
            gpt-4o: { maxIterations: 9 }
```

运行时使用 `resolveModelHarness({ driver, serviceId, modelId, config })`。支持迭代上限、探索预算／提醒、空回复重问及请求超时；未知设置不授予额外能力。新增内置规则必须声明完整 Driver owner/id/contract 与 native model 模式，并附正反回归，不能只凭模型名字给未知 Driver 应用规则。

## IM 管理命令

由 `src/init/runtime-management-commands.ts`（`handleRuntimeManagementCommand`，在 ingress 管理阶段调用）处理（master / 有权限用户）：

| 类别 | 命令 |
|------|------|
| 会话 | `/compact` · `/tree` · `/tree N` · `/reset` |
| 运维 | `/models` · `/health` |
| 内省 | `/cmd` · `/endpoints` · `/bindings` · `/tools` · `/mcp` |

zhin-package CLI：`zhin packages`（`basic/cli`）。详见 ADR 0010。

## 开发

### 项目结构

```
src/
├── index.ts                  # 包根导出（创作与领域 API）
├── service.ts                # AIService
├── zhin-agent/               # ZhinAgent 门面类
├── plugin-runtime/           # `@zhin.js/agent/runtime`：AgentRuntime、回合引擎、原生工具（native-*-tools.ts）
│   ├── host/                 #   Host 装配：runtime-foundation、publication/persistence coordinator
│   ├── ingress/              #   IM 入站 → TurnRequest（unified-mailbox-spine、管理命令阶段、端口）
│   └── inference/            #   operation-bound 推理客户端与模型运行时接线
├── core/                     # Agent Core — agentLoop 薄适配、回合 setup/settlement、进度与探索预算
├── turn/                     # Turn pipeline、准入、checkpoint、metrics
├── collaboration/            # Actor 协作与 HostMailbox（ADR 0048）
├── tool/                     # Tool System — Source/Filter、deferred 解析、TurnToolRuntime
├── tool-catalog/             # 延迟加载工具目录与回合控制器
├── session/                  # Agent session / history 投影
├── context/                  # 回合信封、历史窗口、AGENTS 指令链
├── prompt/                   # 系统提示词分段、assembly、workspace 模板、rules/
├── memory/                   # Memory System 与 compaction runtime
├── skill/                    # Skill 注册与渐进披露
├── resource-hub/             # AgentResourceHub：Skill / SubAgent / MCP / Hook registry
├── mcp-client/               # MCP 客户端连接与工具桥接
├── seam/                     # Capability Seam（远程 Tool / Skill Provider 接缝）
├── authoring/                # defineSkill / defineHook / defineEval（`/skills`、`/hooks`、`/evals`）
├── discovery/                # agents/<name>/ 包发现与 `zhin agent` 信息报告
├── config/                   # ZhinAgent 配置 SSOT、agent bindings、model harness
├── model-runtime/            # 模型执行 scope 与 completion 服务
├── decision/                 # 决策（审批判断、检索排序）配置与类型
├── security/                 # exec/file/network 策略、shell-syntax、硬闸与审批、sandbox(-docker/-mounts)、用量配额
├── self-change/              # 自我配置变更的草拟、预览、审批与应用
├── assistant/                # 助理 home、定时 job 存储与投递
├── schedule-domain/          # 定时任务执行域：历史、重试证据、输出校验
├── journal/                  # 回合 journal 与投递记录
├── trace/                    # 回合 trace、上下文预算报告、归档
├── event/                    # Agent turn 域事件
├── media/                    # 入站媒体归一化、感知、图片资产与发布
├── outbound/                 # 结构化回复解析、渐进投递、主动发送
├── activity-feedback/        # 活动反馈（typing / 进度）配置与投影
├── typing-indicator/         # 输入中指示器适配
├── personal-session/         # 个人 Session 选择服务
├── migration/                # 旧 Provider 配置 → ai.plan 迁移
├── web/                      # 网页抓取 / 搜索解析
├── init/                     # Plugin Runtime 组合、数据库模型与激活、管理命令、dispose
├── internal/                 # host 契约、asPrivate、turn-context、phase/prompt trace
├── utils/                    # disposable、keyed-mutex
│
├── bootstrap.ts / bootstrap-scope.ts      # SOUL/TOOLS/AGENTS 引导文件加载与作用域
├── schedule-manager.ts / schedule-cron.ts # ScheduleManager 契约与 schedule_* 工具、cron 解析
├── task-executor.ts                       # 定时任务执行器（`@zhin.js/agent/task-executor`）
├── common-adapter-tools.ts                # 群管工具工厂（适配器复用）
├── group-rules.ts / announcements.ts      # 群管规则与公告存储
├── scene-facts.ts / scene-events.ts       # 场景成员事实与场景事件
├── user-profile.ts / user-relation*.ts / session-profile.ts
├── session-ops.ts / session-events.ts / session-tree-runtime.ts
├── decision-events.ts / decision-event-log.ts / control-plane.ts
├── ai-event-*.ts / ai-hook-runtime-bus.ts / plugin-*-hook*.ts  # 事件与 Hook 总线
├── memory-layers.ts / reserved-tools.ts / tool-bridge.ts
```

### 构建

```bash
pnpm build   # 或 npm run build
pnpm clean   # 清理 lib
```

## 许可证

MIT License

## Structured IM replies

IM conversations default to schema-constrained `{ "segments": [...] }` final
answers, composing text, Markdown, mentions, images and other media in order. Agent validates the complete object once and
carries an `AgentOutputElement` (`type: 'message'`, canonical `segments`) through
the terminal journal, reply port and media publisher. The AI package's generic
`OutputElement` contract remains transport-neutral. Tools and host notices can
still produce generic output elements.

Mention targets are platform user IDs from the conversation or member lookup
tools. The schema does not verify membership or resolve ambiguous nicknames.
Detached and non-IM turns do not inherit the IM preset; an explicit custom schema
belongs to its caller. See [结构化回复](../../../docs/ai/structured-replies.md) for
validation, provider requirements, failure behavior and the delivery boundary
([English](../../../docs/en/ai/structured-replies.md)).
