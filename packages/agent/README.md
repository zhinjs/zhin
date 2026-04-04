# @zhin.js/agent

Zhin AI Agent 组合层：在 `@zhin.js/core` 的类型与 Provider 之上，提供会话管理、Agent 执行循环、ZhinAgent 与框架挂载（init）。

## 功能特性

- 🤖 **Agent 循环**：`Agent` / `createAgent`，支持工具调用、迭代与事件
- 📝 **会话管理**：`SessionManager`、内存/数据库会话、`SessionManager.generateId`
- 🧠 **ZhinAgent**：与 Zhin 消息流集成的智能体（SOUL/TOOLS/AGENTS、工具收集、执行策略）
- �️ **6 层 Bash 安全**：`ExecPolicy` 纵深防御（危险黑名单、环境变量剥离、wrapper 剥离、复合命令拆分、只读放行、交互式审批）
- 📂 **文件访问安全**：`FilePolicy` 路径检查、设备路径拦截、命令读写分类
- 📋 **10 段系统提示词**：`PromptBuilder` 结构化 prompt（Identity、System、Tasks、Actions、Tools、Communication、Skills、Active Skills、Memory、Bootstrap）
- 🔌 **框架挂载**：`initAgentModule()` 注册 `ctx.ai`、定时任务、DB 模型等
- 📦 **上下文与记忆**：`ContextManager`、`ConversationMemory`、`UserProfileStore`
- ⏰ **跟进与定时**：`FollowUpManager`、`PersistentCronEngine`、cron 工具
- 🔧 **内置工具**：bash、read_file、write_file、ask_user、web_search、chat_history 等
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

```javascript
import {
  initAIModule,   // 即 initAgentModule 的别名
  ZhinAgent,
  Agent,
  createAgent,
  AIService,
  SessionManager,
  registerAIHook,
  getBuiltinTools,
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
import { initAgentModule, createAgent, AIService } from '@zhin.js/agent'
import { OllamaProvider } from '@zhin.js/core'

// 初始化（需先有 DatabaseFeature 等）
initAgentModule()

// 低层 Agent
const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' })
const agent = createAgent(provider, { tools: [], systemPrompt: '你是一个助手' })
const result = await agent.run('你好')
```

## 核心导出

| 类别 | 导出 |
|------|------|
| 初始化 | `initAgentModule` |
| Agent | `Agent`, `createAgent`, `formatToolTitle` |
| 服务与会话 | `AIService`, `SessionManager`, `MemorySessionManager`, `DatabaseSessionManager`, `createMemorySessionManager`, `createDatabaseSessionManager` |
| ZhinAgent | `ZhinAgent`，以及 config / exec-policy / file-policy / tool-collector / prompt / builtin-tools 等子模块 |
| 安全策略 | `checkExecPolicy`, `applyExecPolicyToTools`, `isDangerousCommand`, `stripEnvVarPrefix`, `stripSafeWrappers`, `splitCompoundCommand`, `extractCommandName`, `ExecPolicyResult`, `checkFileAccess`, `classifyBashCommand`, `isBlockedDevicePath` |
| 提示词构建 | `buildRichSystemPrompt`, `buildEnhancedPersona`, `buildUserMessageWithHistory`, `buildContextHint` |
| 上下文与记忆 | `ContextManager`, `createContextManager`, `ConversationMemory`, `UserProfileStore` |
| 跟进与定时 | `FollowUpManager`, `PersistentCronEngine`, `createCronTools`, `setCronManager`, `getCronManager` |
| 压缩与 Bootstrap | `compactSession`, `estimateTokens`, `loadBootstrapFiles`, `loadSoulPersona`, `loadToolsGuide`, `loadAgentsMemory` |
| Hook | `registerAIHook`, `unregisterAIHook`, `triggerAIHook`, `createAIHookEvent` |
| 内置工具 | `getBuiltinTools`, `getAllBuiltinTools`, `calculatorTool`, `timeTool`, `searchTool`, `codeRunnerTool`, `httpTool`, `memoryTool` |
| 输出与检测 | `parseOutput`, `renderToPlainText`, `renderToSatori`, `detectTone` |
| 子代理 | `SubagentManager` |
| 限流 | `RateLimiter` |
| 存储抽象 | `StorageBackend`, `MemoryStorageBackend`, `DatabaseStorageBackend`, `createSwappableBackend` |

类型（如 `ZhinAgentConfig`、`ContextConfig`、`AgentState` 等）均从包入口导出或从 `@zhin.js/core` 再导出。

## 全局上下文

通过 `initAgentModule()` 挂载后，插件可声明：

```typescript
declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: AIService  // 由 @zhin.js/agent 提供
    }
  }
}
```

主包 `zhin.js` 的 `Plugin.Contexts.ai` 类型已指向本包的 `AIService`。

## 多 Agent 使用方式

### 1. 主 Agent + 子 Agent（内置）

框架已提供 **SubagentManager**：主 ZhinAgent 通过工具 `spawn_task` 把复杂/耗时任务派给**后台子 Agent** 异步执行，子 Agent 用受限工具集（文件、Shell、网络搜索等），完成后通过回调把结果发回主会话。

- 主对话不阻塞，用户可继续聊天。
- 子 Agent 由 `ZhinAgent.initSubagentManager(createTools)` 在 init 时挂好，主 Agent 在回复里提到「后台 / 子任务 / spawn」时会注入 `spawn_task` 工具。
- 用户说「后台帮我整理这份文档」时，主 Agent 可调用 `spawn_task({ task: '...', label: '...' })`，子任务在后台跑完后再通知用户。

无需额外配置即可使用；若需自定义子 Agent 工具或执行策略，可在 init 里对 `ZhinAgent` 调用 `initSubagentManager` 时传入自己的 `createTools` 和 `execPolicyConfig`。

### 2. 用 AIService 创建多个不同配置的 Agent

`ctx.ai`（AIService）可以按需创建**多个互不共享状态的 Agent**，每个可指定不同 provider、model、systemPrompt、tools：

```javascript
import { useContext } from 'zhin.js'

useContext('ai', async (ai) => {
  // 专用「代码助手」Agent
  const codeAgent = ai.createAgent({
    provider: 'openai',
    model: 'gpt-4o',
    systemPrompt: '你只负责代码审查与建议，不闲聊。',
    useBuiltinTools: true,
    tools: [/* 可选：额外工具 */],
  })
  const codeResult = await codeAgent.run('审查这段 TypeScript 的类型安全')

  // 专用「翻译」Agent，不用内置工具
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

本包只提供基础能力：`createAgent`、`ZhinAgent`、`ai.createAgent` 等。**多 Agent 串联/并联编排**（例如 A 的输出作为 B 的输入、按条件路由到不同专业 Agent）以及**按 bot / 按群组配置多个 ZhinAgent** 的调度与路由，将在 **zhin.js 主包**实现；插件侧通过 zhin.js 暴露的 API 使用即可，无需在业务里手写多实例维护与路由逻辑。

## 开发

### 项目结构

```
src/
├── index.ts              # 入口与 re-export
├── agent.ts              # Agent 执行循环（无状态，TF-IDF 工具过滤）
├── service.ts            # AIService
├── session.ts            # SessionManager
├── storage.ts            # 统一存储抽象层（StorageBackend 接口）
├── context-manager.ts
├── conversation-memory.ts
├── user-profile.ts
├── follow-up.ts
├── subagent.ts
├── rate-limiter.ts
├── cron-engine.ts
├── compaction.ts
├── bootstrap.ts
├── hooks.ts
├── output.ts
├── tools.ts
├── builtin-tools.ts      # 内置工具（bash、read_file、ask_user 等）
├── tone-detector.ts
├── file-policy.ts        # 文件访问安全（路径检查、设备拦截、命令分类）
├── init.ts               # initAgentModule 精简入口（委托子模块）
├── init/                 # init 子模块（从 init.ts 拆分）
│   ├── shared-refs.ts
│   ├── types.ts              # 集中的类型增强声明
│   ├── register-tool-service.ts
│   ├── register-db-models.ts
│   ├── register-ai-service.ts
│   ├── create-zhin-agent.ts
│   ├── register-ai-trigger.ts
│   ├── register-db-upgrade.ts
│   ├── register-message-recorder.ts
│   ├── register-management-tools.ts
│   └── register-builtin-tools.ts
└── zhin-agent/           # ZhinAgent 及子模块
    ├── index.ts          # ZhinAgent 主类
    ├── config.ts         # 配置与常量（ModelSizeHint、KEYWORD_TRIGGERS 等）
    ├── exec-policy.ts    # Bash 执行安全（6 层纵深防御）
    ├── tool-collector.ts # 工具收集与过滤
    ├── prompt.ts         # 系统提示词构建器（10 段结构化架构）
    └── builtin-tools.ts  # ZhinAgent 专用内置工具
```

### 构建

```bash
pnpm build   # 或 npm run build
pnpm clean   # 清理 lib
```

## 许可证

MIT License
