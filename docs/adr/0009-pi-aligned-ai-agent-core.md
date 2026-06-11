# 对齐 pi 的 AI/Agent 核心（Context + stream + agentLoop）

`@zhin.js/ai` 与 `@zhin.js/agent` 的 LLM 栈改为 **干净室** 对标 [pi `packages/ai`](https://github.com/earendil-works/pi/tree/main/packages/ai) / [pi `packages/agent`](https://github.com/earendil-works/pi/tree/main/packages/agent) 的接口形状：**Model + Context + stream/complete + agentLoop + TypeBox 工具**。允许 **major 破坏性变更**；**不迁移**旧 memory 数据。

Grill 决策摘要见本文「已定稿决策」章节（#1–#21）。

## 背景

### 迁移前问题（已解决项标注 ~~删除线~~）

1. ~~**双 LLM 路径**~~：已删除 `createAgent().run()` IM 主路径、`llm-runner.ts` chat/fast 分叉；统一 **`agentLoop`**。
2. ~~**双记忆栈**~~：IM 主路径统一 `ContextRepository` + `im_transcripts`；停注册 legacy `chat_messages` / `ai_sessions`。
3. **Provider 类树**：按 vendor 继承（`DeepSeekProvider extends OpenAIProvider`），OpenAI-compat 重复 endpoint/compat 逻辑；[`provider-instance.ts`](../../packages/im/agent/src/config/provider-instance.ts) 维护 `DRIVER_FACTORIES` 映射。（`api` 必填已落地；vendor 类树仍待后续收敛。）
4. ~~**Agent 循环单体**~~：IM 生产路径已拆为 `agentLoop` + turn runner；legacy `Agent.run` 仅保留供单测。
5. **工具 schema 多套**：JSON Schema `AgentTool`、orchestrator `Tool`、`ZhinTool`；校验经 `convertLegacyTools` + TypeBox 收敛，仍有多套定义。

### pi 可借鉴点（不 copy 源码）

| pi 概念 | 作用 |
|---------|------|
| `ApiRegistry` + `Model.api` | 按 **协议** 注册 stream 实现，vendor 为配置 |
| `stream(model, context)` | 唯一 LLM 入口 |
| `Context` | 可 JSON 序列化的 `systemPrompt + messages + tools` |
| `AssistantMessageEventStream` | `text_delta` / `toolcall_delta` / `thinking_delta` / `done` |
| `agentLoop` + `Agent` | 无状态循环 vs 有状态 `prompt/subscribe/steer` |
| TypeBox + `validateToolCall` | 工具参数校验 |

### 不在本 ADR 范围

- IM 出站链（`Message.$reply` / Adapter）— 见 ADR 0004
- Assistant Runtime / Cron / NotificationRouter — 见 ADR 0008；本变更仅替换其 **执行引擎消费侧** 的 LLM API
- pi 全量 Provider 清单（Bedrock/Codex OAuth 等）— 按需后续增量

## 决策

### D1. 唯一 LLM 入口：`stream` / `complete`

删除对外 `AIProvider.chat` / `chatStream`、`ChatCompletionRequest/Response/Chunk`。

新公开 API（`@zhin.js/ai`）：

```typescript
stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream
complete(model, context, options?): Promise<AssistantMessage>
streamSimple / completeSimple  // reasoning 简化为 thinkingLevel
getModel(providerAlias, modelId): Model
registerApiProvider({ api, stream, streamSimple })
```

`Model` 字段（最小集）：

| 字段 | 说明 |
|------|------|
| `id` | 模型 id |
| `provider` | yaml `ai.providers` 别名 |
| `api` | `openai-completions` \| `anthropic-messages` \| `google-generative-ai` \| … |
| `baseUrl?` | 覆盖 endpoint |
| `compat?` | OpenAI-compat 能力开关（`supportsDeveloperRole` 等） |
| `reasoning?` | 是否支持 thinking |
| `input` | `('text' \| 'image')[]` |
| `contextWindow` / `maxTokens` | 预算 |

配置：`ai.providers.<alias>.api` **必填**；**删除 `driver` 字段**。文档提供 `driver → api` 迁移对照表（仅文档，无运行时 shim）。`examples/`、`scaffold-wizard`、`zhin.config.yml` 全量更新。

### D2. 原生 pi 式 `Context`

```typescript
interface Context {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: Tool[];
}

type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CustomAgentMessage;  // IM 扩展经 declaration merging，convertToLlm 过滤

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };
```

- **assistant** 消息用 content blocks（含 `toolCall`），不再用 OpenAI `tool_calls` 数组作为引擎内部形状。
- **toolResult** 角色独立（`toolCallId`, `toolName`, `content[]`, `isError`, `timestamp`）。
- 跨 provider 调用前由 api 实现做 **convert/handoff**（干净室实现；语义对齐 pi README「Cross-Provider Handoffs」）。

IM 多模态：入站 `ContentPart` 在 turn 边界转为 `{ type: 'image', data, mimeType }`。

群聊 user 消息：写入 `agent_messages.payload` 前仍经 [`formatUserContentForSession`](../../packages/im/agent/src/zhin-agent/session-io.ts) 加 `[sender:id=… name=… roles=…]` 前缀，并剥离用户伪造前缀（Grill #11）。

### D3. `agentLoop` + `Agent` 分层

```
packages/im/ai/src/agent/
  agent-loop.ts    # agentLoop(prompts, context, config) → AsyncIterable<AgentEvent>
  agent.ts         # class Agent { prompt, continue, subscribe, steer, followUp, abort }
  tool-executor.ts # parallel | sequential；validateToolCall；policy denial
```

`AgentLoopConfig` 钩子（对齐 pi）：

- `convertToLlm(messages)` — 默认过滤非 LLM 消息
- `transformContext(messages, signal)` — compaction / 剪枝（Grill #14：移植现有 compaction 模块）
- `beforeToolCall` / `afterToolCall`
- `toolExecution: 'parallel' | 'sequential'`
- `getApiKey(provider)` — 动态 key
- `getSteeringMessages` / `getFollowUpMessages` — steer/followUp 队列 drain

**统一全部 LLM 路径**（Grill #4、#8、#16）：

| 原路径 | 新路径 |
|--------|--------|
| agent 路径 `llmAgent.run()` | `Agent.prompt()` → `agentLoop` |
| chat/fast `llm-runner` → `provider.chatStream` | `agentLoop` + `maxIterations=1` + `tools=[]` |
| pre-exec-fast-path | preExecutable 工具 turn 前并行预跑 → 注入 `systemPrompt`/`transformContext` → **同一 agentLoop** |
| subagent / deferred-worker | `agentLoop` 或 `Agent.prompt` |

删除：`Agent.run`, `Agent.runStream`, `createAgent().run`, [`llm-runner.ts`](../../packages/im/agent/src/zhin-agent/llm-runner.ts) 直连 provider 的逻辑。

**模型路由**（Grill #10、#20）：

- **删除 `chatLiteModel`**：无工具 turn 也用主模型（binding / default model）。
- **保留 `visionModel`**：入站含 image content block 时路由到 vision 专用 model（若已配置）。

### D4. Memory 全量重置（不迁移旧数据）

旧表 **`chat_messages` / `ai_messages` / `ai_summaries` / `ai_sessions`** 不再读写；migration **仅 CREATE** 新表，**不自动 DROP** 旧表（Grill #9：用户删库重建；旧表成为 dead weight，可自行清理）。

新表（命名可在实现 PR 中微调，语义如下）：

#### `im_transcripts`（IM 旁听 / 审计 / chat_history 检索）

替代原 `chat_messages` 的 **扁平静态** 职责；仍由 `message.receive` / `Adapter.sendMessage` 成功后写入。

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | integer PK | |
| `message_id` | text | 平台消息 id |
| `platform` | text | |
| `endpoint_id` | text | |
| `scene_id` | text | |
| `scene_type` | text | private/group/channel |
| `sender_id` | text | |
| `sender_name` | text | |
| `sender_role` | text | |
| `direction` | text | inbound \| outbound |
| `body` | text | **纯文本**（`extractTextContent` / 等价逻辑；供 `chat_history` 关键词检索） |
| `media_json` | text | 可空；**`MessageElement[]` 的 JSON.stringify**（Grill #17；与 `Message.$content` 同形） |
| `time` | integer | ms |

写入规则（替代 [`register-chat-message-store.ts`](../../packages/im/zhin/src/setup/register-chat-message-store.ts)）：

- `body` ← 纯文本提取（无文本但有 media 时 `body` 可为空字符串，**仍落库**）
- `media_json` ← `JSON.stringify(Message.$content)`（审计/回放用，不再混进 `body`）
- 入站过滤：无 text 且无 media 则 skip（对齐现逻辑）

`chat_history` 工具：**只读** `im_transcripts.body` 做关键词检索；需要媒体细节时可读 `media_json`（v1 可不暴露给模型，仅审计）。

#### `agent_sessions`

| 列 | 类型 | 说明 |
|----|------|------|
| `session_id` | text PK | `{session_key}#{epoch}` |
| `session_key` | text | `platform:endpointId:scope:sceneId` |
| `platform` / `endpoint_id` / `scene_id` / `scene_type` | text | |
| `model` | text | 最近使用模型 |
| `status` | text | active \| archived |
| `created_at` / `updated_at` | integer | |

#### `agent_messages`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | integer PK | |
| `session_id` | text FK | |
| `role` | text | user \| assistant \| toolResult |
| `payload` | text | **JSON**：完整 pi `AgentMessage`（含 content blocks） |
| `timestamp` | integer | |

索引：`(session_id, timestamp)`。

#### `agent_summaries`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | integer PK | |
| `session_id` | text | |
| `summary` | text | |
| `anchor_message_id` | integer | 可选 |
| `created_at` | integer | |

新 **`ContextRepository`**（`packages/im/ai/src/memory/context-repository.ts`）：

- `loadContext(sessionId): Promise<Context>` — **epoch-only**（Grill #15）：只读当前 `session_id` 的 summaries + tail messages；**不**从 `im_transcripts` 冷启动；与现 CHC 按 scene 冷启动行为不同，属 intentional break
- `appendMessages(sessionId, messages[])` — turn 结束 commit
- `archiveSession(sessionKey)` — `/reset` 等价

删除或 stub：`ConversationMemory`、`ChatHistoryContext`、`SessionManager` 持久化路径、`ContextManager` 双写 LLM 历史逻辑。

### D5. TypeBox 工具链

- 依赖：`typebox`（`@zhin.js/ai` 导出 `Type`, `Static`, `TSchema`）。
- 引擎 **`Tool`**：`{ name, description, parameters: TSchema }`。
- **`validateToolCall(tools, toolCall)`** — 失败抛错，agentLoop 转为 `isError: true` 的 toolResult 还模型。
- **`*.tool.md`**：Phase 1 在加载时用 **JSON Schema → TypeBox 子集转换器**（现有 frontmatter `parameters` 不动）；**不支持的 schema 特性 → 启动 hard fail**（Grill #18）。
- **`ZhinTool`**：builder 改为 `Type.Object(...)`；`toAgentTool()` 唯一出口。
- **IM 扩展**（platforms/scopes/roles）：`ImTool` = `AgentTool & { platforms?, scopes?, requiredAnyRole? }`；`normalizeTool()` 一次转换进 loop。

### D6. ZhinAgent 对外 API

新增（对齐 pi `Agent` 语义）：

```typescript
class ZhinAgent {
  prompt(text: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void>
  continue(): Promise<void>
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void
  abort(): void
  waitForIdle(): Promise<void>
  steer(message: AgentMessage): void      // 工具执行中注入 user 消息
  followUp(message: AgentMessage): void    // agent 将停时排队续聊
  clearSteeringQueue(): void
  clearFollowUpQueue(): void
}
```

- `steer` / `followUp` **首版即暴露**（Grill #2）；内部委托 `agentLoop` 的 `getSteeringMessages` / `getFollowUpMessages`。
- `processTextTurn` / `processMultimodalTurn` → **thin wrapper**：组装 IM `ToolContext`、MCP、路由后调用 `prompt()`。
- 现有 Plugin 事件（`ai.agent.start`、`ai.thinking` 等）由 `subscribe` 内部桥接，避免双套事件。

**IM 层约束**（Grill #7、#12、#13、#19）：

| 约束 | 规则 |
|------|------|
| steer/followUp 权限 | **仅 master**（`bots[].$config.master` 或 trigger masters） |
| 并发入站 | 同 `sessionKey` **并行 turn**；每条入站 @ 独立 `schedule()`；`ContextRepository` 写入 **per-session 锁** 串行化 |
| QueueMode | `ai.agent.steeringMode` / `followUpMode` 可配置（`'one-at-a-time' \| 'all'`），**默认 `one-at-a-time`**；master **`steer()`** 注入该 session **最新 active turn** |
| 多 session 状态 | **单 inner Agent**；DB 为唯一真相；每 turn 前 `loadContext(sessionId)` 快照，turn 结束 `appendMessages`（加锁） |
| deferred worker | `run_deferred_task` **异步委派**；主 turn 立即返回 `delegated`，结果 **单独出站** |

IM 特有逻辑保留在 agent 包，注入 loop 钩子：

| 逻辑 | 注入点 |
|------|--------|
| exec/file policy | `beforeToolCall` |
| Owner 硬编排 | `beforeToolCall` + `afterToolCall` |
| MCP lazy connect | turn 前 `transformContext` 或 ZhinAgent `prepareTools` |
| model harness / fallback | `stream` 层或 loop 内 `resolveModelCandidates` |
| session_key / session_id | turn 前 `ContextRepository` + `IMSessionStore` 合并为 `agent_sessions` |
| preExecutable 工具 | turn 前并行预跑 → 注入 context → agentLoop |

### D7. 图片生成（独立 API）

- **不并入** chat 的 `stream/complete`（Grill #3；对齐 pi `getImageModel` + `generateImages`）。
- 新公开 API：`getImageModel(providerAlias, modelId)`、`generateImages(model, input, options?)`。
- 现有 `generate_image` builtin tool 内部调用 `generateImages`；删除 Provider 类上的 `generateImage()` 方法，改为 api 实现模块。
- Chat 多模态（vision）仍走 `Context` 的 `{ type: 'image', data, mimeType }` content block。

### D8. 实现方式：干净室重写

- **不** vendoring pi 源码；**不** npm 依赖 `@earendil-works/pi-ai`。
- 接口与事件命名对齐 pi，便于对照文档与测试思路。
- 单 PR 合并，commit 建议顺序：types → api-registry → stream → agentLoop → memory → compaction → agent 包 → config break → test-bot。

## 后果

### 正面

- 一条 LLM 路径，删除 `run/runStream` 重复与 `llm-runner` / pre-exec-fast-path 分叉。
- Context 可序列化、可测、可跨 model 切换。
- Provider 扩展改为注册 api + yaml compat，减少 class 爆炸。
- TypeBox 校验统一，减少工具参数 silent failure。

### 负面 / 风险

- **Major break**：所有直接 import `AIProvider` / `ChatMessage` / `Agent.run` / `driver` / `chatLiteModel` 的插件与示例必须改。
- **历史对话丢失**：不迁移旧 DB；用户需删库重建（文档与 CHANGELOG 明确）。
- **epoch-only LLM 历史**：`/reset` 后 LLM 上下文为零；旁听检索仍走 `im_transcripts` + `chat_history` 工具，不自动灌 context。
- **单 PR 体积大**：必须先合本 ADR，PR 按 commit 分块 review。
- **`*.tool.md` 转换器**：JSON Schema 全特性无法 100% 映射 TypeBox；不支持的 frontmatter 在加载时报错。

## 完成定义

- [ ] `pnpm build` && `pnpm test` 全绿
- [ ] [`examples/test-bot`](https://github.com/zhinjs/zhin/tree/main/examples/test-bot)：@ agent 路径、无工具单轮、subagent、MCP、vision、`/models` introspection、session 归档、steer 非 master 拒绝
- [ ] 仓库内无生产代码引用 `AIProvider`、`ChatCompletionRequest`、`Agent.run`、`chatLiteModel`
- [ ] [`docs/advanced/ai.md`](../advanced/ai.md) 重写 Context/stream/agentLoop 章节
- [ ] Changeset：major bump `@zhin.js/ai`、`@zhin.js/agent`

## 与现有 ADR 的关系

| ADR | 关系 |
|-----|------|
| 0002 | IM 入站仍经 MessageDispatcher；`im_transcripts` 在 dispatch 后写入，Assistant Runtime 不插入管线 |
| 0003 | 工具选择与 context budget 仍 centralized；消费改为 `Context` + `transformContext` |
| 0007 | `modelHarness` 仍作用于 loop 的 `maxIterations` 等；配置键保留 |
| 0008 | Job 执行仍可调 ZhinAgent；ZhinAgent 内部 API 变 `prompt()`，Job 侧无破坏性 |
| 0010 | 本 ADR 的 Harness 延伸：compaction 接线（#14 落地）、会话树、Skills/Packages — 见 [0010](./0010-pi-coding-agent-harness-alignment.md) |

## 已定稿决策（Grill 2026-06-05，#1–#21）

| # | 问题 | 决定 |
|---|------|------|
| 1 | `im_transcripts` 富媒体 | **`body` 纯文本 + `media_json` 结构化**；`chat_history` 检索 `body` |
| 2 | steer / followUp | **首版 ZhinAgent 全暴露**（`steer`/`followUp`/clear 队列） |
| 3 | 图片生成 | **独立 `generateImages` API**，不并入 chat stream |
| 4 | 无工具 LLM 路径 | **一律 `agentLoop`，`maxIterations=1`** |
| 5 | epoch 历史边界 | **epoch-only**：只读当前 `session_id` 的 `agent_messages` |
| 6 | `media_json` 形状 | **`MessageElement[]` JSON**（与 `$content` 同形） |
| 7 | steer 权限 | **仅 master** |
| 8 | pre-exec-fast-path | **删除独立 fast 分支**；preExecutable 预跑 → 注入 context → 同一 agentLoop |
| 9 | 旧表处理 | migration **仅 CREATE** 新表；用户删库重建；不 auto DROP |
| 10 | chatLiteModel | **删除**；无工具也用主模型 |
| 11 | 群聊 sender | **保留** `formatUserContentForSession` 前缀写入 user payload |
| 12 | 并发入站 | 同 sessionKey **并行 turn** + session 写入锁；入站不再 **`followUp()`** 合并 |
| 13 | QueueMode | **`ai.agent.steeringMode` / `followUpMode` 可配置**，默认 `one-at-a-time` |
| 14 | compaction | **移植**到 `transformContext`（AgentMessage + `completeSimple`） |
| 15 | epoch 历史 | 同 #5 |
| 16 | 无工具路径 | 同 #4 |
| 17 | media_json | 同 #6 |
| 18 | tool.md 转换失败 | **启动 hard fail** |
| 19 | 多 session 状态 | **单 inner Agent**；DB 为真相；turn 前 load / 结束 append |
| 20 | vision 路由 | **保留 `visionModel`**；有 image block 时切换 |
| 21 | provider 配置 | **`api` 必填，删除 `driver`** |

## 状态

- **提议日期**：2026-06-05
- **Grill 定稿**：2026-06-05（#1–#21）
- **状态**：已接受，**主路径已实现**（ZhinAgent + 子 agent + deferred worker + AIService → agentLoop）

## 完成定义（进度）

- [x] `pnpm test` 全绿（agent + ai 包，1265+ cases）
- [x] ZhinAgent 单一路径：`promptController` → `runAgentLoopTextTurn` / `runAgentLoopVisionTurn`
- [x] `im_transcripts` 写入 + `chat_history` 读新表
- [x] 停注册 legacy `chat_messages` / `ai_sessions` / `ai_summaries`
- [x] [`docs/advanced/ai.md`](../advanced/ai.md) Context / agentLoop 章节已同步
- [x] 子 agent / deferred worker 迁入 agentLoop（`runAgentLoopStandaloneTurn`）
- [x] 仓库内无生产代码引用 legacy `Agent.run`（`@zhin.js/ai` 的 `Agent` 类仍保留供单测与直接 import）
- [x] 架构文档与 README 同步 agentLoop 统一路径（`architecture-overview`、`agent-concepts`、`ai.md`、包 README）
- [ ] Changeset：major bump `@zhin.js/ai`、`@zhin.js/agent`
