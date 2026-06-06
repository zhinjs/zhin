# @zhin.js/agent

Zhin AI Agent 组合层：在 `@zhin.js/core` 的类型与 Provider 之上，提供会话管理、Agent 执行循环、ZhinAgent 与框架挂载（init）。

领域词汇见 [CONTEXT.md](./CONTEXT.md)。用户向文档：[AI 模块](https://zhin.js.org/advanced/ai)、[消息如何流转](../../docs/essentials/message-flow.md)。

## 功能特性

- 🤖 **agentLoop 统一路径**：ZhinAgent、Subagent、Deferred Worker、AIService 均经 `agentLoop`（legacy `Agent.run` 仅保留在 `@zhin.js/ai` 供单测）
- 📝 **会话管理**：`SessionManager`、内存/数据库会话、`SessionManager.generateId`
- 🧠 **ZhinAgent**：与 Zhin 消息流集成的智能体（SOUL/TOOLS/AGENTS、工具收集、执行策略）
- 🔍 **模型自动发现**：`ModelRegistry` 调用 `listModels()`（OpenAI 兼容 `/v1/models`、Ollama `/api/tags`）；结果写入 `provider.models` 并供 `getModel()` 校验；yaml 显式 `models` 时以配置为准
- 🔄 **模型自动降级**：首选模型失败时按 `resolveModelCandidates` 候选链 fallback（文本 / 多模态 / standalone 均走 agentLoop）
- 🛡️ **6 层 Bash 安全**：`ExecPolicy` 纵深防御（危险黑名单、环境变量剥离、wrapper 剥离、复合命令拆分、只读放行、交互式审批）
- 📂 **文件访问安全**：`FilePolicy` 路径检查、设备路径拦截、命令读写分类
- 📋 **精简系统提示词**：`PromptBuilder` 组装 Context、Style、Tools、Safety，并按需注入 Platform、Skills、Memory、Bootstrap
- 🔌 **框架挂载**：`initAgentModule()` 注册 `ctx.ai`、`ctx.agent`、定时任务、DB 模型等
- 📦 **上下文与记忆**：`ContextRepository`（`agent_messages`）、`AgentSessionStore`、`ImTranscriptStore`（`im_transcripts` + `chat_history`）；辅助：`ContextManager`、`ConversationMemory`、`UserProfileStore`
- ⏰ **跟进与定时**：`FollowUpManager`、`PersistentCronEngine`、cron 工具
- 🔧 **内置工具**：bash、read_file、write_file、ask_user、web_search、`chat_history`（按关键词/最近条数查 `im_transcripts`）等
- 📐 **会话压缩**：`compactSession`、token 估算、总结与裁剪
- 🪝 **Hook 系统**：`registerAIHook`、`triggerAIHook` 等

## 依赖关系

- 依赖 **@zhin.js/core**：AI 类型（`AIProvider`、`ChatMessage`、`Session` 等）与各 Provider 实现（OpenAI、Ollama 等）
- 通常通过 **zhin.js** 主包使用，主包会调用 `initAgentModule()` 并 re-export 本包 API

## 安装

```bash
npm install @zhin.js/agent
# 或使用主包（已包含 agent）
npm install zhin.js
```

## 使用

### 在主包中（推荐）

主包 `zhin.js` 已依赖 `@zhin.js/agent` 并在 setup 中调用 `initAgentModule()`，插件可直接从 `zhin.js` 使用：

```typescript
import {
  initAgentModule,
  ZhinAgent,
  AIService,
  SessionManager,
  registerAIHook,
  createBuiltinTools,
} from 'zhin.js'

// 使用 ctx.ai (AIService)
useContext('ai', async (ai) => {
  const session = ai.sessions.get(sessionId)
  // ...
})
```

### 直接使用 @zhin.js/agent

仅在需要单独集成 Agent 能力时使用：

```javascript
import { initAgentModule, AIService } from '@zhin.js/agent'
import { OllamaProvider } from '@zhin.js/core'

initAgentModule()

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
| 初始化 | `initAgentModule` |
| Agent | `ServiceAgent`、`CreateServiceAgentOptions`（`AIService.createAgent`）；legacy `Agent` / `createAgent` re-export 自 `@zhin.js/ai` |
| Model harness | `MODEL_HARNESS_DEFAULTS`, `resolveModelHarness`, `mergeModelHarnessValues` |
| 服务与会话 | `AIService`, `SessionManager`, `MemorySessionManager`, `DatabaseSessionManager`, `createMemorySessionManager`, `createDatabaseSessionManager` |
| ZhinAgent | `ZhinAgent`，以及 config / exec-policy / file-policy / tool-runtime / prompt / builtin-tools 等子模块 |
| 安全策略 | `checkExecPolicy`, `applyExecPolicyToTools`, `isDangerousCommand`, `stripEnvVarPrefix`, `stripSafeWrappers`, `splitCompoundCommand`, `extractCommandName`, `ExecPolicyResult`, `checkFileAccess`, `classifyBashCommand`, `isBlockedDevicePath` |
| 提示词构建 | `buildRichSystemPrompt`, `buildEnhancedPersona`, `buildUserMessageWithHistory`, `buildContextHint` |
| 上下文与记忆 | `ContextRepository`, `AgentSessionStore`, `ImTranscriptStore`（经 ZhinAgent 注入）；`ContextManager`, `ConversationMemory`, `UserProfileStore` |
| 跟进与定时 | `FollowUpManager`, `PersistentCronEngine`, `createCronTools`, `setCronManager`, `getCronManager` |
| 压缩与 Bootstrap | `compactSession`, `estimateTokens`, `loadBootstrapFiles`, `loadSoulPersona`, `loadToolsGuide`, `loadAgentsMemory` |
| Hook | `registerAIHook`, `unregisterAIHook`, `triggerAIHook`, `createAIHookEvent` |
| IM 内置工具工厂 | `createBuiltinTools`、`BuiltinBaseTool`；具体工具见 `src/builtin/*` |
| 输出与检测 | `parseOutput`, `renderToPlainText`, `renderToSatori`, `detectTone` |
| 子代理 | `SubagentManager` |
| 编排 | `AgentOrchestrator`、`ToolRegistry`、`SkillRegistry`、`SubAgentRegistry`、`McpRegistry`、`HookRegistry` |
| MCP 客户端 | `McpClientManager`、`McpClientConnection`、`mcpToolToAgentTool`、`ensureMcpConnections`（见下方「MCP」） |
| 限流 | `RateLimiter` |
| 存储抽象 | `StorageBackend`, `MemoryStorageBackend`, `DatabaseStorageBackend`, `createSwappableBackend` |

类型（如 `ZhinAgentConfig`、`ContextConfig`、`AgentState`、`McpServerEntry` 等）均从包入口导出或从 `@zhin.js/core` 再导出。

## 全局上下文

通过 `initAgentModule()` 挂载后，插件可声明：

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

默认**不**注册 `@modelcontextprotocol/server-memory`；设 `ai.memoryMcp: true` 启用（`data/knowledge-graph.jsonl`）。另可通过 `ai.mcpServers`（或 `ctx.agent.addMcp`）注册更多 Server；每次 AI 回合前懒连接，`mcp_{server}_{tool}` 并入 ZhinAgent 工具池。需可选安装 `@modelcontextprotocol/sdk`（peer dependency）。

**记忆**：内置 `read_memory` / `write_memory` 已移除，请使用 `mcp_memory_read_graph`、`mcp_memory_create_entities` 等。工作区 `AGENTS.md` 仍由 bootstrap 注入。

```yaml
ai:
  memoryMcp: true   # 默认 false，显式开启
  mcpServers:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/zhin-mcp-test"]
```

**限制**：单 server 连接失败仅 warn，不阻塞回合；resources/prompts 暂不注入模型。与 **`packages/host/mcp`**（MCP **Server**）方向相反。验收见 [examples/test-bot/ACCEPTANCE.md](../../examples/test-bot/ACCEPTANCE.md)。

## 多 Agent 使用方式

### 1. 主 Agent + 子 Agent（内置）

框架已提供 **SubagentManager**：主 ZhinAgent 通过工具 `spawn_task` 把复杂/耗时任务派给**后台子 Agent** 异步执行，子 Agent 默认仅用受限工具集（文件、Shell、网络搜索等），完成后通过回调把结果发回主会话。

- 主对话不阻塞，用户可继续聊天。
- 子 Agent 由 `ZhinAgent.initSubagentManager(createTools)` 在 init 时挂好；`spawn_task` 为主编排序列化常驻工具（见 `orchestratorTools` / `DEFAULT_ORCHESTRATOR_TOOLS`）。
- 用户说「后台帮我整理这份文档」时，主 Agent 可调用 `spawn_task({ task: '...', label: '...' })`，子任务在后台跑完后再通知用户。

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

### 4. 多 Agent 协作/编排（由 zhin.js 层实现）

本包只提供基础能力：`ZhinAgent`、`ai.createAgent`（`ServiceAgent`）、`ai.runAgent` 等。**多 Agent 串联/并联编排**（例如 A 的输出作为 B 的输入、按条件路由到不同专业 Agent）在 **zhin.js 主包** `runPipeline` / `runParallel` / `route` 实现；插件侧通过 zhin.js 暴露的 API 使用即可。

## 工具命名策略

- 保留/内置工具名（如 `bash`、`read_file`、`spawn_task`）不可被插件或文件化工具覆盖。
- 非保留工具同名时采用 **后注册覆盖前注册**。
- 冲突统一以 warn 记录：包含 `name`、`source`、`action`（`ignored`/`overridden`）。

## Provider 与模型列表

`AIService` 构造时：

1. 按 `ai.providers.<别名>` 实例化 Provider（须配置 `api`，如 `openai-completions`）。
2. `registerLlmApiFromProviders`：**未写 `models` 的 provider** 在 ApiRegistry 注册为空白名单，由后台 `ModelRegistry.discover()` 填充 `provider.models`；**写了 `models`** 则用 yaml 白名单。
3. `createZhinAgent` 启动时 `loadCache()` 先恢复上次发现结果，再异步刷新 `/v1/models`。

`agents.<name>.model`（如 `mimo-v2.5-pro`）须在发现列表中，或在中转 API 的 `/v1/models` 响应里出现；无需为每个模型手写 yaml，除非要锁定白名单。

```yaml
ai:
  providers:
    openai-main:
      api: openai-completions
      baseUrl: ${OPENAI_BASE_URL}
      apiKey: ${OPENAI_API_KEY}
      # models 省略 → 自动 GET /v1/models
    cloudflare-flash:
      api: cloudflare-workers-ai
      models: ["@cf/zai-org/glm-4.7-flash"]  # 显式列表
  agents:
    zhin:
      provider: openai-main
      model: mimo-v2.5-pro
```

## Model harness

按 provider / model 覆盖 Agent 循环默认参数（当前主要为 **`maxIterations`**）。

**合并顺序**（约定优先，详见 [ADR 0007](../../docs/adr/0007-ai-agent-model-harness-yaml-overrides.md)）：

1. TypeScript 默认表 `MODEL_HARNESS_DEFAULTS`（[`src/zhin-agent/model-harness.ts`](./src/zhin-agent/model-harness.ts)）
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

增补内置默认值：在 `model-harness.ts` 增加 `ModelHarnessRow` 并附测试；YAML 只做覆盖，不替代 TS 约定层。

## 开发

### 项目结构

```
src/
├── index.ts                         # 导出 AgentOrchestrator + 五类 Registry + ZhinAgent + init
│
├── orchestrator/                    # ★ 核心：编排中枢
│   ├── index.ts                     # AgentOrchestrator class
│   ├── types.ts                     # ResourceScope, ResourceEntry, Skill, SubAgentDef, AIHook, McpServerEntry
│   ├── resource-registry.ts         # ResourceRegistry<T> 基类
│   ├── tool-registry.ts             # ToolRegistry（含 ZhinTool, defineTool, 权限过滤）
│   ├── skill-registry.ts            # SkillRegistry（含搜索）
│   ├── subagent-registry.ts         # SubAgentRegistry
│   ├── mcp-registry.ts              # McpRegistry
│   └── hook-registry.ts             # HookRegistry
│
├── mcp-client/                      # MCP 客户端（Manager / Connection / bridge）
│
├── init.ts                          # initAgentModule 入口
├── init/                            # 挂载子模块（orchestrator、ai、builtin-tools…）
│
├── service.ts                       # AIService（保留，对接 Orchestrator）
│
├── zhin-agent/                      # 主对话 Agent
│   ├── index.ts                     # ZhinAgent（改造：从 Orchestrator 获取资源）
│   ├── config.ts
│   ├── prompt.ts
│   ├── tool-runtime.ts              # 运行时工具收集与执行路径规划
│   └── builtin-tools.ts             # chat_history（im_transcripts）, user_profile, spawn_task
│
├── discovery/                       # ★ 文件化资源发现
│   ├── index.ts
│   ├── utils.ts
│   ├── tools.ts                     # *.tool.md 发现
│   ├── skills.ts                    # SKILL.md 发现
│   └── agents.ts                    # *.agent.md 发现
│
├── security/                        # ★ 安全策略
│   ├── file-policy.ts
│   └── exec-policy.ts
│
├── builtin/                         # IM 内置工具（BuiltinBaseTool + 各 *-tool.ts）
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

`init/` 目录含 `register-orchestrator.ts`（`provide('agent')`）、`register-ai-service.ts`、`register-builtin-tools.ts` 等，见 `src/init.ts`。

### 构建

```bash
pnpm build   # 或 npm run build
pnpm clean   # 清理 lib
```

## 许可证

MIT License
