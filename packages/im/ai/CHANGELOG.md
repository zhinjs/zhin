# @zhin.js/ai

## 1.1.44

### Patch Changes

- f98025b: 自动输出统一的每轮 Agent 用量汇总，DEBUG 展示模型调用与首请求上下文预算。沿用 TurnTrace 汇总主回合及子回合，传递缓存写入、模型身份和用量可用性；未知或部分数据明确标记，日志不包含消息、提示词或工具内容。
- 9e21404: Ambient engagement no longer goes silent mid-conversation. After the bot speaks, the group is in a conversation with it for `conversationWindowMs` (default 3 minutes): members replying to it are answered whenever the judge agrees, without the interjection cooldown or hourly cap (a 30-per-hour safety ceiling remains). `cooldownMs` and `maxPerHour` now limit only unprompted interjections, and the judge is told when the bot is in a conversation and which lines are its own.
- de39053: Spare the ambient judge's quota: `judge` accepts a list of models tried in order when one fails or is rate limited (a failed one is passed over for a minute), an idle group is judged at most once per `judgeIntervalMs` (default 30 s), and chat lines sent to the judge are trimmed to 200 characters.
- 250b026: 补齐上下文压缩中的工具参数、思考和媒体估算，以及已披露工具输入与结构化输出 Schema 的固定预算。小窗口按可用预算收紧近期原文保留量，继续保留最少消息数与工具调用配对。拒绝截断、失败、取消、请求工具、空白或未节省 token 的摘要，避免错误摘要写入历史；无可压缩前缀时不再报告摘要成功。

  摘要检查点改为绑定实际被压缩的已持久化前缀，修复当前回合未落库时的锚点错位；对来源不明、并发变更或等待写锁期间取消的结果跳过保存，原始记录不删除。

- bff8e31: Ask DeepSeek for structured replies by instruction instead of JSON mode. Its thinking models in `response_format: json_object` mode often thought and then returned only whitespace (4 of 8 chat replies failed with "Model did not produce the requested structured output"); with the schema in the system prompt and lenient decoding of the answer, 12 of 12 succeeded. `compat.structuredOutput: native | prompt` overrides the default on any provider.
- bf0fa9f: Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
- 3326db3: 减少已加载 Skill、工作区规则和工具参数 Schema 的重复上下文；保留原始记录、更新版本和压缩检查点。合并等价消息输出 Schema，稳定请求前缀与工具顺序，并沿现有开关扩展 Anthropic 历史缓存标记。上下文追踪包含输出 Schema 和去重后的消息估算。
- 6da2bad: 新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

## 1.1.43

### Patch Changes

- 974fa85: Add ambient group engagement (`ai.trigger.ambient`): for a group message nobody addressed, wait for the burst to settle, apply a per-group cooldown and hourly cap, and let a judge model decide whether the bot would naturally chime in. Engaged turns tell the Agent nobody called it, so it can still return no messages. Mentions, quotes and DMs are unchanged and always reach the Agent. Off unless groups are listed; `mode: shadow` logs judgments without replying.
- d9cc732: Accept structured replies that miss the strict format instead of failing the turn: a JSON object wrapped in a sentence or code fence, or with a bracket too many or too few, is repaired and still validated against the schema; a plain prose answer is sent as one text message. MiniMax often writes the structured answer as text, and these cases used to reach users as "Model did not produce the requested structured output".

## 1.1.42

### Patch Changes

- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

## 1.1.41

### Patch Changes

- d033076: 修复 MiniMax 结构化回复的 JSON 文本被 SDK 丢弃后误解析 thinking 的问题。保留完整 JSON 文本并继续严格校验；格式错误最多进行一次无历史、无业务工具的纠正，失败时返回固定提示，不重跑工具或放宽消息契约。

## 1.1.40

### Patch Changes

- dd7f25f: Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。

## 1.1.39

### Patch Changes

- a64716a: IM 回合的出网权限改为独立开关 `ai.agent.network`（`enabled`、`allowedDomains`），默认关闭；未设置 `enabled` 时仍兼容 `execPreset: network`。没有出网权限的回合不再向模型提供 `web_fetch` / `web_search`，并在提示词里写明真正的开启方式；拒绝信息也带上同样的修复说明，模型不再编造开关位置。
- 75e26a6: The Groq gateway preset now uses the same detector as the Groq request fixes: alias `groq` / `groqcloud`, or a `baseUrl` whose hostname is exactly `api.groq.com`. Before, the preset matched any `baseUrl` containing `api.groq.com`, so a lookalike host such as `api.groq.com.evil.example` got the preset's sdk coercion but not the request fixes.
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- cc9959e: 新增插件用的纯文本补全 `aiCompletionToken`（`zhin.js/agent` / `@zhin.js/agent/runtime`）：`completeText()` 只做一次补全、不带任何工具，复用 provider 的重试、超时和同 provider 模型降级；`untrusted` 内容按数据块渲染且不能提前闭合；传 `onBehalfOf` 时计入用量配额。`AIProvider` 新增可选的 `completeTextResult()`，返回实际作答的模型与用量。

  **行为变化**：`AIService.createAgent()` / `runAgent()` 默认不再带 `registerTool()` 注册的工具（`includeRegisteredTools` 默认改为 `false`）；需要时显式传 `includeRegisteredTools: true`。

- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [fdc2148]
  - @zhin.js/logger@1.1.2

## 1.1.38

### Patch Changes

- c829031: feat(agent): 长对话压缩、已告知账本与缓存友好的提示词顺序（#730）。
  - 自动压缩改为在消息达到 `contextWindow × thresholdRatio`（新配置 `ai.agent.compaction.thresholdRatio`，默认 0.7）减去系统提示和工具定义占用时触发，插件运行时会话同样生效；以前要接近“窗口减 13k”才触发。
  - 压缩摘要会保留已告知用户的结论和承诺。
  - 新增按会话的“已告知”账本，最终回复和进度汇报共用：下一轮以 `[Already told the user]` 短块提供给模型，自动去重，最多 8 条。
  - git 状态移到系统提示最后一段，便于缓存稳定前缀。
  - 回合追踪记录 provider 返回的缓存命中 token。
- 0c17e0b: feat(agent): 上下文量化与按需披露（#729）。每轮第一次模型请求的上下文开销按段估算（系统提示、工具 schema、按需工具索引、技能目录、专家 agent 目录、已加载技能、记忆、bootstrap、历史、本轮输入），写入回合追踪的 `context_budget`，`zhin trace last` 可见。插件运行时的技能目录和专家 agent 目录改为只列名称加一行说明（最多 96 字符、40 条），技能正文在 `load_skill` 后才注入；未常驻的工具在系统提示 `## Deferred tools` 段列出名称和短说明（只含本回合有权使用的工具）。修复 `load_tool` / `load_skill` 之后模型直接给出文字回复时，agent loop 仍多发一次模型请求的问题。
- bf52b40: fix(agent): read_file / list_dir / glob / grep / edit_file / write_file 默认常驻加载（仍受本轮工具过滤与 exec 策略约束），常驻工具不再写入会话快照，不占 `maxLoadedPerSession` 名额也不会被挤出。模型直接调用本轮目录中的延迟工具时自动加载并执行，审批与权限检查照常生效；不在目录中的名字仍按未知工具拒绝，并提示使用 discover / load_tool。
- 55811d1: Provider resilience gate cases for model fallback and request timeouts (#724). The eval scripted model can register several candidate models and records the model id of each request; a `hang` fault step drives a virtual clock so timeout cases never wait in real time. The provider request timeout now accepts injected timers (`ProviderTimers`).
- bf52b40: 修复 IM 会话事件背景污染当前回复：机器人撤回自己发出的消息（如活动指示「正在处理中...」的 autoRemove）不再进入下一轮的会话事件上下文；超过 30 分钟的积压消息不再注入；事件块明确标注为背景、不要直接回答，并提示下一条用户消息才是需要回复的当前消息。
- bf52b40: 新增探索纪律 harness：model harness 支持 `explorationBudget`（连续只读探索调用达到次数后在工具结果中注入提示，默认 8，0 关闭）与 `explorationGuidance`（系统提示加入"先规划、限定目标文件"）；内置 MiniMax M 系列预设（explorationBudget 5，开启 guidance，不改 maxIterations），均可通过 `ai.agent.modelHarness` 覆盖。
- bf52b40: fix(agent): 本轮策略无法执行 Shell 时不再向模型提供 bash（工具列表与目录同时过滤，load_tool 也无法再加载），万一触发会返回明确、不可重试的错误。新增 `ai.agent.masterShell`（默认 `off`）：设为 `isolated` 时，仅 IM 私聊中的 master 可在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、白名单外命令需审批），宿主无 Docker 时直接失败、不降级到宿主机。
- fc75499: feat(agent): injection guard, outbound leak check and usage quotas (#727). Once external content (tool results, web pages, files, sub-agent reports, background group events) has entered a turn, shell commands, messages to other conversations, config changes and scheduled tasks always go through the ApprovalPort, with the source chain on the approval card; unattended turns deny them (`ai.agent.injectionGuard.confirmHighRisk`, default on). Replies, progress updates and outbound tool messages now mask verbatim system-prompt lines, secrets and other sessions' memory before delivery (`ai.agent.injectionGuard.outboundCheck`, default on). New `ai.agent.usageQuota` adds per-user / per-group token quotas and a per-group rate limit, all off by default, owner exempt.
- 2a9d08b: Semantic memory gets a data model and write policy (#733). Entries now carry `kind` (user_fact / preference / task_state / episodic), the writing turn and its trust level, `last_used_at` and a bounded version history; existing `memory_entries` tables gain the new columns at startup without losing rows. `memory_upsert` attributes writes to the turn (the model can no longer set `source`), keeps group members out of global/platform memory and away from facts written at a higher trust level, defaults group-member writes to their own `user` scope, and gives `task_state` a bounded expiry that can be tied to a task.
- e4fbfb2: Semantic memory retrieval uses BM25 (#734). `memory_search` ranks with BM25 (word tokens plus CJK bigrams), and each turn now recalls the top-k entries relevant to the current message from the initiator's visible scopes into the turn context, bounded by `ai.memory.semantic.recall` (`topK` 5, `maxTokens` 400 by default), so memory cost per turn no longer grows with the number of entries. Users can view and forget memory about themselves with `/memory` and `/forget`; `SemanticMemoryRuntime` gains `list` / `delete` for management surfaces.
- 56bafda: feat(agent): 多模态感知预处理 `ai.multimodal.perception`。主模型收不了的图片 / 视频 / PDF，由配置的感知模型（如 Gemini Flash-Lite）经 provider 韧性层描述后，以 `[图片描述]` 等不可信外部内容注入，并写入会话历史；按字节 sha256 缓存，每回合有上限，失败回到原占位。描述会让回合进入“已接触外部内容”状态（高危动作需审批），`media_resolution` 事件带上来源模型。不配置时行为不变；配置错误时启动失败，`zhin config check` 同样报错。

  fix(agent): 模型 fallback 跳过不支持本回合媒体类型的候选（已接收的图片不会在 fallback 时悄悄变成占位）；带图片的回合仍以绑定的模型（`ai.agents.<name>.model`）为第一候选。

  deprecate（仍兼容，下一个 minor 移除）：

  - `ai.agents.<name>.priority` / `match`（含 `hasMedia` 等全部条件）从未生效：IM 消息总是交给 `ai.agents.zhin`。仍接受，启动时告警，不再因此校验报错；`zhin config check` 报 `ai.agent_routing_deprecated`，`--fix` 自动删除。`ai.routes` 的 `--fix` 改为直接删除。删除未导出的 `routing/route-matcher` / `match-rules`；`RouteMatchConfig` 与相关字段标记 `@deprecated`。
  - `ZhinAgentConfig.visionModel`（仅代码可设置的残留）：仍作为图片回合的后备候选，设置时告警。
  - `AgentCore.runVision` / `runVisionTurn`、`runAgentLoopVisionTurn` / `runAgentLoopVisionTurnRun` 及其类型：无生产调用方，标记 `@deprecated`。

- 7d2263c: Progress-aware tool-call budget (`ai.agent.toolBudget`): `maxIterations` becomes a soft budget extended while the turn makes progress (not when looping or failing), with hard step/wall-clock/token caps, opt-out automatic in-turn continuation (default: master private chat), throttled natural-language progress updates (default: private chats), and the exploration budget resetting on the same progress signal. Sub-agents use the same budget with a lower hard cap and no continuation.
- 27da0e8: Provider resilience for agent turns: classify provider errors (rate limit, timeout, 5xx, network, empty reply, malformed tool call), retry with exponential backoff honouring Retry-After, per-request timeout, fallback across `modelCandidates`, and per-model quirk presets (`emptyReplyRetries`, `requestTimeoutMs`; MiniMax M-series re-asks once on an empty reply). Configured via `ai.agent.providerResilience` with conservative defaults.
- 7d2263c: Add opt-in in-turn sub-agents (`ai.agent.subagentTurnMode: sync`) on the plugin-runtime turn path. Sub-agents inherit the parent turn policy, never wider (no bash unless the parent can run it); approvals go to the parent conversation and requester. DeferredWorkerRunner now offers no bash unless given a frozen turn policy snapshot.
- d91d21a: feat(agent): trust tiers and initiator binding (#726). Each turn now has an initiator trust level (owner / trusted_member / group_member), and its authority is that level's ceiling intersected with the configured policy. This replaces the #719 group-member special case; group-member turns keep the same restrictions, but denials now report the `trust-level` policy. Sub-agent reports, third-party plugin prompt sections, skill instructions and background group events are rendered as labelled `external_content`, and traces record the initiator trust level.
- a62acca: Ordinary IM turns now have a clear policy for messages that arrive while a turn is running (#725). A sender's follow-up replaces their own unanswered turn and is answered together with the earlier text, or merges into their queued turn. Other members' messages always queue and never interrupt or merge into someone else's turn. The initiator or master can stop a turn with `取消` / `cancel`. Queues are bounded by the new `ai.agent.inboundQueue.maxQueuedTurns` (default 5) and `ttlMs`, and queue waits and merges are recorded on the TurnTrace.
- 9ab9ffb: fix(ai): `completeText`（压缩、上下文摘要、子 agent 摘要）与主对话路径对齐。
  - 经现有 provider 韧性层（`createResilientCompletionPort`）做错误分类、退避重试、单次超时（默认 180s）和同 provider 模型 fallback；SDK 自带重试置 0，避免重试叠加。
  - `TextCompleteOptions` 新增 `signal`、`timeoutMs`、`fallbackModels`、`resilience`；压缩与摘要调用方在有取消信号时透传，取消不再走降级摘要，也不计入自动压缩熔断。
  - 只返回正文，绝不把模型的 thinking 当摘要；内容安全 / 长度失败抛出 `CompletionFailureError`（消息即面向用户的说明）。
  - 未指定模型时优先使用 provider 配置的 `defaultModel`。
- 1280631: Gemini provider fixes (#769). Gemini chat models now default to multimodal input, and images go out as typed file parts. Gemini 3 function-call thought signatures round-trip. SAFETY, RECITATION and blocked-prompt refusals, empty MAX_TOKENS replies and MALFORMED_FUNCTION_CALL now show up as visible errors instead of empty replies. Gemini `RetryInfo.retryDelay`, `API_KEY_INVALID` and RPC statuses feed retry classification. A new provider-config `providerOptions` field carries `safetySettings` and `thinkingConfig`, and opt-in `contextCache: { mode: 'explicit' }` adds explicit Gemini `cachedContents` with TTL refresh and invalidation. The nightly real-model evals now run on Gemini (`GEMINI_API_KEY`), with new multimodal eval cases.
- bd78a94: Gemini coverage for the provider resilience layer (#724). Gemini safety blocks (SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, IMAGE_SAFETY, RECITATION and blocked prompts) now get a polite refusal and are never retried or sent to a fallback model. A per-day Gemini quota (`QuotaFailure` `PerDay`) skips retries and falls back to the next candidate model. 504 `DEADLINE_EXCEEDED` is reported as a timeout. A new Gemini model-harness preset re-asks an empty reply or a `MALFORMED_FUNCTION_CALL` once on the same model. The nightly capability matrix gets a multimodal column, and `NIGHTLY_PROVIDER=minimax` keeps MiniMax available next to the Gemini default.
- acfaaef: Groq gateway preset for `sdk: openai-compatible` (alias `groq` / `groqcloud`, or a `baseUrl` on `api.groq.com`). Earlier reasoning is replayed as `reasoning` instead of `reasoning_content`, which Groq rejects with a 400 on the second step of every tool loop. `logprobs`, `top_logprobs`, `logit_bias` and `n` > 1 are never sent. `reasoning_effort` only goes to GPT-OSS / Qwen 3, and GPT-OSS defaults to `low` (override with `thinkingLevel`). GPT-OSS is text-only and Llama 4 Scout / Maverick take images. gpt-oss models get a 131072-token context window. A 429 on a per-day window (Groq RPD / TPD) is `quota_exhausted` and falls back without retrying, while per-minute 429s are retried after `retry-after`.
- 57ea5f7: Provider config fixes. Provider `timeout` and `maxRetries` now take effect: they override `ai.providerResilience` for that provider, below per-model harness settings. New opt-in `firstChunkTimeoutMs` / `chunkTimeoutMs` abort streams that connect but go silent, and the stall is retried and failed over like any timeout. `authScheme` now works for every scheme (`Token`, `Bearer`, `''`) on chat requests and model discovery alike. The `sdk: openai` `baseUrl` gets `/v1` on a bare proxy root, like the other OpenAI-protocol providers; `compat.appendV1: false` keeps the old as-written behaviour. `compat.supportsDeveloperRole: false` sends `system` instead of `developer` to reasoning models. OpenAI refusals now surface as a content-policy message instead of an empty reply. MiniMax `baseUrl` values ending in `/anthropic` or naming only a host are completed to `/anthropic/v1`, and `@ai-sdk/minimax` is declared as an optional peer dependency. `compat.supportsReasoningContent` and `compat.toolCallsInAssistant` are deprecated no-ops, and gateway presets no longer set them.
- 6e035e5: Provider fixes from the #736 audit (PR C):

  - Tool JSON Schemas go to every provider as written. `enum`, `const`, `anyOf`/`oneOf`, nullable types, `integer`, `format` and bounds are kept, and tool-call arguments are validated against the same constraints. Gemini gets a `string` type on untyped fields.
  - `thinkingLevel` (provider config, or per call) is sent as the AI SDK `reasoning` option. A thinking setting in `providerOptions` wins, and MiniMax keeps adaptive thinking. New `maxOutputTokens` provider option (default 8192).
  - Assistant turns are stored and replayed thinking-first, so a turn with Anthropic thinking + text + tool_use stays valid. Gemini `thoughtSignature` on thought and text parts round-trips.
  - OpenAI GPT-4o and later, the o1/o3/o4-mini models, and Claude 3+ models default to image input.

- 57ea5f7: openai-compatible / Ollama transport fixes. Streamed requests now ask for usage (`stream_options.include_usage`), so gateways and Ollama report token counts again (opt out with `compat.includeUsage: false`). `baseUrl` no longer gets `/v1` forced onto a path that already names an API version (`/api/v3`, `/api/paas/v4`, `/v1beta/openai`) or ends in `/openai`; bare hosts still get `/v1`, and `compat.appendV1` forces either behaviour. Image generation and model discovery use the same base URL as chat. Ollama now plans for `OLLAMA_CONTEXT_LENGTH` or 4096 tokens instead of 128k unless `contextWindow` is set, and startup warns when it is missing. The OpenAI prompt-cache key is no longer emitted under a key openai-compatible ignores; `compat.promptCacheKey: true` sends `prompt_cache_key` as a body field.
- 55db42d: Provider error handling fixes from the provider audit (#724). Error parts inside a 200 stream (Anthropic `overloaded_error`, OpenAI `server_error`, Responses `rate_limit_exceeded`) keep their message, type and code instead of becoming "[object Object]", so they are retried and re-routed like the HTTP error they stand for. One shared context-overflow detector now serves both the resilience layer and compaction, and recognises the Gemini, Vertex and Anthropic wordings. A DeepSeek `insufficient_system_resource` finish is retried rather than reported as a malformed tool call. OpenAI's `retry-after-ms` header is honoured. Out-of-credit errors (402, OpenAI `insufficient_quota`, "credit balance is too low", "Insufficient Balance") are no longer retried, skip fallback candidates on the same provider alias (same key, same account), and tell the user the balance ran out. Tool-call arguments that are not valid JSON keep their raw text, and validation quotes it back to the model instead of reporting missing fields against `{}`.
- f48ba72: `deferredTools.alwaysLoadedTools` now extends the default resident tools (`ask_user`, `spawn_task`, `discover`, `load_tool`, `load_skill`) instead of replacing them, so an override no longer hides `discover`/`load_tool`. Set `deferredTools.alwaysLoadedMode: 'replace'` to restore the previous replace behaviour.
- 3237f63: test(ai): Gemini `baseUrl` for a pass-through proxy is covered end to end (generateContent, streamGenerateContent, cachedContents create/delete, model list; optional `headers` on every request); docs for zh/en; nightly evals read the `GEMINI_BASE_URL` repository variable.
- 8e26cf1: 配置面收敛（#735）：弃用运行时未读取的 `ai.agent.maxSkills`、`policyDenialStopAfter`、`deferredToolMaxResults`、`taskExecApprovalMode`（启动告警，`zhin config check --fix` 可移除），新增《默认行为规范》权威文档与开关清单门禁。
- 9891e66: 入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

  - 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
  - self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
  - `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
  - `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
  - 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。

## 1.1.37

### Patch Changes

- b36452a: Add an optional TypeSafe AI Jev structured-decision provider with typed Choice, Score and Noul results, bounded cancellation-aware requests, response validation, and generation-owned cleanup. Add explicit TypeSafe setup and local doctor checks; preserve chat configuration, store credentials as environment references, and begin recommendation in shadow mode.

## 1.1.36

### Patch Changes

- b9b3953: Serialize first active-session creation by session key within each repository instance, preventing concurrent opens from returning separate epochs. Keep different keys independent and release the key after storage failures so retries can recover.
- b9b3953: 修复框架生命周期与消息处理的竞态：HMR 停止等待异步 watcher 清理，并在清理失败时仍等待在途 reload；命令前缀通过端点能力所属插件读取配置，前导空白不再丢失结构化参数；工具在异步策略检查后再次检查取消信号；文件缓存遇到超限替换时删除旧内容并保持字节计数一致。

## 1.1.35

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- 95b24d4: Skip unsupported directory handle flushes on Windows while retaining file flushes and POSIX directory durability, and prevent Agent message persistence from issuing a second insert when a SQL dialect does not return an inserted id.

## 1.1.34

### Patch Changes

- 1414ccb: Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- 1fa1c09: Replace the process-wide proxy URL and fetch cache with provider-owned `AiHttpTransport` instances. Model discovery, text generation, image generation, and generated-image downloads now use the owning provider's transport, and disposing `AIService` waits for proxy agents to close.
- 75920c4: Replace the process-global LLM provider, transport, live-model resolver, and language-model caches with owner-scoped `LlmApiRuntime` instances. Agent loops and compaction now require an explicit completion port; AIService, ZhinAgent, subagents, deferred workers, and the CLI composition root retain and inject their own runtime. Remove the global registration, lookup, resolver, cache-reset, and test-reset APIs.
- cd4f240: Replace the detached class-based `knowledge_search` implementation with a generation-owned Tool Feature backed by the explicit `KnowledgeIndex` contract and encapsulated `MarkdownKnowledgeIndex`. The CLI publishes it to main and subagent turns only when `ai.knowledge.baseDir` is explicitly configured inside the project root. Knowledge indexing is bounded, abort-aware, deterministic, and shared by both execution paths.
- 4bc3d3c: Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
- 77d5a46: Remove the retired `tool_search` and `run_deferred_task` orchestration protocol from the Agent and CLI. `discover`, `load_tool`, and `spawn_task` are now the only documented and executable orchestration vocabulary; obsolete config migration, result formatting, prompt redaction, reserved names, subagent filtering, and the detached class-based tool are removed. Config repair now preserves canonical `ai.agent` fields while removing retired model fields.
- 698f16f: Replace ambiguous command approval modes with `ask`, `auto`, and `bypass`, add a fail-closed review Agent, and scope remembered human decisions to the current invocation, sender, or conversation.
- Updated dependencies [9110ab8]
  - @zhin.js/logger@1.1.1

## 1.1.33

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- Updated dependencies [1fc6270]
  - @zhin.js/logger@1.1.0

## 1.5.9

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.

## 1.5.8

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.

## 1.5.7

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- Updated dependencies [09b14d6]
  - @zhin.js/logger@1.0.77

## 1.5.6

### Patch Changes

- 5969c5b: Preserve shared-session participant attribution through conversation persistence and compaction, add explicit turn intent routing, expose the compatible supersede/FIFO overlap policy, and retain causal participants on tool journal events.
- 2f786bd: Replace text-only IM context and metadata-based quote handling with canonical
  conversation events, scoped reference resolution, explicit Endpoint content
  ports, and typed multimedia outcomes. Conversation notices are projected as
  untrusted context data rather than model-authority system instructions.
  The process-global passive-group buffer is removed: prior inbound conversation messages
  are now consumed from the same event store and cursor, with the current Turn
  message excluded from its own context projection.
  The unused `ConversationMemory` topic-memory runtime, its timers, legacy tables,
  and topic-window configuration are removed; `ContextRepository` is the only
  Agent conversation-history authority.
- 1312ca0: Replace the legacy mutable orchestration stack with the event-sourced Workroom Kernel.

  - `@zhin.js/agent` now exposes versioned Workroom events, pure replay/decision state transitions, CAS journals, and a read-only runtime projection. The public `OrchestrationService`, mutable repositories, `AgentDispatcher`, executor/workflow APIs, remote Agent registry/poller, old orchestration tools/constants, and five-agent workflow strategy are removed.
  - `zhin.js/agent` no longer exports the immediate-execution `runPipeline`, `runParallel`, or `route` helpers. Use `AIService.runAgent` for an ordinary one-shot model call; durable multi-Agent collaboration must enter a Workroom Plan and Assignment lifecycle.
  - `spawn_task` is now only an ordinary chat subtask facility. It no longer accepts Run/Task identifiers, creates Runs from IM sessions, dispatches remote tasks, or writes Workroom state.
  - `@zhin.js/ai` no longer owns IM Agent orchestration database models or the unused `ai.remoteAgents` configuration. Workroom persistence belongs to `@zhin.js/agent` as `workroom_events` or an atomic file journal.
  - The Workroom journal backend is fixed for the process lifetime. Changing `ai.sessions.useDatabase` requires a process restart; an unavailable selected database rejects generation activation instead of falling back to another authority.
  - The CLI exposes the read-only Project-scoped Console API at `/api/agent/workroom/runs`; the old `/api/agent/orchestration/runs` route is removed. No model-writable Workroom compatibility tools are published: future command adapters must hold an authenticated Project capability and dedicated Scheduler/Executor/Acceptance ports.
  - The Console client now queries Workroom Runs by `projectId` and renders the replayed Task revision/attempt state. `registerOrchestrationConsole`, `OrchestrationRunsPage`, and `/console/orchestration` are removed in favor of the Workroom-named surface.

  Execution completion and acceptance are separate durable facts. All writes use `append(runId, expectedSequence, events)`; no mutable Task projection can act as a second authority.

## 1.5.5

### Patch Changes

- 0b8b5bd: Fix Anthropic-protocol reasoning round-trip (MiniMax / Claude): do not re-send unsigned thinking parts that trigger AI SDK `unsupported reasoning metadata` warnings. Capture Anthropic thinking signatures when present; keep openai-compatible DeepSeek placeholder behavior unchanged.

## 1.5.4

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau

## 1.5.3

### Patch Changes

- 0e73866: Remove the classic Message-based Collaboration Cell execution seam. IM now
  serves only as canonical turn ingress and reply delivery; Agent-to-Agent work is
  executed by the Orchestration Kernel through `local` Agent bindings or
  `remote_mesh` A2A agents.

  Remove peer mention routing, synthetic Message bridging, Cell prompt injection,
  IM projection executors, `internal_room`, and the dead Collaboration outbound
  parser APIs. Orchestration executor and persisted source parsing now fail closed
  for removed legacy shapes instead of silently changing execution domains.

  `AITriggerConfig.peerMode` and the public `internal_room` / `im_projection`
  executor variants are removed. Local task `assignedTo` values now name an Agent
  binding; remote tasks name an A2A Agent.

## 1.5.2

### Patch Changes

- c50aca3: refactor(ai): simplify AIProvider interface to completeText

  Remove chat() and chatStream() from AIProvider interface along with
  ChatCompletionChunk and ChatCompletionChunkChoice types. Add completeText()
  for lightweight text completion (system + user -> assistant text) used by
  compaction, topic analysis, and summarization. SdkProviderAdapter now
  implements completeText via ai-sdk transport. conversation-memory and
  context-manager updated to use completeText.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 61bfc1c: Fail closed on Agent session and context persistence failures. Database errors now surface as typed `PersistenceUnavailableError` instead of being reinterpreted as Not Found, empty history, or successful metadata writes.

  Make `ContextRepository` the sole Agent session archive authority and remove the duplicate Store archive command that previously reported false after a successful archive.

- f1708c3: 将彩票 Agent 工具迁入正式 `tools/*.ts` ToolFeature 约定目录。

  删除已移除的 `AgentToolsHost` 动态注册桥与 `agent/runtime-tools` 中间层；工具现在由 Plugin Runtime 在候选 generation 中发现，并由标准 prepack 构建器生成可发布的 JavaScript 入口。

  Agent capability catalog 现在发布全树、owner-qualified 的 Tool identity（例如 `lottery__history`），避免子插件工具不可见及跨 owner 同名碰撞；执行边界会运行 Zod-like `safeParse` schema，非法输入在进入工具前 fail-closed。

  Lottery 的 Tool、Command、pipeline 与 outbound 全部从 owner capability runtime 读取资源；删除进程级 DB、Agent deps、push 注册表和 fallback，多实例与跨 generation 执行因此保持隔离。插件将 `zod` 声明为真实运行时依赖，保证 ToolFeature 在不安装 Agent 的合法部署中也可被发现。

  Tool approval 的 `on-risk` 语义现在完整贯穿 Core transport 与 Agent approval gate，不再在 Plugin Runtime capability 投影中丢失。

- 05befc1: Make Agent session persistence origin-neutral. `agent_sessions` now stores only Agent session identity and lifecycle metadata; IM platform, endpoint, and scene fields remain exclusively in the IM transcript/session projection. HTTP, A2A, Schedule, and internal Turns can open Agent sessions without fabricating IM identities.
- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

- a7df753: refactor!: Wave 2 架构债清理（ContentPart 终结 + 死面清剿 + agent 结构收敛）

  **AI 层**

  - `preprocessInboundMedia` / `buildSubagentInboundTask` 入参收窄为 canonical 单形态（ContentPart union 臂删除）。
  - 删除死面：`INBOUND_MEDIA_PARTS_EXTRA_KEY`、`userMessageToFilterText`、tool-policy `always/once/never` 别名、ContentPart `face` 变体、`describeVisionPartsAsText`；`processMultimodal` 等公网 shim 标 `@deprecated`（下个大版本删除）。
  - 测试桥归位：`createOpenAiCompletionsStreamFn` 及 wire 转换器移出公共 API（入 agent 测试目录）；`openai-bridge` 只剩 `assistantText`；`legacy-tool-bridge.ts` 正名 `tool-bridge.ts`。
  - 类型修复：`ModelApi = 'ai-sdk' | (string & {})`；`AgentTool.execute` 与实现对齐为三参（删 `as` 强转）。

  **core 层**

  - 死导出整批删除（均零引用）：`AITool`、撞名 `ToolDefinition`、`NoticeType/RequestType`、Interactive 别名全簇、`PermissionService`/`ConfigService` 别名、`getLiveEndpoint`、`qrcode-segment` 整文件；热路径不再自用 deprecated 别名（`resolveInteractiveSegments` 删除，改 `resolveKeyboardSegments`）。
  - im-contract 双 legacy 格式化函数二合一（`formatLegacyMessageRef` 为唯一公开 API）；ai-outbound 的 legacy `kind` 回退分支删除。

  **agent 层**

  - `ZhinAgentPrivate` 58 → 43 成员：死成员/零读取成员删除，deferred 族收敛为 `DeferredTurnState` 模块，三份手工镜像改为权威接口 Pick，`readonly` 名不副实纠偏，AutoContinueHost 单参化。
  - 4 个值导入循环解环（纯函数下沉 collab-utils / ask-user-format / memory-layers）；prompt 双轨收敛（3 个零调用导出 + 死分支删除）；死文件删除；`sandbox-enhanced` 挂 `@deprecated` 摘出公共导出；`tokenUsageToLegacy` 合一、`AGENT_ROLE_CONFIGS` 拆表。

  BREAKING CHANGE：上述删除项均为公共导出面的收窄，详见各条。

## 1.5.1

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76

## 1.5.0

### Minor Changes

- 1f23bf6: feat(ai): agentLoop harness 四项架构级优化

  - **事件不可变**：`agent_end` 发快照副本，删除 `finally` 清空本地数组（此前已发出事件的 `messages` 会在生成器恢复后被置空，属定时炸弹）。
  - **增量历史修复**：新增 `createIncrementalRepair`——修复不变量由 loop 持有，按最后一个 user 消息为边界，多轮迭代只重修活跃尾部（此前 `repairAgentMessagesForLlm` 每次 LLM 调用都 O(n) 全量扫描）；`Context.preRepaired` 让桥序列化跳过重复修复，外部调用方仍享安全默认。
  - **并行工具结果按调用序落列**：tiered/parallel 桶并发执行不变，toolResult 统一按声明顺序写入消息流（此前按完成先后），对齐 Anthropic 类对块顺序敏感的协议。
  - 清理：`toolExecution` 恒等三元死代码、`maxRecompletePerIteration` 每轮计数的语义注释。

- 5b94d9c: refactor!: 清除 AI 双栈残留（BREAKING，无兼容层）

  - **删除 legacy 直连 HTTP Provider 栈**：`@zhin.js/ai` 的 `providers/` 目录（OpenAI/Anthropic/Ollama/DeepSeek/Google/Cloudflare/Zhipu/Moonshot 及 openai-sse/base）整体移除。生产 provider 实例早已统一经 `createSdkProviderAdapter`（AI SDK 传输）创建，旧栈为零调用死代码；Provider 类与 `OpenAIConfig` 等配置类型导出同步删除。图像生成走 `SdkProviderAdapter.generateImage`（ai-sdk-image 桥）。
  - **删除已死的 collaboration 入站管线**：`createInboundTurnPipeline` 及其 enrich/route/execute/outbound-stage、`registerAiTrigger`、`extractMediaParts`（旧 `$content` 形状读取）、`processMultimodalTurn` 主实现。`ZhinAgent.processMultimodal` 保留为薄 shim（委托 canonical 路径）；`createInboundTurnPipeline` 保留薄门面（内部走 `agent.process`）。
  - **媒体面统一到 canonical MediaRef**：新增 `normalizeMediaRefsToPayloads`（url fetch / path 读盘 / base64 直取 / 大小预检），orchestrator（bootstrap-executors）、subagent-inbound、analyze-media-tool 全部改吃 canonical refs；`payloadToVisionPart` 产出 `MediaContentBlock`；`normalizeMatchRules` 拆分为独立模块 `routing/match-rules`（行为不变）。

  迁移：若仍从 `@zhin.js/ai` import 具体 Provider 类（如 `OpenAIProvider`），改为配置驱动（`ai.providers` + `createSdkProviderAdapter`）。

### Patch Changes

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

## 1.4.8

### Patch Changes

- d8bf702: fix: resolve GitHub security alerts (XSS, ReDoS, vulnerable dependencies)

  - Sanitize URL schemes in `resolveMediaSrc` to reject `javascript:` and other dangerous protocols
  - Replace polynomial regex patterns with loop-based `trimTrailingSlashes` to prevent ReDoS
  - Use `String.trimEnd()` instead of `/\s*$/` regex in env text merging
  - Fix incomplete URL substring sanitization in tests
  - Upgrade `adm-zip` to ^0.6.0 (fixes GHSA-xcpc-8h2w-3j85)
  - Add pnpm override to force `axios ^1.19.0` for `qq-official-bot`
  - Update transitive dependencies via `pnpm update`

## 1.4.7

### Patch Changes

- f346346: fix: 未配置 outputSchema 时不再对 AI SDK `result.output` 做 JSON.stringify，避免 IM 回复出现整段双引号与字面量 `\n`（#590）；出站侧额外解开误包的 JSON 字符串层

## 1.4.6

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

## 1.4.5

### Patch Changes

- Updated dependencies [cc5c94d]
  - @zhin.js/logger@1.0.75

## 1.4.4

### Patch Changes

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/logger@1.0.74

## 1.4.3

### Patch Changes

- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5cc9c03]
  - @zhin.js/logger@1.0.73

## 1.4.2

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
  - @zhin.js/logger@1.0.72

## 1.4.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- ae5239c: fix: 核心包瘦身

## 1.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

## 1.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/logger@0.1.71

## 1.2.0

### Minor Changes

- 65f4b0a: 架构优化、类型安全提升与构建系统清理

  **kernel** (minor)

  - PluginBase.start() 提取 `mountAllContexts()` / `mountContext()` 可覆盖钩子

  **core** (minor)

  - Plugin.start() 覆盖 `mountAllContexts()` 支持 Context 挂载失败回滚
  - Plugin.stop() 委托 `super.stop()` 消除重复代码
  - Lifecycle 事件类型化：message.receive → Message, request.receive → Request, notice.receive → Notice

  **ai** (minor)

  - BaseProvider 提取 `request()` 公共方法，消除 fetch/fetchText/fetchStream 80% 重复代码
  - 修复 fetch/fetchText 的 AbortController 泄漏

  **agent** (minor)

  - 为 7 个模块级单例添加 reset() 函数支持测试隔离
  - 修复 8 处 `catch (e: any)` → `catch (e: unknown)`

  **host-api / plugins** (patch)

  - handlers-db.ts 移除 11 处 `as never` cast，修复 11 处 catch 类型标注
  - adapter-github / plugin-group-suite / plugin-rss 移除 inject() 的 `as any` cast

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.

## 1.1.31

### Patch Changes

- d8547d2: fix: ai 串行改并行

## 1.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化

## 1.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70

## 1.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新

## 1.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69

## 1.1.26

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [7e14f8d]
  - @zhin.js/logger@0.1.68

## 1.1.25

### Patch Changes

- @zhin.js/logger@0.1.67

## 1.1.24

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [f19d2e0]
  - @zhin.js/logger@0.1.66

## 1.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/logger@0.1.65

## 1.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64

## 1.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
  - @zhin.js/logger@0.1.63

## 1.1.20

### Patch Changes

- @zhin.js/logger@0.1.62

## 1.1.19

### Patch Changes

- @zhin.js/logger@0.1.61

## 1.1.18

### Patch Changes

- @zhin.js/logger@0.1.60

## 1.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
  - @zhin.js/logger@0.1.59

## 1.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
  - @zhin.js/logger@0.1.58

## 1.1.15

### Patch Changes

- efad4ef: fix: 幻觉优化
  - @zhin.js/logger@0.1.57

## 1.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
  - @zhin.js/logger@0.1.56

## 1.1.13

### Patch Changes

- @zhin.js/logger@0.1.55

## 1.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54

## 1.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53

## 1.1.10

### Patch Changes

- @zhin.js/logger@0.1.52

## 1.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
  - @zhin.js/logger@0.1.51

## 1.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
  - @zhin.js/logger@0.1.50

## 1.1.7

### Patch Changes

- d73a3b7: fix: ai error
  - @zhin.js/logger@0.1.49

## 1.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48

## 1.1.5

### Patch Changes

- @zhin.js/logger@0.1.47

## 1.1.4

### Patch Changes

- @zhin.js/logger@0.1.46

## 1.1.3

### Patch Changes

- @zhin.js/logger@0.1.45

## 1.1.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/logger@0.1.44

## 1.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43

## 1.1.0

### Minor Changes

- 8280fe7: feat: ModelRegistry 模型自动发现与智能选择

  - 新增 ModelRegistry：自动发现 Provider 可用模型，Tier 评分（0-100）智能排序
  - 支持 Ollama 详细元数据（参数量、量化）和 OpenAI 兼容 API 启发式推断
  - 支持 API 聚合/中转服务的 prefix/model-name 格式（如 9router）
  - providers.models 配置现为可选 — 框架自动发现并按评分排序
  - 新增 chatModel / visionModel 配置项，留空自动选择最优模型
  - 自动模型降级：Chat / Vision / Agent 三条路径均支持失败自动切换
  - Agent 新增 modelFallbacks 配置和 chatWithFallback() 降级引擎

### Patch Changes

- @zhin.js/logger@0.1.42

## 1.0.18

### Patch Changes

- @zhin.js/logger@0.1.41

## 1.0.17

### Patch Changes

- 20ab379: fix: ai 优化
  - @zhin.js/logger@0.1.40

## 1.0.16

### Patch Changes

- @zhin.js/logger@0.1.39

## 1.0.15

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38

## 1.0.14

### Patch Changes

- @zhin.js/logger@0.1.37

## 1.0.13

### Patch Changes

- @zhin.js/logger@0.1.36

## 1.0.12

### Patch Changes

- @zhin.js/logger@0.1.35

## 1.0.11

### Patch Changes

- @zhin.js/logger@0.1.34

## 1.0.10

### Patch Changes

- @zhin.js/logger@0.1.33

## 1.0.9

### Patch Changes

- @zhin.js/logger@0.1.32

## 1.0.8

### Patch Changes

- @zhin.js/logger@0.1.31

## 1.0.7

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
  - @zhin.js/logger@0.1.30

## 1.0.6

### Patch Changes

- 63b83ef: fix: 自定义 schema
  - @zhin.js/logger@0.1.29

## 1.0.5

### Patch Changes

- @zhin.js/logger@0.1.28

## 1.0.4

### Patch Changes

- @zhin.js/logger@0.1.27

## 1.0.3

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
  - @zhin.js/logger@0.1.26

## 1.0.2

### Patch Changes

- @zhin.js/logger@0.1.25

## 1.0.1

### Patch Changes

- @zhin.js/logger@0.1.24
