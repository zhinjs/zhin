# AI 模块

::: info 文档分工（SSOT）
- **[配置文件 — AI 节](/essentials/configuration)**：L1 常用字段与 Stable 默认值子集
- **本文**：AI / Agent / Context / MCP 全集与行为说明
- **源码**：`packages/im/ai/src/types.ts`（Provider / Context）、`packages/im/agent/src/zhin-agent/config.ts`（`DEFAULT_CONFIG`）
:::

Zhin.js 通过 **`@zhin.js/agent`**（IM 编排）与 **`@zhin.js/ai`**（LLM 引擎）提供 AI Agent 能力：智能对话、工具调用、上下文记忆等。**zhin.js 4.x 主包默认不含上述依赖**，须按档位安装（见下节）。

## 安装与依赖（zhin.js 4.x）

<<< ../snippets/install-tiers.md#tiers-table

**Import 约定（4.x breaking）**：

<<< ../snippets/install-tiers.md#imports

<<< ../snippets/install-tiers.md#doctor

<<< ../snippets/install-tiers.md#scaffold-note

决策记录：[ADR 0019 — 安装体积分层](/adr/0019-install-size-layering)。

## 目录

- [安装与依赖（zhin.js 4.x）](#安装与依赖-zhinjs-4x)
- [架构概览](#架构概览)
- [配置](#配置)
- [Agent 配置详解](#agent-配置详解)
- [触发条件](#触发条件)
- [消息处理流程](#消息处理流程)
- [会话管理](#会话管理)
- [工具与技能](#工具与技能)
- [MCP 集成](#mcp-集成)
- [Deferred Tools（按需加载 schema）](#deferred-tools按需加载-schema)
- [子任务 (Subagent)](#子任务-subagent)
- [定时消息 (Follow-up)](#定时消息-follow-up)
- [用户画像](#用户画像)
- [对话记忆](#对话记忆)
- [Hook 系统](#hook-系统)
- [会话压缩](#会话压缩)
- [Bootstrap 引导文件](#bootstrap-引导文件)
- [输出解析](#输出解析)
- [权限控制](#权限控制)
- [执行安全 (execSecurity)](#执行安全-execsecurity)
- [系统提示词架构](#系统提示词架构)
- [AI 引擎内部模块](#ai-引擎内部模块)
- [Provider 统一抽象](#provider-统一抽象)
- [小模型适配](#小模型适配)
- [流式输出](#流式输出)
- [多模态支持](#多模态支持)
- [自定义 Provider](#自定义-provider)

## 架构概览

AI 能力分为两层包：

- **`@zhin.js/ai`** — 框架无关的 AI 引擎（Provider、Agent 循环、Session、Memory、Compaction），可独立用于非 IM 应用
- **`@zhin.js/agent`** — IM 场景的 Agent 编排（ZhinAgent、AIService、子任务、用户画像、引导文件），桥接 `@zhin.js/core` 和 `@zhin.js/ai`

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'fontSize': '13px' }}}%%
flowchart TD
  A([" 📨 用户消息 "]) --> MW["root.middleware"]
  MW --> B["MessageDispatcher"]
  B --> C["AI Handler"]
  C --> D["🤖 ZhinAgent\n@zhin.js/agent"]

  subgraph pipeline [" Agent 处理管线 "]
    direction TB
    D --> E["🎯 收集工具\nSkill 粗筛 → Tool 细筛"]
    E --> F["📋 ContextRepository\nload / append 历史"]
    F --> G["runAgentLoopTextTurn\n或 VisionTurn"]
  end

  G --> AL["🔄 agentLoop\n@zhin.js/ai"]

  subgraph parallel [" 并行入口（同一 agentLoop）"]
    direction LR
    SA["SubagentManager"] --> ST["runAgentLoopStandaloneTurn"]
    DW["DeferredWorkerRunner"] --> ST
    SV["AIService\nServiceAgent"] --> ST
    ST --> AL
  end

  AL --> H(["📤 回复用户"])

  classDef input fill:#e3f2fd,stroke:#1565c0,color:#0d47a1,rx:20
  classDef output fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20,rx:20
  classDef agent fill:#1565c0,stroke:#0d47a1,color:#fff,rx:8
  classDef engine fill:#6a1b9a,stroke:#4a148c,color:#fff,rx:8
  classDef step fill:#e8eaf6,stroke:#3949ab,color:#1a237e,rx:6
  classDef normal fill:#f5f5f5,stroke:#bdbdbd,color:#424242,rx:6
  classDef side fill:#fff3e0,stroke:#ef6c00,color:#e65100,rx:6

  class A input
  class H output
  class D agent
  class AL engine
  class E,F,G step
  class B,C normal
  class SA,DW,SV,ST side
```

核心组件（按包归属）：

**@zhin.js/ai（通用 AI 引擎）**：
- **AIProvider** - LLM 提供者统一接口（OpenAI、Anthropic、Ollama、DeepSeek、Moonshot、Zhipu）；经 `registerLlmApiFromProviders` 桥接到 **agentLoop**
- **agentLoop** - 唯一 LLM 回合引擎（工具循环、`maxIterations`、steer / followUp 队列）
- **ContextRepository** - 可序列化 `AgentMessage[]` 读写（内存或 `agent_messages` + `agent_summaries`）
- **AgentSessionStore** - `agent_sessions` 活跃/归档（`session_key` → 纪元 `session_id`）
- **ImTranscriptStore** - `im_transcripts` 扁平静态 IM 消息（旁听、`chat_history` 工具）
- **AgentSessionStore** + **ContextRepository** — IM 主路径会话与 LLM 历史（ADR 0009）
- **ContextManager** - 场景级摘要（`context_summaries`，非 IM 主路径）
- **ConversationMemory** - 主题检测 + 链式摘要（辅助；LLM 历史以 `ContextRepository` 为准）
- **CostTracker** - Token 用量与成本追踪器，支持按模型/Provider 统计
- **FileStateCache** - 文件状态缓存，减少重复磁盘读取
- **MicroCompact** - 微压缩引擎，增量式上下文摘要
- **ToolSearchCache** - 工具搜索结果缓存，加速重复查找
- **RateLimiter** - 请求速率限制
- **ToneDetector** - 消息情绪感知

**@zhin.js/agent（IM Agent 编排）**：
- **ZhinAgent** - IM 主对话：`promptController` → `runAgentLoopTextTurn` / `runAgentLoopVisionTurn`
- **AIService** - Provider 注册与路由；`createAgent()` 返回 **`ServiceAgent`**（`runAgentLoopStandaloneTurn`）
- **SubagentManager** - 后台子任务 → `runAgentLoopStandaloneTurn`（隔离内存 context）
- **DeferredWorkerRunner** - toolSearch Worker → 同上
- **FollowUpManager** - 定时跟进提醒管理器
- **UserProfileStore** - 用户画像，跨会话个性化
- **BootstrapLoader** - 引导文件加载（SOUL.md / AGENTS.md / TOOLS.md）
- **ExecPolicy** - Bash 执行安全策略（6 层纵深防御）
- **FilePolicy** - 文件访问安全验证（路径检查、设备路径拦截、命令读写分类）
- **buildRichSystemPrompt** - ZhinAgent 主路径 system prompt（常驻段 + Platform / Skills / Bootstrap 注入）
- **PromptBuilder** - 可选分层提示词 API（非默认主路径）

**@zhin.js/core（IM 层）**：
- **SkillFeature** - 技能注册中心，管理所有 Skill
- **ToolFeature** - 工具注册中心，管理所有 Tool
- **MessageDispatcher** - 消息调度器，判断消息是否触发 AI

### IM 消息事实源（im_transcripts）

入站、出站消息由 **`zhin.js` 运行时**（`registerChatMessageStore`，经 `@zhin.js/agent` 挂载）在 core 生命周期落库，**不经过** ZhinAgent 写入：

| 事件 | 时机 | 表 |
|------|------|-----|
| `message.receive` | 入站 `middleware` + `MessageDispatcher` 完成后（生命周期事件） | `im_transcripts`（direction=inbound，`body` + `media_json`） |
| `message.send` | `Adapter.sendMessage` 平台发送成功后 | `im_transcripts`（direction=outbound） |

**LLM 对话历史**（epoch 内多轮 tool-calling）由 `ContextRepository` 读写 `agent_messages`；turn 结束 `appendMessages`。归档会话：`/reset`（归档 `agent_sessions`，保留 `im_transcripts` 审计行）。

> 旧表 `chat_messages` / `ai_sessions` / `ai_summaries` 已不再注册或读写；删库重建后仅创建 ADR 0009 五表。

## 配置

在 `zhin.config.yml` 中配置 AI 模块（**须已安装 `@zhin.js/agent` 与至少一个 `@ai-sdk/*`**）：

```yaml
ai:
  providers:
    ollama:
      sdk: ollama
      host: "http://localhost:11434"
      # models 可省略 — listModels（/api/tags）自动发现
      num_ctx: 32768
      contextWindow: 32768
    openai-main:
      sdk: openai
      apiKey: "${OPENAI_API_KEY}"
      baseUrl: "https://api.openai.com/v1"
      contextWindow: 128000
      # models 可省略 — listModels（GET /v1/models）；中转/聚合同样适用
    anyrouter:
      sdk: anthropic
      apiKey: "${ANTHROPIC_API_KEY}"
      baseUrl: "${ANTHROPIC_BASE_URL}"
      # anyrouter.top — 模型 id 以控制台列表为准（如 claude-opus-4-8，无 [1m] 后缀）
      # agents.<name>.model 建议显式指定；Sonnet/Opus 若 400 需先在 AnyRouter 开通 1M

  agents:
    zhin:
      provider: ollama
      model: qwen3:14b          # 须出现在发现列表；留空则由 Tier 选最优
    vision:
      provider: openai-main
      model: gpt-4o
      priority: 100
      match:
        hasMedia: [image]       # 入站含图时路由到 vision agent

  sessions:
    useDatabase: true
    maxHistory: 50
    expireMs: 3600000
    coldStartMaxMessages: 50      # ContextRepository 冷启动 tail 条数（agent_messages）
    coldStartMaxAgeMs: 86400000   # 冷启动时间窗（毫秒）
    sessionIdleArchiveMs: 604800000  # 空闲归档 active 会话（0=关闭）

  context:
    enabled: true
    maxRecentMessages: 100    # 读取的最近消息数（默认 100）
    summaryThreshold: 50      # 触发总结的消息数阈值（默认 50）
    keepAfterSummary: 10      # 总结后保留条数（默认 10）
    maxContextTokens: 4000    # 上下文 token 估算上限（默认 4000）
  
  agent:
    execSecurity: allowlist   # 默认 deny；示例为 allowlist
    execPreset: custom        # readonly / network / development / custom（默认 custom）
    execAllowlist:            # 与 preset 合并
      - "curl"
    maxIterations: 15         # 默认 15（技能激活时再 +3）
    contextTokens: 128000
    maxHistoryShare: 0.5
    toneAwareness: true
    modelSizeHint: medium     # small / medium / large（留空自动推断）
    maxSubagentIterations: 25 # 默认 25
    phaseTrace: false         # 输出 Agent 阶段观测日志（或 ZHIN_AGENT_PHASE_TRACE=1）
    modelHarness:
      providerPatterns:
        "open*":
          maxIterations: 7
      models:
        "openai:gpt-4o":
          maxIterations: 9
  
  trigger:
    enabled: true
    prefixes: ["#", "AI:", "ai:"]   # 框架默认含 ai:
    respondToAt: true
    respondToPrivate: true
    ignorePrefixes: ["/", "!", "！"]
    timeout: 60000
```

`ai.sessions` 与 `ai.context` 字段定义见 `@zhin.js/ai` 的 `AIConfig`（`packages/im/ai/src/types.ts`）。会话默认：数据库模式 `maxHistory` 200、`expireMs` 7 天；内存模式 100 / 24 小时。

**模型绑定**：主对话用 **`ai.agents.zhin`**（`provider` + `model`）；识图等多 agent 路由用 `agents.<name>` + `priority` / `match`。已废弃 `defaultProvider`、`ai.agent.chatModel` / `visionModel`（启动时可能打迁移警告）。

## Agent 配置详解

`ai.agent` 下的 harness / 安全 / 迭代配置（**不含**模型名；模型在 `ai.agents.<name>`）：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxIterations` | number | 15 | 最大工具调用轮数（会叠加 model harness 默认值与技能激活 +3） |
| `timeout` | number | 120000 | 单次 Agent 回合超时（ms） |
| `preExecTimeout` | number | 15000 | 预执行超时（ms） |
| `maxSkills` | number | 5 | 单次请求最多匹配的 Skill 数量 |
| `maxTools` | number | 12 | 单次请求最多下发的工具数量 |
| `contextTokens` | number | 128000 | 上下文窗口 token 数 |
| `maxHistoryShare` | number | 0.5 | 历史记录占上下文窗口的最大比例 |
| `toneAwareness` | boolean | true | 是否启用情绪感知 |
| `execSecurity` | string | 'deny' | bash 执行策略：deny / allowlist / full |
| `execPreset` | string | 'custom' | 预设命令白名单：readonly / network / development / custom |
| `execAllowlist` | string[] | [] | 白名单匹配**首段命令名**（见 exec-policy）；`allowlist` 下 **`icqq` 非敏感子命令**另有单独放行，见下文 [icqq 与 allowlist](#icqq-bash-exec) |
| `execApprovalMode` | `'ask' \| 'allow' \| 'deny'` | `'deny'` | 主 Agent 对白名单外 bash 的处理：`ask` 触发 Owner 确认（`ask_user` / `ZHIN_NEEDS_OWNER`）；见 [icqq 与 allowlist](#icqq-bash-exec) |
| `rateLimit` | object | {} | 速率限制配置 |
| `modelSizeHint` | string | '' | 模型大小提示（影响技能截断） |
| `skillInstructionMaxChars` | number | 0 | 技能指令最大字符数（覆盖自动推断） |
| `maxSubagentIterations` | number | 25 | 子 agent 最大工具调用轮数 |
| `subagentTurnWaitMs` | number | 300000 | 主回合结束前等待 spawn 子 agent 的毫秒数（0=不等待） |
| `subagentTools` | string[] | [] | 子 agent 额外允许的工具名（显式白名单追加；不自动继承主会话技能工具） |
| `toolExecution` | string | `tiered` | agent-loop 工具执行模式：`parallel` / `sequential` / `tiered`（默认）。`tiered` 时同轮内 `spawn_task` 与只读工具并行，写操作与 `bash` 仍顺序执行（[ADR 0030](../adr/0030-spawn-parallel-subagents.md)） |
| `maxParallelSubagents` | number | 5 | 并行子 agent 硬上限；`spawn` / `spawnSync` 超限时立即拒绝，不排队 |
| `subagentAutoContinue` | boolean | true | 异步子 agent 完成后写入主会话上下文并唤醒主 agent 续聊（默认开启） |
| `subagentDirectImDelivery` | boolean | false | 为 `true` 时，除主 agent 续聊外，额外将格式化子任务摘要直发 IM（旧行为；一般用 hook 替代） |
| `phaseTrace` | boolean | false | 开启后输出稳定 `[AGENT_PHASE]` 回合阶段日志（或 `ZHIN_AGENT_PHASE_TRACE=1`） |
| `modelHarness.providerPatterns` | object | {} | 按 provider 模式（支持 `*`）覆盖 harness |
| `modelHarness.models` | object | {} | 按 model id 覆盖 harness；支持 `model` 或 `provider:model` 精确键 |
| `compaction.enabled` | boolean | true | 是否启用 L1+L2 压缩 |
| `compaction.auto` | boolean | true | 接近窗口时自动 L2 |
| `compaction.keepRecentTokens` | number | 20000 | L2 后保留最近消息 token 预算 |
| `compaction.minKeepCount` | number | 2 | L2 后至少保留消息条数 |

`modelHarness` 与 TypeScript 默认表（`packages/im/agent/src/zhin-agent/model-harness.ts`）按 **ADR 0006** 规则合并：对象 deep merge，数组显式写出时完整覆盖默认数组。

### Agent phase 观测（排障）

开启以下任一开关后，主 Agent 回合会输出稳定 phase 序列日志：

- `ai.agent.phaseTrace: true`
- 或环境变量 `ZHIN_AGENT_PHASE_TRACE=1`

日志前缀固定为 `[AGENT_PHASE]`，示例 phase：`turn.start` → `tools.collected` → `path.agent_loop` → `agent_loop.turn.start` → `agent_loop.turn.end` → `turn.end`。

## 触发条件

AI 不会处理所有消息。只有满足以下条件之一时才会触发：

1. **@机器人** - 群/频道中 **仅 @** 触发 AI 回复（需 `respondToAt: true`）；未 @ 的群消息会**旁听写入**同 session 上下文，供下次 @ 时带入
2. **私聊** - 直接发私聊消息（需 `respondToPrivate: true`）
3. **前缀触发** - 私聊等单人会话中，消息以指定前缀开头（如 `#今天天气怎样`）；群/频道不用此前缀触发

以下消息会被排除：
- 以 `ignorePrefixes` 中的前缀开头的消息（通常是命令）

### MessageDispatcher：指令与 AI 路由

`Adapter.emit('message.receive')` 经 **`runInboundMessage`**：先走根 **`middleware`**（`addMiddleware` 洋葱链），终端 `next()` 内 **`await MessageDispatcher.dispatch`**，再进入根插件生命周期 `message.receive`（详见 [消息如何流转](/essentials/message-flow)）。

- **互斥（默认）**：`dispatcher.mode: exclusive`（框架与 `createMessageDispatcher` 默认值）——命中指令路径后不再走 AI；未命中指令时再判断是否走 AI。
- **独立判定（按需）**：`dispatcher.mode: dual` 时，「是否走指令」与「是否走 AI」**分别**判断；可同时为真并按 `order` 执行；`allowDualReply: true` 时可能各回复一次（两次 `$reply`）。
- **顺序与开关**：在 `dual` 模式下，`order` 为 `command-first`（默认）或 `ai-first`；`allowDualReply: false` 且双命中时只执行顺序上的**第一个**分支。
- **出站润色**：与 **`Adapter.sendMessage` → `renderSendMessage`（`resolveRichSegments` → `before.sendMessage`）** 同一管道。`dispatcher.addOutboundPolish(handler)` 会往**根插件**注册额外的 `before.sendMessage`；仅当通过 **`MessageDispatcher.replyWithPolish`** 回复时，框架会用异步上下文带上入站 `message` 与 `source`（`command` / `ai`），润色函数与手写 `before.sendMessage` 内可通过 **`getOutboundReplyStore()`**（`@zhin.js/core` / dispatcher 导出）读取。直接 `message.$reply` 的调用仍会走 `before.sendMessage`，但**没有**该异步上下文，润色 handler 应跳过（`getOutboundReplyStore()` 为空）。
- **双轨配置示例**（仅在你需要指令与 AI 同时判定时，`zhin.config.yml`）：

```yaml
dispatcher:
  mode: dual
  order: command-first
  allowDualReply: true
# … ai 等其余配置
```

- **notice / request**：本期仍由适配器 `dispatch` 事件，**不**经 MessageDispatcher；与消息双轨对齐留待后续。

## 消息处理流程

### 1. 工具收集（两级过滤）

**第一级：Skill 粗筛** — 根据用户消息关键词匹配相关的 Skill。

**第二级：Tool 细筛** — 从匹配到的 Skill 中取出工具，按权限过滤、按相关性评分排序。

### 2. 上下文构建

`ContextRepository.loadContext(sessionId)` 加载当前 epoch 的 `AgentMessage[]`；用户画像、Bootstrap、预执行工具结果注入 system prompt。多模态入站转为 `{ type: 'image', data, mimeType }` content block（ADR 0009 D2）。

### 3. agentLoop（单一路径）

- **无工具** → `agentLoop`，`maxIterations=1`（原 chat 路径已删除）
- **有工具** → 同一 `agentLoop`；`preExecutable` 工具在 turn 前并行预跑，结果注入 prompt
- **多模态** → vision 模型 + image blocks，仍走 `agentLoop`（`runAgentLoopVisionTurn`）

并发同 session：每条入站 @ 消息 **独立并行 turn**（`PromptController.schedule`）；`ContextRepository.appendMessages` 经 per-session 写入锁串行化。master **`steer()`** 注入该 session 最新 active turn（`ai.agent.steeringMode` / `followUpMode` 仍作用于单 turn 内队列）。`spawn_task` 可把复杂任务交给子 agent；异步完成后**先交还主 agent 续聊**，再由主 agent 向用户回复（见 [子任务](#子任务-subagent)）。

### 4. 自适应 maxIterations

当检测到 `activate_skill` 或 `install_skill` 在工具列表中时，自动将 `maxIterations` 增加 3，避免多步技能流程被提前截断。

## 会话管理

AI 为每个场景（群/私聊）维护独立的会话历史，支持内存模式和数据库持久化模式。

### 自动摘要

当对话消息数超过阈值时，AI 自动生成链式摘要：

```
第 1-10 轮对话 → 摘要 A
第 11-20 轮对话 → 摘要 B（包含摘要 A 引用）
```

## 工具与技能

详见 [工具与技能](/advanced/tools-skills)。

### 注册工具

```typescript
const { addTool } = usePlugin()

addTool({
  name: 'search_music',
  description: '搜索音乐',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
    },
    required: ['keyword'],
  },
  execute: async (args) => {
    return await searchMusic(args.keyword)
  },
})
```

### 文件化工具（`*.tool.md`）

除了程序化注册，还可以在 `tools/` 目录放置 `*.tool.md` 文件声明工具——无需 TypeScript 代码：

```markdown
---
name: greeting
description: 生成个性化问候语
parameters:
  name:
    type: string
    description: 用户名称
    required: true
---
你好，{{name}}！欢迎使用 Zhin.js 🎉
```

需要复杂执行逻辑时，在 frontmatter 加 `handler: ./handler.ts`，指向默认导出函数。详见 [文件化 Tool](/advanced/tools-skills#文件化-tool-tool-md)。

### Agent 预设（`*.agent.md`）

在 `agents/` 目录放置 `*.agent.md` 声明领域专长 Agent，AI 可自动委派子任务：

```markdown
---
name: code-reviewer
description: 代码审查专家
tools: [read_file, grep]
model: gpt-4o
maxIterations: 8
---
你是一个资深代码审查员，专注于安全和性能问题。
```

Body 作为 `systemPrompt` 注入。详见 [Agent 预设](/advanced/tools-skills#agent-预设-agent-md)。

### 技能（文件化）

在插件或适配器包内维护 `skills/<name>/SKILL.md`（见 [工具与技能](/advanced/tools-skills)）。Core 不再提供 `declareSkill` API；技能记录由 Agent 等运行时同步到 `SkillFeature`。

### 安装外部技能 (install_skill)

AI 可以从 URL 下载 `SKILL.md` 并安装到本地 `skills/` 目录。用户只需说"从 https://example.com/skill.md 安装技能"，AI 会自动调用 `install_skill` 下载并安装，然后用 `activate_skill` 激活。

### SKILL.md 编写指南

建议 SKILL.md 添加 `## 快速操作` 摘要段，供小模型优先使用：

```markdown
---
name: my-skill
description: 我的技能
tools:
  - web_fetch
  - write_file
---

# My Skill

## 快速操作
1. 调用 web_fetch 获取数据
2. 调用 write_file 保存结果

## 详细说明
...
```

### 技能热重载

工作区 `skills/` 目录支持 `fs.watch` 监控。新增或修改 SKILL.md 后，技能列表会自动更新，无需重启。

## MCP 集成

Zhin 可作为 **MCP Client** 消费外部工具（`ai.mcpServers`、`ai.memoryMcp`），也可通过 `@zhin.js/mcp` 作为 **MCP Server** 对外暴露插件开发能力。两者方向相反，配置入口不同。

要点摘要：

- Client 工具命名：`mcp_{server}_{tool}`，每轮 AI 前懒连接
- 需可选安装 `@modelcontextprotocol/sdk`
- Stable 默认关闭；YAML 示例见 [配置文件 — Advanced AI 开关](/essentials/configuration#advanced-ai-开关)

**完整教程**：[MCP 集成](/advanced/mcp)

## 工具与子任务

主 Agent 默认可以直接使用当前可见工具；复杂、耗时或专业角色任务通过 `spawn_task` 交给子 agent。旧版 `tool_search` / `run_deferred_task` 主编排已被 ADR 0024 的 Pipeline / 子任务模型取代。

- 概念与 Stable vs Advanced 对照：[Agent 概念入门](/advanced/agent-concepts)
- 提示词分段约定：[Agent 上下文块](/architecture/agent-context-blocks)
- Harness 与七种 Agent 角色：[Agent 安全与角色](/advanced/agent-harness-engineering)

## Deferred Tools（按需加载 schema）

ADR [0029](../adr/0029-deferred-tool-schema-loading.md)。每轮仅向模型暴露 `alwaysLoadedTools` + 会话已 `load_tool` / `load_skill` 的工具；全量 catalog 通过元工具发现。

```yaml
ai:
  agent:
    deferredTools:
      maxLoadedPerSession: 12
      alwaysLoadedTools:
        - ask_user
        - spawn_task
        - discover
        - load_tool
        - load_skill
```

工作流：`discover(kind)` → `load_skill` / `load_tool` → 调用业务工具。`activate_skill` 已移除；配置迁移：`orchestratorTools` → `deferredTools.alwaysLoadedTools`（`zhin setup --fix`）。

## 子任务 (Subagent)

`spawn_task` 工具允许 AI 将复杂或耗时的任务交给后台子 agent 异步处理（或 `wait: true` 同步等待）。

### 工作原理

1. 主 agent 调用 `spawn_task({ task, label, agent?, wait? })`（同轮可并行多个，见 ADR 0030）
2. `SubagentManager` 创建独立子 agent（**`runAgentLoopStandaloneTurn`**，不共享主 session 的 `ContextRepository`）
3. 子 agent 独立执行，不阻塞主对话（异步模式）
4. 完成后按 [结果回传](#结果回传主-agent-优先) 交还主 agent；用户最终看到主 agent 整理后的回复

`spawn_task` 工具描述与参数为英文（面向 LLM）；对用户可见文案由主 agent 续聊生成。

### 受限工具集

子 agent **没有**固定工具白名单。工具由 `resolveSubagentAgentTools` 按角色和任务选择：

1. 先载入 `ai.agent.workerBaseTools`（默认 `bash`、`read_file`、`web_search`）
2. 再按任务文本 TF-IDF 从 deferred 工具目录载入（上限 `deferredToolMaxResults`，默认 8）
3. 任务含生图关键词时优先载入 `generate_image`（若已注册）

**禁止**子 agent 直接调用主编排工具：`spawn_task`、`discover`、`load_tool` / `load_skill`（子会话内按需 load 除外）、`install_skill`。

**安全**：子 agent 的 `bash` 受 `execSecurity` 与 `subagentExecApprovalMode` 约束；icqq 放行规则与主会话一致（见 [icqq 与 bash](/advanced/ai#icqq-bash-exec)）。

### 结果回传（主 agent 优先）

异步 `spawn_task`（默认 `wait: false`）完成后的顺序：

1. **交还主 agent（必走）** — `SubagentManager.onSubagentComplete` → `persistSubagentResultToContext` 写入主会话 → `continueAfterSubagent` 唤醒主 agent 续聊 turn；用户可见回复由主 agent 整理后经正常出站链发出。
2. **Hook / 事件（可选）** — `ai.subagent.finish`（及 `onEvent` phase `finish`）携带 `taskId`、`label`、`reply` 等，供插件打 log、监控或自定义副作用。
3. **直发 IM（可选，默认关）** — `ai.agent.subagentDirectImDelivery: true` 时，额外调用 `resultSender` 将「【label】完成」类格式化摘要直推频道；一般不必开启。

同步等待（`wait: true`）时，结果经 `spawn_task` tool result 直接回到**当前**主 agent turn，不触发 auto-continue。

### 并行 spawn 与并发上限（ADR 0030）

- **`toolExecution: tiered`（默认）**：同一 assistant turn 内，多个 `spawn_task` 与只读工具（`read_file`、`grep`、`glob`、`web_search` 等，SSOT：`packages/im/ai/src/llm/tiered-tool-buckets.ts`）可并行执行；`bash`、写文件、`ask_user` 等仍顺序执行。
- **`maxParallelSubagents: 5`（默认）**：后台同时运行的子 agent 数硬顶；超限 `spawn` / `spawnSync` 立即拒绝并提示等待或拆分批次。
- **编排提示**：`spawn_task` 工具描述与主 Agent orchestration system prompt 均引导「独立子任务可在单条消息中并行 spawn」。

### 子 agent 类型权限（permission.task）

限制主 agent 可见/可选的子 agent 类型（`agents/*.agent.md` / 预设名）：

```yaml
ai:
  agents:
    zhin:
      provider: openai
      model: gpt-4o-mini
      permission:
        task:
          "*": deny
          pm: allow
          dev*: allow
          researcher: allow
```

规则为 glob → `allow` / `deny`，**最后匹配优先**；未配置时默认全部允许。未授权类型不会出现在 `spawn_task` 工具描述中，执行期仍会校验。

### Hook：监听子 agent 完成

```typescript
import { subscribeAIEvents } from '@zhin.js/agent';

subscribeAIEvents(plugin, {
  onSubagentFinish: async (payload) => {
    // payload.taskId, payload.label, payload.reply, payload.status …
    // 打 log、指标、或自定义 IM（勿替代主 agent 续聊 unless subagentDirectImDelivery）
  },
});
```

### 主编排常驻

`spawn_task` 在每轮 turn 中由 `turn-pipeline` 注入（需已初始化 `SubagentManager`），并列入 `deferredTools.alwaysLoadedTools` 默认常驻。文生图请使用 **`agent: draw`**（`agents/draw.agent.md`）；**`vision`** 仅用于入站识图，不要用于画图。

## 文生图 (generate_image)

主编排**不常驻** `generate_image`（控制 prompt 体积）；通过子 agent 调用。

### 调用路径

| 场景 | 路径 |
|------|------|
| 当场出图 | `spawn_task(task, label, agent: "draw", wait: true)` |
| 后台出图 | `spawn_task(task, label, agent: "draw")` + `ai.agents.draw` + `agents/draw.agent.md` |

子 agent 任务含「画/生图」等关键词时，会优先载入 `generate_image`（见 `resolve-subagent-tools`）。

### Provider 与 sdk（ADR 0018）

| sdk | 文生图 | 说明 |
|-----|--------|------|
| `openai-compatible` + 智谱 baseUrl | `cogview-3-flash` | 智谱 Flash 系列免费文生图 |
| `openai-compatible` + Cloudflare accountId | `@cf/.../flux-1-schnell` | Workers AI 聊天走 OpenAI 面；**出图**仍走 `/ai/run`（ADR 0018 例外） |
| `openai` | `gpt-image-2` | OpenAI Images API |
| `google` | `gemini-2.5-flash-image` | Nano Banana |

### 配置

```yaml
ai:
  imageGeneration:          # 全局默认
    watermarkEnabled: false # 智谱去水印须先在开放平台签署声明
  providers:
    zhipu-vl:
      sdk: openai-compatible
      baseUrl: https://open.bigmodel.cn/api/paas/v4
      apiKey: ${BIG_MODEL_API_KEY}
      imageGeneration:
        defaultModel: cogview-3-flash
        defaultSize: 1024x1024
        promptSuffix: "写实摄影..."  # 可选，追加到 prompt
    # openai-image:
    #   sdk: openai
    #   imageGeneration: { defaultModel: gpt-image-2, quality: medium }
    # gemini-image:
    #   sdk: google
    #   imageGeneration: { defaultModel: gemini-2.5-flash-image, aspectRatio: "1:1", imageSize: "1K" }
  agents:
    draw:
      provider: zhipu-vl
      model: glm-4.7-flash   # 工具循环；生图走 generate_image API
```

### 工具参数

`generate_image` 必填：`provider_alias`（`ai.providers` 中的实例名）、`prompt`。可选：`model`、`size`（OpenAI/智谱）、`quality`（GPT Image）、`aspect_ratio` / `image_size`（Gemini）、`watermark_enabled`（智谱）。

### ICQQ 出站大图

- **同机**：默认 `outboundMedia: file`（本机临时路径 → CQ `[image:...]`）。
- **异机 / 异进程 / 配置 `rpc`**：设置 `outboundMedia: base64`（或依赖 rpc 自动默认），经 `[image:base64://...]` 交给守护进程解码。

详见仓库内 [plugins/adapters/icqq/README.md](https://github.com/zhinjs/zhin/blob/main/plugins/adapters/icqq/README.md#发送图片)「发送图片」一节。

## 定时消息 (Follow-up)

`schedule_followup` 工具允许 AI 安排定时跟进提醒。

### 特性

- **持久化**：任务保存到数据库，重启不丢失
- **自动恢复**：启动时调用 `restoreFollowUps()` 恢复未完成的任务
- **自动取消**：同一会话创建新提醒时，旧的 pending 提醒自动取消
- **触发关键词**：提醒、定时、过一会、跟进、别忘、分钟后、小时后

### 示例

用户说"3分钟后提醒我喝水"，AI 调用：

```json
{ "action": "create", "delay_minutes": 3, "message": "该喝水啦！" }
```

## 用户画像

`user_profile` 工具让 AI 读写用户的个人偏好信息。

### 操作

- `get` — 读取用户所有偏好
- `set(key, value)` — 保存偏好（如 name, style, interests, timezone）
- `delete(key)` — 删除偏好

### 持久化

默认内存存储，调用 `upgradeProfilesToDatabase(model)` 后升级为数据库存储，实现跨会话个性化。

画像会被注入到系统 prompt 中（通过 `buildProfileSummary`），让 AI 在每次对话中都能感知用户偏好。

## 对话记忆

`ConversationMemory` 管理双层记忆：

### 短期记忆

滑动窗口保留最近 N 轮消息（默认 5），确保上下文连贯。

### 长期记忆（链式摘要）

当话题持续超过 `minTopicRounds` 轮时触发摘要。使用主题检测（`topicChangeThreshold`）判断话题边界，不同话题分别生成摘要。

### chat_history 工具

当用户消息包含「之前」「上次」「历史」「回忆」等关键词时，`chat_history` 工具被注入，**按需从 `im_transcripts` 查询**（不在进程内缓存全量历史）：

- `keyword`：模糊匹配 `im_transcripts.body`（同 `platform` + `endpoint_id` + `scene_id`）
- `keyword` 留空：返回最近 N 条（`limit`，默认 10）

LLM 上下文仍只读当前 epoch 的 `agent_messages`；`chat_history` 工具用于跨 epoch 旁听检索，不自动灌入 context。

## Hook 系统

AI 模块提供事件钩子，允许插件监听和响应 AI 行为。

### 事件类型

| 事件 | 触发时机 |
|------|---------|
| `message:received` | AI 收到用户消息时 |
| `message:sent` | AI 发送回复时 |
| `ai.session.compact` | 会话压缩时（L2 compaction 或 `/compact`） |
| `ai.session.new` | 新 epoch 创建时（`/reset` 后下次 @） |
| `agent:bootstrap` | Agent 初始化时 |
| `tool:call` | 工具被调用时 |

### 注册方式

```typescript
import { registerAIHook } from '@zhin.js/agent'

registerAIHook('message:received', async (event) => {
  console.log(`用户 ${event.data.userId} 说: ${event.data.content}`)
})
```

## 会话压缩

生产路径（ADR 0010）：`ZhinAgent` → `agentLoop` 的 **`transformContext`** 钩子依次执行 **L1 micro**（旧 tool 结果占位）与 **L2 LLM** 摘要（`agent_summaries`）。溢出时 `onContextOverflow` 触发压缩并重试一次。

```yaml
ai:
  agent:
    compaction:
      enabled: true      # 默认 true
      auto: true         # 接近 contextWindow 时自动 L2
      keepRecentTokens: 20000
      minKeepCount: 2
```

| IM 命令 | 说明 |
|---------|------|
| `/compact` | 手动 L2 压缩当前 epoch（master / trusted） |
| `/tree` · `/tree N` | 查看会话树、切换 `active_leaf` 分支 |
| `/reset` | 归档当前 epoch；`im_transcripts` 保留 |

`loadContext` 沿 `parent_id` 从 `active_leaf_message_id` 回溯；切换分支时可能触发 **branch summarization**（`agent_summaries.branch_anchor_message_id`）。Console：`GET/POST /api/agent/sessions/:sessionKey/tree|leaf`。

插件可在内置压缩之后链式扩展：`ctx.ai.onTransformContext(...)`。事件：`plugin.on('ai.session.compact', ...)`。

> 库级 API（`compactSession`、`pruneHistoryForContext`、`evaluateContextWindowGuard`）仍可从 `@zhin.js/ai` 导入，供单测与程序化调用；IM 主路径以上述 `transformContext` 为准。映射见 [pi-coding-agent-mapping](./pi-coding-agent-mapping.md)。

## Bootstrap 引导文件

项目根目录或 `data/` 下可放置引导文件，按 **SOUL → AGENTS → TOOLS** 顺序注入到 system prompt：

| 文件 | 用途 | 大小限制 |
|------|------|---------|
| **SOUL.md** | 人格与边界：性格、价值观、沟通风格。只读。 | 约 8KB |
| **AGENTS.md** | 记忆与操作指南：用户偏好、重要记录、待办。AI 可读写。 | 约 16KB |
| **TOOLS.md** | 工具使用指引：自定义工具使用规则与注意事项。 | 约 8KB |

- 文件不存在不报错；单文件与总长度有上限，超长会截断
- `clearBootstrapCache()` 可清除缓存重新加载
- 创建项目时可用 `create-zhin` 生成上述模板

### Heartbeat 与 Scheduler

若启用统一调度器，**HEARTBEAT.md** 会按周期（默认 30 分钟）被检查。若文件存在且内容非空，Agent 会执行一次固定 prompt。你可通过 `edit_file` / `write_file` 管理其中的任务列表。详见 [定时任务](/advanced/cron)。

### 文件制记忆

`data/memory/MEMORY.md` 用于长期记忆，`data/memory/{date}.md` 用于今日笔记。AI 可通过 `write_file` 写入重要事项。系统自动在 system prompt 中注入 Memory 段落。

## 输出解析

`parseOutput` 将 AI 的文本回复解析为结构化的 `OutputElement[]`：

### OutputElement 类型

| 类型 | 说明 |
|------|------|
| `TextElement` | 纯文本 |
| `ImageElement` | 图片（URL 或 base64） |
| `AudioElement` | 音频 |
| `VideoElement` | 视频 |
| `CardElement` | 卡片消息（带字段和按钮） |
| `FileElement` | 文件附件 |

### 渲染方法

- `renderToPlainText(elements)` — 渲染为纯文本
- `renderToSatori(elements)` — 渲染为 Satori XML

## 权限控制（SenderRole）

工具通过 `requiredAnyRole` 声明所需角色；`ToolContext.roles` 为发送者角色集合（`user`、`scene_admin`、`scene_owner`、`trusted`、`master`）。详见 [工具与技能](/advanced/tools-skills#权限控制senderrole-集合)。

**Breaking**：阶梯 `permissionLevel` 已移除；trigger 配置使用 `masters` / `trusted`，bot 配置使用 `endpoints[].master` / `endpoints[].trusted`。

## 执行安全 (execSecurity)

控制 AI 调用 `bash` 工具的权限。

### 策略模式

| 模式 | 说明 |
|------|------|
| `deny` | 禁止所有 Shell 命令（默认） |
| `allowlist` | 仅允许白名单内的命令 |
| `full` | 不限制（危险，仅开发环境使用） |

### 预设白名单 (execPreset)

| 预设 | 包含命令 |
|------|---------|
| `readonly` | ls, cat, pwd, date, whoami, grep, find, head, tail, wc, stat, file |
| `network` | readonly + curl, wget, ping, dig, nslookup, host |
| `development` | network + npm, npx, node, git, gh, python, python3, pip, pnpm, yarn, tsc, bun |
| `custom` | 仅使用自定义 `execAllowlist` |

preset 和 `execAllowlist` 会合并，即 `execPreset: network` + `execAllowlist: ["docker"]` 会允许网络命令和 docker。

### 6 层纵深防御

exec-policy 实现了 6 层纵深防御：

| 层 | 防御内容 | 示例 |
|----|---------|------|
| **1. 危险命令黑名单** | 即使 full 模式也拒绝的命令：`sudo`, `su`, `eval`, `exec`, `dd`, `mkfs`, `gdb` 等 | `sudo rm -rf /` → 拦截 |
| **2. 环境变量前缀剥离** | 剥离 `KEY=value` 前缀后再匹配白名单，防止绕过 | `FOO=bar python evil.py` → 识别为 `python` |
| **3. Safe wrapper 剥离** | 剥离 `timeout`, `nice`, `nohup` 等安全包装器，检查实际命令 | `timeout 10 python evil.py` → 识别为 `python` |
| **4. 复合命令拆分** | 按 `&&`, `||`, `;` 拆分，每段独立检查，deny 优先 | `ls && rm -rf /` → 拦截 `rm` |
| **5. 只读命令自动放行** | 与 file-policy 的 `classifyBashCommand` 集成，只读命令无需白名单 | `cat file \| grep pattern` → 自动放行 |
| **5+. icqq 子命令分级** | `allowlist` 下首词为 `icqq` 时：非敏感子命令直接放行；敏感子命令需 Owner 确认或已配置的放行正则 / `approve always bash` | `icqq friend like 123` 通常直接放行；`icqq group kick …` 可能需确认 |
| **6. Owner 审批信号** | `execApprovalMode: ask` 时，未知命令返回 `ZHIN_NEEDS_OWNER` 而非硬拒绝 | `npm install` → 提示用户确认 |

### 交互式审批 (`execApprovalMode: ask`)

设置 `execApprovalMode: ask` 后，不在白名单但也不在黑名单的命令不会被直接拒绝，而是返回审批请求。AI 会调用 `ask_user` 工具向用户确认是否执行：

```yaml
ai:
  agent:
    execSecurity: allowlist
    execPreset: readonly
    execApprovalMode: ask    # 未知命令请求用户确认，而非直接拒绝
```

工作流程：
1. 用户要求 AI 执行 `npm install`
2. `npm` 不在 readonly 白名单 → 触发审批
3. AI 调用 `ask_user` 工具："要执行 `npm install`，是否允许？"
4. 用户确认后 AI 再执行

> **注意**：危险命令（黑名单中的 `sudo`/`eval`/`dd` 等）即使 `execApprovalMode: ask` 也会被直接拒绝，不可审批。

### icqq CLI 与 allowlist（bash 路径） {#icqq-bash-exec}

当 AI 通过 **`bash`** 执行 `icqq …` 子命令时（常见路径：启用 icqq 技能后由模型生成 shell）：

- **`execSecurity: allowlist`** 下，**非敏感** icqq 子命令（如状态查询、好友点赞等）**不需要**写进 `execAllowlist`，也**不需要**先加 `approve rule`，exec-policy 会直接放行（仍受危险命令黑名单、环境变量 / wrapper 剥离、复合命令拆分等约束）。
- **敏感**子命令（踢人、禁言、群解散/转让、好友删除/拉黑/移动、支付与钱包、撤回、部分群文件删除等）在 `execApprovalMode: ask` 时会走 **Owner 确认**（编排层 `ask_user` / `ZHIN_NEEDS_OWNER`）；Owner 可在私聊用 **`approve rule <正则>`** 对**整条规范化后的子命令**做持久化匹配（例如 `^icqq\s+friend\s+like\b`），避免把 QQ 号写死在白名单里。敏感子命令的判定见源码 `packages/im/agent/src/security/owner-approve-always-store.ts` 中的 `ICQQ_SENSITIVE_SUBCOMMAND_REGEXES`。

> **说明**：旧文档中的 `execAsk` 已废弃；配置请使用 `execApprovalMode`（实现见 `packages/im/agent/src/zhin-agent/config.ts`）。

### Endpoint Owner 私聊指令（approve） {#owner-approve-commands}

仅 **Bot Owner** 在**私聊**中可用（指令以 `/` 开头）：

| 指令 | 作用 |
|------|------|
| `/approve always bash` | 对本 Endpoint **永久**跳过 bash 链路上的 Owner 硬编排确认；写入 `data/owner-approve-always.json` |
| `/approve always` | 同上，但须在近期 bash 待确认窗口内，否则应使用上一行 |
| `/approve rule <正则>` | 增加一条**子命令级**放行：用 `RegExp(正则)` 匹配整条待检子命令（常用于敏感 icqq 的「整类放行」） |
| `/approve list` | 列出 bash 永久放行状态与各条规则的 id |
| `/approve revoke rule <id>` | 按 id（或前 8 位前缀）删除一条正则规则 |
| `/approve revoke` | 撤销 bash **永久**放行；**不**删除已保存的正则规则 |

持久化结构为 JSON **v2**（`bashAlways`、`bashRules[]`），文件路径：**`data/owner-approve-always.json`**（与数据目录配置一致）。

### 子任务安全

SubagentManager 的 `bash` 工具受同一 `execSecurity` 策略约束。子 agent 运行时会挂载与 `origin` 一致的会话上下文（含 `platform`、`endpointId` 等），以便 **icqq 敏感放行规则** 与主会话一致生效，不存在「子任务绕过 icqq Owner 规则」的路径。

## Provider 统一抽象

所有 Provider 共享统一接口：

```typescript
// 定义在 @zhin.js/ai
interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  contextWindow?: number   // 上下文窗口大小（token 数）
  models?: string[]        // 可选；显式列出时作 ApiRegistry 白名单并跳过自动发现
  capabilities?: {
    vision?: boolean
    streaming?: boolean
    toolCalling?: boolean
    thinking?: boolean
  }
}
```

各 Provider 将 `contextWindow` 映射到自身参数（Ollama → `num_ctx`，OpenAI/Anthropic 用于窗口管理）。**未配置 `models`** 时由 `ModelRegistry.discover()` 填充 `provider.models`（`listModels` → `/v1/models` 等）；**已配置 `models`** 时以 yaml 为白名单，不调用发现接口覆盖列表。

### 查询能力

```typescript
const caps = aiService.getProviderCapabilities('ollama')
// { contextWindow: 32768, capabilities: { vision: true, streaming: true, ... } }
```

## 模型自动发现与智能选择

未在 yaml 配置 **`providers.<别名>.models`** 时，框架自动发现可用模型，**无需**为中转 API 手写白名单。

### 两层协作

| 层 | 模块 | 职责 |
|----|------|------|
| 发现与排序 | **ModelRegistry** | `discover()` → `provider.listModels()`；Tier 评分；`data/model-registry-cache.json` |
| agentLoop 校验 | **ApiRegistry**（`getModel`） | 未显式 `models` 时用发现后的 `provider.models` 作白名单；显式 `models` 则以 yaml 为准 |

接线（`@zhin.js/agent`）：`AIService` 对无 `models` 的 provider 在 ApiRegistry 注册 `[]`；`createZhinAgent` 先 `loadCache()` 恢复列表，再后台刷新 `/v1/models`。冷启动发现完成前，白名单为空则不拦截 `agents.*.model`。

### 自动发现

`listModels()` 来源：

- **Ollama**：`/api/tags`；详情 `/api/show`（参数量、量化）
- **OpenAI 兼容**（含中转/聚合）：`GET {baseUrl}/models`

发现结果写入 `provider.models` 并缓存到 `data/model-registry-cache.json`。

### 智能选择（Tier 评分）

ModelRegistry 为每个模型计算 **Tier 评分**（0-100 分），用于自动选择最优模型：

| 模型系列 | 评分示例 |
|----------|----------|
| claude-opus, gpt-5 | 95-96 |
| claude-sonnet-4.6, o3 | 90-93 |
| gpt-4o, gemini-pro | 88 |
| deepseek-r1, qwen-max | 85 |
| kimi, grok | 80-82 |
| glm-4 | 78 |
| 小模型 (< 8B) | 40-60 |

自动发现后，模型列表按 Tier 评分降序排列，`provider.models[0]` 自动指向最优模型。

### 自动降级

当首选模型请求失败时（如限流、负载过高），按 `resolveModelCandidates` 候选列表依次尝试下一模型：

- **文本 / 工具回合**：`runAgentLoopTextTurn` → `agentLoop`（OpenAI bridge 调 `provider.chat`）
- **多模态回合**：`runAgentLoopVisionTurn` 对 vision 候选链式 fallback
- **子 agent / deferred worker / AIService**：`runAgentLoopStandaloneTurn` → 同一 `agentLoop`（隔离内存 context）

降级时会输出日志（如 multimodal：`mode: multimodal, fallback: modelA→modelB`）。

### 配置示例

**最简配置**（全自动）：
```yaml
ai:
  providers:
    ollama:
      sdk: ollama
      host: "http://localhost:11434"
  agents:
    zhin:
      provider: ollama
      model: qwen3:14b   # 可省略 model，由 Tier 选 provider.models[0]
```

**指定主模型与识图 agent**：
```yaml
ai:
  providers:
    openai-main:
      sdk: openai
      apiKey: "${OPENAI_API_KEY}"
      baseUrl: "https://api.openai.com/v1"
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o
    vision:
      provider: openai-main
      model: gpt-4o
      priority: 100
      match:
        hasMedia: [image]
```

**API 聚合 / 中转**（如 9router；**无需**手写 `models` 列表）：
```yaml
ai:
  providers:
    router:
      sdk: openai-compatible
      apiKey: "${ROUTER_API_KEY}"
      baseUrl: "http://my-router:8000/v1"
  agents:
    zhin:
      provider: router
      model: cu/claude-4.5-sonnet   # 须出现在 GET /v1/models 响应中
```

### 编程接口

```typescript
import { ModelRegistry } from 'zhin.js/ai'

const registry = new ModelRegistry(logger)

// 发现模型
const models = await registry.discover(provider)

// 智能选择
const bestChat = registry.selectModel(provider.name, 'chat')
const bestVision = registry.selectModel(provider.name, 'vision')

// 获取候选列表（用于降级）
const candidates = registry.selectModels(provider.name, 'chat', 5)
```

## 小模型适配

针对 8B 及以下小模型的优化策略。

### 模型大小推断

系统根据模型名称自动推断大小：
- **small**：`qwen3:8b`, `llama3.2:3b` 等（参数量 ≤ 8B）
- **medium**：`qwen3:14b`, `llama3.1:32b` 等（14B-32B）
- **large**：`gpt-4o`, `claude-sonnet` 等（> 32B 或 API 模型）

可通过 `modelSizeHint` 手动覆盖推断结果。

### 技能指令分级截断

根据模型大小动态调整 `extractSkillInstructions` 的截断长度：
- **small**：1500 字符（只保留 intro + 快速操作段）
- **medium**：4000 字符（默认）
- **large**：8000 字符（更完整的技能指令）

可通过 `skillInstructionMaxChars` 手动覆盖。

### SKILL.md 摘要协议

SKILL.md 作者可添加 `## 快速操作` / `## Quick Actions` 段落。小模型优先只使用该摘要段，避免信息过载导致幻觉。

## 流式输出

当适配器支持时，AI 以流式方式输出响应。通过 `OnChunkCallback` 实现：

```typescript
type OnChunkCallback = (chunk: string, full: string) => void

agent.process(content, context, tools, (chunk, full) => {
  // chunk: 增量文本片段
  // full: 到目前为止的完整文本
  updateMessage(full)
})
```

## 多模态支持

AI 支持多种媒体类型的多模态输入（需要 LLM 支持视觉/音频能力）：

```typescript
agent.processMultimodal(
  [
    { type: 'text', text: '这是什么？' },
    { type: 'image_url', image_url: { url: 'https://...' } },
    { type: 'video_url', video_url: { url: 'https://...' } },
    { type: 'audio', audio: { data: 'base64...', format: 'mp3' } },
    { type: 'face', face: { id: '178', text: '笑哭' } },
  ],
  context
)
```

### 支持的媒体类型

| ContentPart 类型 | 说明 | IM 消息段类型 |
|---|---|---|
| `text` | 纯文本 | `text` |
| `image_url` | 图片（URL） | `image` |
| `video_url` | 视频（URL） | `video` |
| `audio` | 音频（base64） | `audio`, `record`, `voice` |
| `face` | 表情/贴纸 | `face`, `sticker`, `emoji` |

### 自动提取

当 IM 消息包含图片、视频、音频或表情时，AI 触发器会自动从 `message.$content` 中提取这些媒体元素并转换为 `ContentPart[]`，经 `preprocessInboundMedia` 处理后送入 `processMultimodal`。无需手动构建。

#### 入站音频策略（`ai.multimodal.audio.strategy`）

| strategy | 行为 | 依赖 |
|----------|------|------|
| `transcribe` | **默认**；调用 `@zhin.js/speech` STT，转写文本并入 AI 输入 | optional peer `@zhin.js/speech` |
| `mcp` | 落盘到 `data/media/inbound`，提示路径供 MCP/工具 | 无 |
| `text-only` | 仅文本占位描述，不转写 | 无 |

未安装 `@zhin.js/speech` 且 strategy 为 `transcribe` 时降级为占位文本（warn once）。配置见 [configuration — 语音](/essentials/configuration#语音-stt-tts-zhinjsspeech-optional-peer) 与 [ADR 0020](/adr/0020-speech-pipeline-stt-tts)。

### 输入：Segment 约定（SSOT）

多模态输入依赖 `message.$content`（`MessageElement[]`）中的 canonical **`Segment[]`**。段类型、`MediaRef`、legacy 映射与 IM 可见性见 **[Segment 内容模型](../architecture/segment-content-model.md)**（唯一权威表）。

仅当 `$content` 元素为 `MessageSegment`（`{ type, data, platform? }`）且 `type` 为 SSOT 所列 IM 可见类型时会被提取并转为 `ContentPart`；`MessageComponent` 或其它 type 会被安全跳过。

### 输出回传

AI 回复中的富媒体内容（图片、音频、视频）会自动解析为 `OutputElement[]`，然后通过 `parseRichMediaContent` 转换为 IM 消息段发送回用户：

- `![alt](url)` → 图片消息
- `[audio](url)` → 音频消息
- `[video](url)` → 视频消息

识图入站须配置 **`agents.vision`**（或带 `match.hasMedia: [image]` 的 agent）及对应 `model`。

#### Ollama 多模型 + 多模态示例

若本地通过 Ollama 同时跑多款模型（如 qwen3:14b、qwen2.5vl:7b），框架会自动发现并按 Tier 排序。

- **文本**：`agents.zhin.model`（或省略 model，用 Tier 最高项）
- **多模态**：`agents.vision` + `match.hasMedia: [image]`

```yaml
ai:
  providers:
    ollama:
      sdk: ollama
      host: "http://localhost:11434"
  agents:
    zhin:
      provider: ollama
      model: qwen3:14b
    vision:
      provider: ollama
      model: qwen2.5vl:7b
      priority: 100
      match:
        hasMedia: [image]
```

**显式锁定白名单**（跳过自动发现，同时作为 ApiRegistry 白名单）：

```yaml
ai:
  providers:
    ollama:
      sdk: ollama
      host: "http://localhost:11434"
      models:
        - qwen3:14b
        - qwen2.5vl:7b
  agents:
    zhin:
      provider: ollama
      model: qwen3:14b
    vision:
      provider: ollama
      model: qwen2.5vl:7b
      match:
        hasMedia: [image]
```

## 系统提示词架构

ZhinAgent 的系统提示词采用精简分层架构（`packages/im/agent/src/zhin-agent/prompt.ts`）：常驻段只保留必要边界，平台、技能、记忆等按需注入。

| 名称 | 内容 |
|------|------|
| **Context** | 人格设定、CWD、平台、时间、文件记忆路径 |
| **Style** | 输出风格：先答复结果、简洁、必要时 Markdown |
| **Tools** | 工具边界；deferred 模式下说明 `discover` → `load_skill` / `load_tool` 工作流 |
| **Safety** | 破坏性操作确认、Owner 信号、工具结果注入防护 |
| **Platform** | 适配器 `AgentPromptContributor` 按平台注入 |
| **Deferred Tools** | 已 defer 工具域统计（`deferredStats`） |
| **Skills / Active Skills** | 技能摘要与已激活技能上下文 |
| **Memory / Bootstrap** | 文件记忆与 SOUL.md / AGENTS.md / TOOLS.md 注入 |

每段由 `buildXxxSection()` 函数独立生成，最终由 `buildRichSystemPrompt()` 组装。空段自动跳过，不浪费 token。

## AI 引擎内部模块

### LLM 统一栈（`packages/im/ai/src/llm/`）

IM 与 AIService 的生产路径**只**经 `agentLoop`；legacy `Agent.run()` 仍存在于 `@zhin.js/ai` 供单测与直接 import，新代码应使用 `agentLoop` 或 `@zhin.js/agent` 的 turn runner。

| 模块 | 路径 | 说明 |
|------|------|------|
| `agentLoop` | `llm/agent-loop.ts` | 工具循环、`maxIterations`、steer / followUp |
| `registerLlmApiFromProviders` | `llm/register-api-layer.ts` | Provider → ApiRegistry；`provider.api` 必填 |
| `getModel` | `llm/api-registry.ts` | 模型白名单：显式 yaml `models` 或发现后的 `provider.models` |
| `complete` / `stream` | `llm/api-registry.ts` | 经 OpenAI bridge 调 `AIProvider.chat` |
| `ContextRepository` | `memory/context-repository.ts` | `AgentMessage[]` 读写 |
| `createUserMessage` 等 | `llm/messages.ts` | 原生消息类型 |

`@zhin.js/agent` 侧 turn 执行器：

| 执行器 | 用途 |
|--------|------|
| `runAgentLoopTextTurn` | ZhinAgent 文本回合（共享 session `ContextRepository`） |
| `runAgentLoopVisionTurn` | ZhinAgent 多模态回合 |
| `runAgentLoopStandaloneTurn` | Subagent、Deferred Worker、`AIService.ServiceAgent` |

### 性能与辅助模块

`@zhin.js/ai` 包含以下性能优化模块，通常无需直接使用，但可按需导入：

### CostTracker

追踪每次 LLM 调用的 token 用量和估算成本：

```typescript
import { CostTracker } from '@zhin.js/ai'

const tracker = new CostTracker()
tracker.record({ model: 'qwen3:14b', inputTokens: 1200, outputTokens: 350 })

console.log(tracker.summary())
// { totalCalls: 1, totalInputTokens: 1200, totalOutputTokens: 350, estimatedCost: 0.002 }
```

### FileStateCache

缓存文件 mtime 和内容摘要，避免工具多次读取同一文件时重复访问磁盘：

```typescript
import { FileStateCache } from '@zhin.js/ai'

const cache = new FileStateCache({ maxEntries: 500, ttlMs: 30000 })
const content = await cache.getOrRead('/path/to/file.ts')
```

### MicroCompact

轻量级上下文压缩，在完整 LLM 摘要之前先做增量裁剪：

```typescript
import { MicroCompact } from '@zhin.js/ai'

const compactor = new MicroCompact({ maxTokens: 2000 })
const compacted = compactor.compact(messages)
```

### ToolSearchCache

缓存工具关键词匹配结果，避免每轮对话重复扫描全部工具：

```typescript
import { ToolSearchCache } from '@zhin.js/ai'

const cache = new ToolSearchCache({ maxSize: 100, ttlMs: 60000 })
const tools = cache.getOrSearch('天气查询', () => searchTools('天气查询'))
```

## 自定义 Provider

只要兼容 OpenAI Chat Completions API 格式，就可以接入：

```yaml
ai:
  providers:
    my-local:
      sdk: openai-compatible
      baseUrl: "http://my-server:8000/v1"
      apiKey: "optional-key"
      contextWindow: 32000
  agents:
    zhin:
      provider: my-local
      model: my-model-id   # 须出现在 /v1/models 或写在 providers.my-local.models
```

::: tip ADR 0018
`zhin.config.yml` 中 `ai.providers.*` **须使用 `sdk`**（`openai` | `anthropic` | `google` | `deepseek` | `ollama` | `openai-compatible`）。旧字段 `api` / `preset` / `spec` / `driver` 会在启动时 **直接报错**（见 `normalizeProviderEntry`）。
:::

或实现 `AIProvider` 接口注册自定义 Provider：

```typescript
import { BaseProvider } from '@zhin.js/ai'
import type { AIProvider } from '@zhin.js/ai'

// 方式 1：继承 BaseProvider
class MyProvider extends BaseProvider {
  name = 'my-provider'
  models = ['my-model']
  contextWindow = 32000
  capabilities = { streaming: true, toolCalling: true }
  
  async chat(request) { /* ... */ }
  async *chatStream(request) { /* ... */ }
}

// 方式 2：实现 AIProvider 接口
class AnotherProvider implements AIProvider {
  name = 'another'
  models = ['model-a']
  contextWindow = 16000
  capabilities = { streaming: false, toolCalling: true }
  
  async chat(request) { /* ... */ }
  async *chatStream(request) { /* ... */ }
  async healthCheck() { return true }
}

aiService.registerProvider(new MyProvider())
```

### 核心类型参考

`ChatCompletionRequest` — 聊天补全请求：

```typescript
interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  temperature?: number
  top_p?: number
  max_tokens?: number
  stream?: boolean
  stop?: string | string[]
  think?: boolean  // 启用模型思考（如 qwen3 的 <think> 模式）
}
```

`ChatCompletionResponse` — 聊天补全响应：

```typescript
interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: { index: number; message: ChatMessage; finish_reason: 'stop' | 'length' | 'tool_calls' | null }[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}
```

`ProviderCapabilities` — Provider 能力声明：

```typescript
interface ProviderCapabilities {
  vision?: boolean      // 图片理解
  streaming?: boolean   // 流式输出
  toolCalling?: boolean // 工具调用
  thinking?: boolean    // 思考模式
}
```

## IM 运维与内省命令

由 `@zhin.js/agent` 注册（master / 有权限用户），完整表见各项目 `TOOLS.md` 或 [test-bot TOOLS.md](https://github.com/zhinjs/zhin/blob/main/examples/test-bot/TOOLS.md)：

| 类别 | 命令 |
|------|------|
| 会话 | `/compact` · `/tree` · `/tree N` · `/reset` |
| 运维 | `/models` · `/health` |
| 内省 | `/cmd` · `/endpoints` · `/bindings` · `/tools` · `/mcp`（支持 `[filter] [page]`，REST：`GET /api/introspection/*`） |

zhin-package：`zhin packages install`。详见 [CLI 参考](/reference/cli) 与 [ADR 0010](../adr/0010-pi-coding-agent-harness-alignment.md)。
