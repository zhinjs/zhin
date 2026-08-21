# @zhin.js/agent

Zhin AI Agent 组合层：在 `@zhin.js/core` 的类型与 Provider 之上，提供会话管理、Agent 执行循环、ZhinAgent 与框架挂载（init）。

领域词汇见 [CONTEXT.md](./CONTEXT.md)。用户向文档：[AI 模块](https://zhin.js.org/advanced/ai)、[消息如何流转](../../docs/essentials/message-flow.md)。

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

`ask_user` 也是 generation-owned ToolFeature：工具只拿当前 Turn 的 `QuestionPort`，
Root-owned `InteractionRouter` 用 canonical session + authenticated subject 匹配后续回复。
IM adapter 在 middleware/command/Agent fallback 前 claim 回复；Router 不保存 `Message`、
Adapter 或过期回复句柄。HTTP/A2A 等入口若要支持交互，必须显式提供自己的 QuestionPort；
Schedule 等 unattended Turn 缺省 fail-closed。

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

### Shared-session intent

`TurnRequest.intent` 明确描述一条入站消息如何影响同 session 的 active turn：
`supersede`、`steer`、`follow_up`、`new`（FIFO）或 `observe`。产品入口应显式解析 intent；
为兼容现有行为，省略时以及普通 IM 入站默认解析为 `supersede`。现有
`ai.agent.inboundQueue.groupMode: fifo` 会将普通重叠消息解析为 `new`（FIFO），但 Agent Runtime
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

- 🤖 **agentLoop 统一路径**：ZhinAgent、Subagent、Deferred Worker、AIService 均经 `agentLoop`（legacy `Agent.run` 仅保留在 `@zhin.js/ai` 供单测）
- 📝 **会话持久化**：`AgentSessionStore` + `ContextRepository`；IM 事实由 `ConversationEventStore` 独占
- 🧠 **ZhinAgent**：与 Zhin 消息流集成的智能体（SOUL/TOOLS/AGENTS、工具收集、执行策略）
- 🔍 **模型自动发现**：`ModelRegistry` 调用 `listModels()`；结果写入 `provider.models` 并供 `getLlmTransportModel()` 校验
- 🔄 **模型自动降级**：首选模型失败时按 `resolveModelCandidates` 候选链 fallback（文本 / 多模态 / standalone 均走 agentLoop）
- 🛡️ **6 层 Bash 安全**：`ExecPolicy` 纵深防御（危险黑名单、环境变量剥离、wrapper 剥离、复合命令拆分、只读放行、交互式审批）
- 📂 **文件访问安全**：`FilePolicy` 路径检查、设备路径拦截、命令读写分类
- 📋 **精简系统提示词**：`PromptBuilder` 组装 Context、Style、Tools、Safety，并按需注入 Platform、Skills、Memory、Bootstrap
- 🧩 **提示词注册表**：`PromptAssemblyRegistry` 先注册默认系统提示分段，再按 `priority` 合并插件扩展/覆盖，并在 `systemPromptMaxChars` 预算下统一截断
- 🔌 **框架挂载**：Plugin Runtime (basic/cli) 装配 Agent 服务，通过 Scope+Token 提供
- 📦 **上下文与记忆**：`ContextRepository`（`agent_messages`）、`AgentSessionStore`；聊天事件从 `ConversationEventStore` 游标消费
- ⏰ **跟进与定时**：`FollowUpManager`、`PersistentCronEngine`、cron 工具
- 🔧 **内置工具**：bash、read_file、write_file、ask_user、web_search、`inspect_conversation_reference` 等
- 📐 **Compaction（ADR 0010）**：生产 `agentLoop` 接线 L1 micro + L2 LLM；IM `/compact`；yaml `ai.agent.compaction`
- 🌳 **会话树**：`parent_id` + `active_leaf`；IM `/tree`、`/reset`；branch summarization；Console `GET/POST /api/agent/sessions/...`
- 🪝 **Hook 系统**：`registerAIHook`、`triggerAIHook` 等

## 依赖关系

- 依赖 **@zhin.js/core**（IM 类型与消息链）与 **@zhin.js/ai**（`agentLoop`、Provider 抽象）
- **zhin.js 4.x** 主包为 optional peer；运行时通过 `zhin.js/agent` 子路径或本包 import

## PromptAssemblyRegistry

`buildRichSystemPrompt()` 现在会先创建默认提示词分段注册表，再合并调用方/插件注册的 `PromptAssemblyRegistry`。
扩展方可使用稳定 section id 覆盖默认段，或用新 id 插入额外段；最终内容按 `priority` 排序，并复用同一预算截断逻辑。
`ZhinAgent` 通过 `getPromptRegistry()` 暴露该注册表，Plugin Runtime 组合根也会提供 `promptAssemblyRegistry` 上下文供 generation 内扩展使用。

## 模块化架构（理想蓝图 8 模块）

`src/` 按职责拆分为 8 个理想模块 + Workroom Kernel（单包，可选 subpath export）：

```
packages/im/agent/src/
  core/          Agent Core — agentLoop 薄适配（ADR 0009）
  tool/          Tool System — Source/Filter、deferred 解析、运行时
  session/       Session System — Agent session/history；IM conversation context 由 ConversationEventStore 游标提供
  event/         Event System — Agent turn 域事件（不替代 Kernel RunEvent）
  skill/         Skill System — SkillRegistry 统一出口
  memory/        Memory System — Port → ContextRepository + compaction
  subagent/      Subagent System — SubagentSystem + ImResultSink
  context/       Context System — builder/injector 链、tail limit
  prompt/        系统提示词、assembly、workspace 模板
  turn/          Turn pipeline、inbound 队列、auto-continue、metrics
  config/        ZhinAgent 配置 SSOT、model harness
  orchestrator/  Tool / Skill capability orchestration（不拥有 Workroom facts）
  workroom/      Workroom Kernel — versioned Journal + pure replay/decision
  zhin-agent/    ZhinAgent 门面类（单文件 index.ts）
  init/          Plugin Runtime 组合、数据库激活与 ZhinAgent dispose 生命周期
```

普通 `spawn_task` 只执行当前聊天的非 Workroom 子任务，不创建或修改 Run/Task facts。Workroom command adapter 必须持有认证后的 Project capability；Scheduler、Executor 与完整 Reviewer/Sponsor Gate 尚未接入前，不发布模型可写的通用 transition 工具。验收不再是 `WorkroomCommand`：`WorkroomKernel.evaluateTaskAcceptance()` 只调用注入的可信 `WorkroomAcceptancePolicyDecisionPort`，并用 Journal CAS 写入结构化 Acceptance Record。当前生产 baseline 只允许 low-risk、全机械检查且证据与 claims 完整的候选自动通过；更高风险建议会被 Kernel 拒绝，等待后续 Gate 接线。

**Agent Core**：`AgentCore.runText()` / `runVision()` 为 `AsyncGenerator<TurnEvent>` SSOT；`runTextTurn` 为 collector。组合层经 `composeZhinAgentRuntime` 注入 8 模块 + `createAgentCoreDepsForCompose`。

可选 subpath（`package.json` `exports`）：

```typescript
import { AgentCore } from '@zhin.js/agent/core'
import { ToolSystem } from '@zhin.js/agent/tool'
import { SessionSystem } from '@zhin.js/agent/session'
// …/event、/skill、/memory、/subagent、/context、/prompt、/turn、/config
```

词汇与边界见 [CONTEXT.md](./CONTEXT.md)。

## 安装

```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # 示例：按厂商安装 provider SDK
```

仅 IM、不需要 Agent 时可只装 `zhin.js`（见 [ADR 0019](../../docs/adr/0019-install-size-layering.md)）。

## 使用

### 在 Zhin 项目中（推荐）

安装本包后，从 **`zhin.js/agent`** 或 **`@zhin.js/agent`** 引入：

```typescript
import {
  ZhinAgent,
  AIService,
  registerAIHook,
} from 'zhin.js/agent'

// 使用 ctx.ai (AIService)
useContext('ai', async (ai) => {
  const result = await ai.runAgent('你好', { provider: 'ollama' })
  // ...
})
```

Agent 模块由 Plugin Runtime (`basic/cli`) 自动装配，插件没有手动初始化入口。

### 非 Zhin 宿主 / 单独集成

```javascript
import { AIService } from '@zhin.js/agent'

// 程序化 Agent（agentLoop 隔离 context）
useContext('ai', async (ai) => {
  const result = await ai.runAgent('你好', {
    provider: 'ollama',
    systemPrompt: '你是一个助手',
  })
  console.log(result.content)
})
```

## 核心导出

| 类别 | 导出 |
|------|------|
| 初始化 | Plugin Runtime composition root 自动装配 |
| Agent | `ServiceAgent`、`CreateServiceAgentOptions`（`AIService.createAgent`）；legacy `Agent` / `createAgent` re-export 自 `@zhin.js/ai` |
| Model harness | `MODEL_HARNESS_DEFAULTS`, `resolveModelHarness`, `mergeModelHarnessValues` |
| 服务与会话 | `AIService`；会话/context 类型见 `@zhin.js/ai`（`ContextRepository`、`AgentSessionStore`） |
| ZhinAgent | `ZhinAgent`，以及 config / exec-policy / file-policy / `@zhin.js/agent/tool` / prompt / builtin-tools 等 |
| 安全策略 | `checkExecPolicy`, `applyExecPolicyToTools`, `isDangerousCommand`, `stripEnvVarPrefix`, `stripSafeWrappers`, `splitCompoundCommand`, `extractCommandName`, `ExecPolicyResult`, `checkFileAccess`, `classifyBashCommand`, `isBlockedDevicePath` |
| 提示词构建 | `buildRichSystemPrompt`, `buildEnhancedPersona`, `buildUserMessageWithHistory`, `buildContextHint` |
| 上下文与记忆 | `ContextRepository`, `AgentSessionStore`（`@zhin.js/ai`）；`ConversationEventStore`（`@zhin.js/im-contract`） |
| 跟进与定时 | `FollowUpManager`, `PersistentCronEngine`, `createCronTools`, `setCronManager`, `getCronManager` |
| 压缩与 Bootstrap | `compactSession`, `estimateTokens`, `loadBootstrapFiles`, `loadSoulPersona`, `loadToolsGuide`, `loadAgentsMemory` |
| Hook | `registerAIHook`, `unregisterAIHook`, `triggerAIHook`, `createAIHookEvent` |
| IM 内置工具工厂 | `createBuiltinTools`、`BuiltinBaseTool`；具体工具见 `src/builtin/*` |
| 输出与检测 | `parseOutput`, `renderToPlainText`, `renderToSatori`, `detectTone` |
| 子代理 | `SubagentSystem` |
| 编排 | `AgentOrchestrator`、`ToolRegistry`、`SkillRegistry`、`SubAgentRegistry`、`McpRegistry`、`HookRegistry` |
| MCP 客户端 | `McpClientManager`、`McpClientConnection`、`mcpToolToAgentTool`、`ensureMcpConnections`（见下方「MCP」） |
| 限流 | `RateLimiter` |
| 存储抽象 | `StorageBackend`, `MemoryStorageBackend`, `DatabaseStorageBackend`, `createSwappableBackend` |

类型（如 `ZhinAgentConfig`、`ContextConfig`、`AgentState`、`McpServerEntry` 等）均从包入口导出或从 `@zhin.js/core` 再导出。

## 全局上下文

Agent 模块装配后，插件可声明：

```typescript
declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: AIService              // 会话、Provider、ZhinAgent、runAgent 等
      agent: AgentOrchestrator   // 工具/技能/子代理/MCP 条目/Hook 注册表
    }
  }
}
```

| Context | 用途 |
|---------|------|
| `ctx.ai` | 业务侧 AI 服务：会话、`createAgent`（→ `ServiceAgent`）/ `runAgent`、全局 ZhinAgent |
| `ctx.agent` | 扩展编排资源：`orchestrator.addTool`、`addSkill`、`addMcp` 等；内置注册走 `root.inject('agent')` |

主包 `zhin.js` 的 `Plugin.Contexts` 类型已包含上述两项。

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

**限制**：已配置 server 未 ready 时候选 generation 激活失败，旧 generation 原样继续（fail-closed）；resources/prompts 暂不注入模型。与 **`packages/host/mcp`**（MCP **Server**）方向相反。验收见 [examples/test-bot/ACCEPTANCE.md](../../examples/test-bot/ACCEPTANCE.md)。

## 多 Agent 使用方式

### 1. 主 Agent + 子 Agent（内置）

框架已提供 **SubagentSystem**：主 ZhinAgent 通过工具 `spawn_task` 把复杂/耗时任务派给**后台子 Agent** 异步执行。子 Agent 使用受限工具集；完成后**先交还主 Agent**（写入主会话 + auto-continue 续聊），用户可见回复由主 Agent 整理发出。

- 主对话不阻塞，用户可继续聊天（异步 `spawn_task`）。
- `spawn_task` 在每轮 `turn-pipeline` 注入（`createSpawnTaskTool`），并默认列入 `deferredTools.alwaysLoadedTools`。
- **`wait: true`** 时同步等待，结果经 tool result 回到当前主 Agent turn。
- 监听 `ai.subagent.finish` 可做 log / 监控；需旧式「子任务摘要直推 IM」时设 `ai.agent.subagentDirectImDelivery: true`。

**并发与并行（ADR 0030）**

| 配置 | 默认 | 说明 |
|------|------|------|
| `toolExecution` | `tiered` | 同轮 `spawn_task` + 只读工具并行；写/bash 顺序 |
| `maxParallelSubagents` | `5` | 并行子 agent 硬顶，超限拒绝 |
| `subagentAutoContinue` | `true` | 异步完成后唤醒主 Agent |
| `subagentDirectImDelivery` | `false` | 额外直发格式化摘要到 IM |

**类型权限**：`ai.agents.<name>.permission.task`（glob → allow/deny）控制主 Agent 可见的子 agent 预设。

关键路径：

- `src/subagent/` — `SubagentSystem`、`SubagentRuntime`、`onSubagentComplete`
- `src/builtin/spawn-task-tool.ts` — 工具定义与 `permission.task` 校验
- `src/turn/persist-subagent-context.ts` / `subagent-auto-continue.ts` — 结果落库与续聊
- `src/turn/turn-pipeline.ts` — 每轮注入 `spawn_task`
- `packages/im/ai/src/llm/tiered-tool-buckets.ts` — tiered 并行工具 SSOT

无需额外配置即可使用；若需放宽子 Agent 的工具范围，使用 `ai.agent.subagentTools` 显式追加白名单（不会自动继承主会话全部 skill/tool）。

### 2. 用 AIService 创建多个不同配置的 Agent

`ctx.ai`（AIService）可以按需创建**多个互不共享状态的 Agent**（`ServiceAgent`），每个可指定不同 provider、model、systemPrompt、tools；底层均为 **`runAgentLoopStandaloneTurn`**：

```javascript
import { useContext } from 'zhin.js'

useContext('ai', async (ai) => {
  const codeAgent = ai.createAgent({
    provider: 'openai',
    model: 'gpt-4o',
    systemPrompt: '你只负责代码审查与建议，不闲聊。',
    useBuiltinTools: true,
  })
  const codeResult = await codeAgent.run('审查这段 TypeScript 的类型安全')

  const translateAgent = ai.createAgent({
    provider: 'ollama',
    model: 'qwen2.5',
    systemPrompt: '只做中英互译，不解释。',
    useBuiltinTools: false,
    collectExternalTools: false,
  })
  const translated = await translateAgent.run('Hello world')
})
```

适合：按场景/按接口使用不同「角色」的 Agent（代码、翻译、总结等），彼此独立。

### 3. 一次调用、单次任务（不持有 Agent 实例）

不需要长期持有 Agent 时，可直接用 `runAgent` 跑单次任务：

```javascript
useContext('ai', async (ai) => {
  const result = await ai.runAgent('总结以下内容：...', {
    provider: 'deepseek',
    systemPrompt: '只输出 3 条要点。',
  })
  console.log(result.content)
})
```

### 4. 多 Agent 协作与普通 chat 委派

普通 chat 可用 `spawn_task` 临时委派子代理；它没有 durable Run/Task、验收或 Project Memory 语义。Project 级多 Agent 协作由 Workroom Kernel 的 versioned Plan、Assignment、Acceptance 与投影承载。旧 `zhin.js/agent` `runPipeline` / `runParallel` / `route` 会立即调用模型且没有可靠状态边界，已在 breaking cutover 中删除；后续构图便利 API 只会生成 Plan proposal，不直接执行 Agent。

## 工具命名策略

- 保留/内置工具名（如 `bash`、`read_file`、`spawn_task`）不可被插件或文件化工具覆盖。
- 非保留工具同名时采用 **后注册覆盖前注册**。
- 冲突统一以 warn 记录：包含 `name`、`source`、`action`（`ignored`/`overridden`）。

## Provider 与模型列表

`AIService` 构造时：

1. 按 `ai.providers.<别名>` 实例化 Provider（须配置 `sdk`，如 `openai` 或 `openai-compatible`）。
2. `registerLlmApiFromProviders`：**未写 `models` 的 provider** 在 ApiRegistry 注册为空白名单，由后台 `ModelRegistry.discover()` 填充 `provider.models`；**写了 `models`** 则用 yaml 白名单。
3. `createZhinAgent` 启动时 `loadCache()` 先恢复上次发现结果，再异步刷新 `/v1/models`。

`agents.<name>.model`（如 `mimo-v2.5-pro`）须在发现列表中，或在中转 API 的 `/v1/models` 响应里出现；无需为每个模型手写 yaml，除非要锁定白名单。

```yaml
ai:
  providers:
    openai-main:
      sdk: openai-compatible
      baseUrl: ${OPENAI_BASE_URL}
      apiKey: ${OPENAI_API_KEY}
      # models 省略 → 自动 GET /v1/models
    cloudflare-flash:
      sdk: openai-compatible
      models: ["@cf/zai-org/glm-4.7-flash"]  # 显式列表
  agents:
    zhin:
      provider: openai-main
      model: mimo-v2.5-pro
```

## Provider 与模型列表

`AIService` 构造时：

1. 按 `ai.providers.<别名>` 实例化 Provider（须配置 `sdk`，如 `openai` 或 `openai-compatible`）。
2. `registerLlmApiFromProviders`：**未写 `models` 的 provider** 在 ApiRegistry 注册为空白名单，由后台 `ModelRegistry.discover()` 填充 `provider.models`；**写了 `models`** 则用 yaml 白名单。
3. `createZhinAgent` 启动时 `loadCache()` 先恢复上次发现结果，再异步刷新 `/v1/models`。

`agents.<name>.model`（如 `mimo-v2.5-pro`）须在发现列表中，或在中转 API 的 `/v1/models` 响应里出现；无需为每个模型手写 yaml，除非要锁定白名单。

```yaml
ai:
  providers:
    openai-main:
      sdk: openai-compatible
      baseUrl: ${OPENAI_BASE_URL}
      apiKey: ${OPENAI_API_KEY}
      # models 省略 → 自动 GET /v1/models
    cloudflare-flash:
      sdk: openai-compatible
      models: ["@cf/zai-org/glm-4.7-flash"]  # 显式列表
  agents:
    zhin:
      provider: openai-main
      model: mimo-v2.5-pro
```

## Model harness

按 provider / model 覆盖 Agent 循环默认参数（当前主要为 **`maxIterations`**）。

**合并顺序**（约定优先，详见 [ADR 0007](../../docs/adr/0007-ai-agent-model-harness-yaml-overrides.md)）：

1. TypeScript 默认表 `MODEL_HARNESS_DEFAULTS`（[`src/config/model-harness.ts`](./src/config/model-harness.ts) + [`model-harness-runtime.ts`](./src/config/model-harness-runtime.ts)）
2. YAML `ai.agent.modelHarness.providerPatterns`（匹配当前 provider，支持 `*` 通配；按对象键插入顺序叠加）
3. YAML `ai.agent.modelHarness.models`（`model` 或 `provider:model` 精确键）

```yaml
ai:
  agent:
    modelHarness:
      providerPatterns:
        "open*":
          maxIterations: 7
      models:
        "gpt-4o":
          maxIterations: 8
        "openai:gpt-4o":
          maxIterations: 9
```

运行时由 `resolveModelHarness(providerName, modelName, config?.modelHarness)` 解析；包入口导出 `MODEL_HARNESS_DEFAULTS`、`resolveModelHarness`、`mergeModelHarnessValues` 与 `ModelHarnessConfig` 类型。未命中任何规则时回退 TS 默认行或空对象；当前仅消费 `maxIterations`，未知 YAML 字段会被忽略。

增补内置默认值：在 `config/model-harness.ts` 增加 `ModelHarnessRow` 并附测试；YAML 只做覆盖，不替代 TS 约定层。

## IM 管理命令

由 `register-management-tools.ts` / `register-introspection-commands.ts` 注册（master / 有权限用户）：

| 类别 | 命令 |
|------|------|
| 会话 | `/compact` · `/tree` · `/tree N` · `/reset` |
| 运维 | `/models` · `/health` |
| 内省 | `/cmd` · `/endpoints` · `/bindings` · `/tools` · `/mcp` |

zhin-package CLI：`zhin packages`（`basic/cli`）。详见 [ADR 0010](../../docs/adr/0010-pi-coding-agent-harness-alignment.md)。

## 开发

### 项目结构

```
src/
├── index.ts                         # 包根导出：Orchestrator、ZhinAgent、init、builtin…
│
├── core/                            # Agent Core — agentLoop 薄适配
├── tool/                            # Tool System — 运行时工具收集
├── session/                         # Session System — IM/Agent 双 store、session-io
├── event/                           # Event System — turn 域事件 + session 事件
├── skill/                           # Skill System
├── memory/                          # Memory System
├── subagent/                        # Subagent System + manager init
├── context/                         # Context System — builder/injector、tail limit
├── prompt/                          # 系统提示词、assembly、workspace 模板
├── turn/                            # Turn pipeline、inbound 队列、auto-continue
├── config/                          # ZhinAgent 配置 SSOT、model harness
│
├── orchestrator/                    # ★ 编排中枢（Kernel SSOT，ADR 0027）
│   ├── index.ts                     # AgentOrchestrator class
│   ├── types.ts                     # ResourceScope, Skill, SubAgentDef, AIHook…
│   ├── resource-registry.ts
│   ├── tool-registry.ts
│   ├── skill-registry.ts
│   ├── subagent-registry.ts
│   ├── mcp-registry.ts
│   └── hook-registry.ts
│
├── mcp-client/                      # MCP 客户端
│
├── init/                            # Plugin Runtime 组合、数据库激活与 dispose 生命周期
│
├── service.ts                       # AIService
│
├── zhin-agent/                      # ZhinAgent 门面类（单文件）
│   └── index.ts
│
├── internal/                        # host 契约、asPrivate、turn-context、phase/prompt trace
├── discovery/                       # 文件化资源发现（tools / skills / agents）
├── security/                        # exec-policy、file-policy
├── builtin/                         # IM 内置工具
├── builtin-tools.ts                 # createBuiltinTools() 聚合
│
├── defaults/                        # ★ 各注册表的默认资源
│   ├── skills.ts                    # 默认 common skills
│   ├── hooks.ts                     # 默认 common hooks
│   └── subagents.ts                 # 默认 subagent 模板
│
├── common-adapter-tools.ts          # ← 从 core 迁移：群管工具工厂
├── subagent.ts
├── task-executor.ts
├── cron-engine.ts
├── bootstrap.ts
└── user-profile.ts
```

`init/` 只保留由 Plugin Runtime composition root 直接调用的装配与数据库生命周期模块；旧 Plugin 注册器已删除。

### 构建

```bash
pnpm build   # 或 npm run build
pnpm clean   # 清理 lib
```

## 许可证

MIT License
