# @zhin.js/core

## 1.5.6

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/command@1.0.11
  - @zhin.js/adapter@1.1.7

## 1.5.5

### Patch Changes

- Updated dependencies [2d0a622]
  - @zhin.js/command@1.0.10
  - @zhin.js/adapter@1.1.7

## 1.5.4

### Patch Changes

- b0f37ae: refactor(core): integrate permission host and canonical endpoint control

  Adapter now routes recall/edit operations through the canonical EndpointControl
  port, with classic $-prefixed methods bridged via resolveEndpointControl.
  CommandFeature and MessageCommand accept PermissionHost for declarative
  permit checks. Dispatcher accepts an optional permissionHost option.
  ImRuntime provides the permission host via DI. MessageCommand uses
  toPermissionSubject for duck-typed subject projection.

- 36c7400: Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

  Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.

- 162fa34: Publish `ask_user` as a generation-owned ToolFeature backed by a Root-owned, origin-neutral InteractionRouter.

  Tool execution now receives an optional turn-scoped QuestionPort. The IM composition root binds that port to the canonical session and authenticated sender, and ImRuntime can claim pending interaction replies before middleware, commands, or Agent fallback. Invalid replies use the current message's delivery authority; the router never retains an expired Runtime Message or Adapter handle. Missing interactive authority, ambiguous sessions, delivery failures, cancellation, and Root shutdown fail closed.

  BREAKING CHANGE: canonical Agent turns no longer rely on Plugin Prompt middleware or mutable global ask-user registries for `ask_user`. Ingress adapters that support interactive questions must provide a QuestionPort; unattended turns cannot expose one.

- e40b048: Require generation leases at the IM ingress route instead of exposing a bare
  snapshot. Snapshot leases are store-owned, expose their active state, and can
  be rejected when presented to an Agent Runtime attached to another Root.

  Project configured MCP clients into the generation lifecycle. Configured
  servers must become ready during candidate activation; activation failure is
  fail-closed and leaves the previous generation serving traffic. Agent bindings
  filter the MCP servers visible to a turn, and MCP tools use owner-qualified
  `${qualifiedServer}__${tool}` names with fail-closed approval metadata.

- f1708c3: 将彩票 Agent 工具迁入正式 `tools/*.ts` ToolFeature 约定目录。

  删除已移除的 `AgentToolsHost` 动态注册桥与 `agent/runtime-tools` 中间层；工具现在由 Plugin Runtime 在候选 generation 中发现，并由标准 prepack 构建器生成可发布的 JavaScript 入口。

  Agent capability catalog 现在发布全树、owner-qualified 的 Tool identity（例如 `lottery__history`），避免子插件工具不可见及跨 owner 同名碰撞；执行边界会运行 Zod-like `safeParse` schema，非法输入在进入工具前 fail-closed。

  Lottery 的 Tool、Command、pipeline 与 outbound 全部从 owner capability runtime 读取资源；删除进程级 DB、Agent deps、push 注册表和 fallback，多实例与跨 generation 执行因此保持隔离。插件将 `zod` 声明为真实运行时依赖，保证 ToolFeature 在不安装 Agent 的合法部署中也可被发现。

  Tool approval 的 `on-risk` 语义现在完整贯穿 Core transport 与 Agent approval gate，不再在 Plugin Runtime capability 投影中丢失。

- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

- 92b0dd7: refactor: complete plugin dual-track elimination (Slices 3–4)

  Remove all `getHostRootPlugin()` call sites (30+ occurrences across security,
  collaboration, media, memory, prompt, and orchestrator modules); dead branches
  collapse to defaults/fallbacks. Expand harness to ban `getHostRootPlugin()` in
  all packages.

  Stub `initAgentModule()` and `registerAI()` as throwing — the Plugin Runtime
  (`zhin runtime start`) is the sole entry path; `basic/cli` assembles the Agent
  stack directly.

  Mark `PluginBase.provide()` / `.inject()` as `@deprecated @internal`; the
  service bus is superseded by Scope + Token (introduced in Slice 2).

  Simplify `host-plugin-registry.ts` to minimal no-op signatures. Move
  `AIServiceRefs` type to `internal/` so live collaboration/orchestrator code
  no longer depends on dead `init/` modules.

  Clean `setHostRootPlugin` / `getHostRootPlugin` mocks from 8 test files;
  update agent README to remove `initAgentModule` usage examples.

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

- Updated dependencies [c106ecc]
- Updated dependencies [ca92e03]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/permission@1.0.1
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/adapter@1.1.7
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/command@1.0.9
  - @zhin.js/kernel@1.0.7
  - @zhin.js/component@1.0.8
  - @zhin.js/middleware@1.0.8

## 1.5.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/database@1.0.79
  - @zhin.js/logger@1.0.76
  - @zhin.js/schema@1.0.73
  - @zhin.js/adapter@1.1.6
  - @zhin.js/command@1.0.8
  - @zhin.js/component@1.0.7
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/kernel@1.0.6
  - @zhin.js/middleware@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.5.2

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
- Updated dependencies [9f57124]
  - @zhin.js/adapter@1.1.5
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/command@1.0.7
  - @zhin.js/component@1.0.6
  - @zhin.js/middleware@1.0.6

## 1.5.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/adapter@1.1.4
  - @zhin.js/command@1.0.6
  - @zhin.js/component@1.0.5
  - @zhin.js/middleware@1.0.5

## 1.5.0

### Minor Changes

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

- Updated dependencies [7c1e63a]
- Updated dependencies [4fbff5d]
  - @zhin.js/command@1.0.5
  - @zhin.js/adapter@1.1.3

## 1.4.3

### Patch Changes

- 45b3256: fix: resolve master/trusted identity from plugins.\<adapter\> config

  Authorization previously only checked a top-level `endpoints[]` array for
  master/trusted fields. When `master` was declared at the adapter level
  (e.g. `plugins.icqq.master`), the sender was never recognized as master.

  Two changes:

  1. **authorization.ts** — `findEndpointEntryFromConfig` now also reads
     `plugins.<adapter>` and merges adapter-level `master`/`trusted` onto the
     matched endpoint entry so `resolveSenderRoles` sees them.

  2. **config-composer.ts** — Adapter plugins (schemas with array-typed
     `endpoints`) automatically receive `master` and `trusted` schema
     properties when not already declared, so all adapters accept these
     framework-level fields without needing to manually add them to their
     own `schema.json`.

## 1.4.2

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/command@1.0.4
  - @zhin.js/adapter@1.1.2
  - @zhin.js/component@1.0.4
  - @zhin.js/middleware@1.0.4

## 1.4.1

### Patch Changes

- f0ec5ab: 五分钟首跑闭环（P1-2.1）。

  - `create-zhin-app`：依赖安装完成后自动运行项目内 `zhin doctor` 做安装后自检（Node 版本 / pnpm / 配置文件 / Console 登录条件 / 端口占用），自检失败不阻断创建流程。
  - `@zhin.js/cli`：`zhin runtime start` 启动成功后输出醒目的首跑指引（Remote Console 地址、Host `http://127.0.0.1:<port>`、token 在 `.env` 的 `HTTP_TOKEN`、Sandbox 页发送 hello），新增 `--open` / `ZHIN_OPEN=1` 自动打开浏览器（CI 与无显示环境自动跳过）；`zhin doctor` 的 pnpm 修复提示补充 corepack 方式、端口占用提示补充 `http.port` 换端口方案，AI 引导文件（SOUL/TOOLS/AGENTS）检查改为仅在启用 AI 时执行，避免 IM-only 首跑项目收到误导性警告。
  - `@zhin.js/core`：`MessageGateway` 接口新增 `setUnmatchedHandler`（此前仅 `ImRuntime` 实现类上有，Host AI 回退同款钩子），支撑单文件 bot 在无 `commands/` 约定目录时响应消息。
  - 新增 `examples/single-file-bot`：一个 `bot.ts` 即完整机器人（definePlugin + defineCommand + sandbox adapter），附 README 说明单文件与约定目录布局的取舍。

- fa66c4c: Use `segment-matcher` as the CommandIndex engine, add typed canonical segment parameters and
  expose unmatched structured segments through CommandContext. Preserve structured command input
  while stripping adapter command prefixes in the Core message dispatcher.
- 6cb6152: 统一消息元素通道（UNI-Channel）落地：

  - **入站契约**：`IncomingMessage.segments`（canonical Segment[]，与 content 纯文本视图同源双轨），Message 透传；AI 兜底链路经 `collectSegmentMedia` 把图片/语音/视频/文件 MediaRef 写入会话 extra——多模态输入不再丢失。
  - **出站协商**：`normalizeOutboundPayload` 升级全量 canonical 归一（复用 generic-segment-mapper），html→image 按端点 `segments.outboundMedia` 声明降级（base64 直发 / url-or-text / passthrough 自行物化）；`MediaRef.kind` 新增 `'file'` 承载平台不透明引用（file_id/resource_id）。
  - **能力声明**：`defineAdapter.segments` policy（outboundMedia / interactive），三道段门禁复活（探测点改 adapters/\*.ts，豁免名单渐进收敛）。
  - **首批迁移**：icqq 全保真出入站（CQ ↔ canonical，quote→reply 段）；milky/telegram/discord 入站媒体段恢复（附件/贴纸/callback action）；napcat/onebot11/onebot12 出站 canonical→OneBot 数组段；wechat-mp/wecom `/cgi-bin/media/upload` 与 lark `/im/v1/images` 上传通路（base64/URL 图片不再静默丢图，失败降级文本）。

- Updated dependencies [cdf64e7]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [50497a5]
- Updated dependencies [9c997b2]
- Updated dependencies [09d4f25]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/command@1.0.3
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/schema@1.0.72
  - @zhin.js/database@1.0.78
  - @zhin.js/adapter@1.1.1
  - @zhin.js/component@1.0.3
  - @zhin.js/middleware@1.0.3
  - @zhin.js/kernel@1.0.5

## 1.4.0

### Minor Changes

- 7db69c1: 命令前缀改为适配器配置项：`MessageDispatcher` 不再硬编码 `/`，默认按消息所属适配器实例 config 的 `commandPrefix` 解析（默认 `''` 无前缀，任意文本按命令匹配），`endpoints[i].commandPrefix` 逐项覆盖；`ImRuntime({ commandPrefix })` 仍可设全局静态前缀。全部 20 个平台适配器 schema 新增 `commandPrefix` 属性。

  BREAKING（行为变化）：未配置时命令不再需要 `/` 前缀——原 `/zt` 写法不再命中，直接发 `zt` 即可；需要斜杠风格的适配器请在配置里显式设 `commandPrefix: '/'`。

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。

### Patch Changes

- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/adapter@1.1.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/command@1.0.2
  - @zhin.js/component@1.0.2
  - @zhin.js/middleware@1.0.2

## 1.3.5

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

- cc5c94d: 约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

  - 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
  - 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
  - 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
  - CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

  后续加固（同批）：

  - CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
  - 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
  - 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
  - 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
  - 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
  - Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:\* 接 DatabaseHost。

  注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。

- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/logger@1.0.75
  - @zhin.js/database@1.0.77
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/kernel@1.0.4
  - @zhin.js/adapter@1.0.1
  - @zhin.js/command@1.0.1
  - @zhin.js/component@1.0.1
  - @zhin.js/middleware@1.0.1

## 1.3.4

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/kernel@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/database@1.0.76

## 1.3.3

### Patch Changes

- 5b08052: fix: 架构优化
- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
  - @zhin.js/kernel@1.0.2
  - @zhin.js/database@1.0.75
  - @zhin.js/logger@1.0.73
  - @zhin.js/schema@1.0.71

## 1.3.2

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
- Updated dependencies [c4575c9]
  - @zhin.js/logger@1.0.72
  - @zhin.js/kernel@1.0.1

## 1.3.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 93e58d9: refactor: 网络策略统一、core 导出整理、Disposable 接口、Bot 图标修复

  - 新增 `security/network-policy.ts` 统一 SSRF 防护、域名匹配、网络命令检测
  - `core/index.ts` 移除死导出、统一结构
  - 新增 `Disposable` 接口替代 `as any` dispose 调用
  - `bridge.ts` MCP inputSchema 类型安全
  - 脚手架依赖版本锁定（latest → ^major.minor.0）
  - 修复 icqq/sandbox 客户端缺失 Bot 图标导入

- ae5239c: fix: 核心包瘦身

## 1.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/ai@1.3.0

## 1.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/database@1.0.74
  - @zhin.js/ai@1.2.1
  - @zhin.js/logger@0.1.71
  - @zhin.js/kernel@0.1.1

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
- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/kernel@0.1.0
  - @zhin.js/ai@1.2.0

## 1.1.33

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/kernel@0.0.50
  - @zhin.js/ai@1.1.31

## 1.1.32

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/kernel@0.0.49
  - @zhin.js/ai@1.1.30

## 1.1.31

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
  - @zhin.js/database@1.0.73
  - @zhin.js/logger@0.1.70
  - @zhin.js/schema@1.0.70
  - @zhin.js/ai@1.1.29
  - @zhin.js/kernel@0.0.48

## 1.1.30

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/kernel@0.0.47
  - @zhin.js/ai@1.1.28

## 1.1.29

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/database@1.0.72
  - @zhin.js/logger@0.1.69
  - @zhin.js/schema@1.0.69
  - @zhin.js/ai@1.1.27
  - @zhin.js/kernel@0.0.46

## 1.1.28

### Patch Changes

- 6295cbd: fix: @优化
- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/database@1.0.71
  - @zhin.js/logger@0.1.68
  - @zhin.js/schema@1.0.68
  - @zhin.js/ai@1.1.26
  - @zhin.js/kernel@0.0.45

## 1.1.27

### Patch Changes

- @zhin.js/database@1.0.70
- @zhin.js/logger@0.1.67
- @zhin.js/schema@1.0.67
- @zhin.js/ai@1.1.25
- @zhin.js/kernel@0.0.44

## 1.1.26

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/kernel@0.0.43
  - @zhin.js/database@1.0.69
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24
  - @zhin.js/schema@1.0.66

## 1.1.25

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/kernel@0.0.42
  - @zhin.js/database@1.0.68
  - @zhin.js/logger@0.1.65
  - @zhin.js/schema@1.0.65
  - @zhin.js/ai@1.1.23

## 1.1.24

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/database@1.0.67
  - @zhin.js/logger@0.1.64
  - @zhin.js/schema@1.0.64
  - @zhin.js/ai@1.1.22
  - @zhin.js/kernel@0.0.41

## 1.1.23

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/ai@1.1.21
  - @zhin.js/database@1.0.66
  - @zhin.js/logger@0.1.63
  - @zhin.js/schema@1.0.63
  - @zhin.js/kernel@0.0.40

## 1.1.22

### Patch Changes

- @zhin.js/database@1.0.65
- @zhin.js/logger@0.1.62
- @zhin.js/schema@1.0.62
- @zhin.js/ai@1.1.20
- @zhin.js/kernel@0.0.39

## 1.1.21

### Patch Changes

- @zhin.js/database@1.0.64
- @zhin.js/logger@0.1.61
- @zhin.js/schema@1.0.61
- @zhin.js/ai@1.1.19
- @zhin.js/kernel@0.0.38

## 1.1.20

### Patch Changes

- 88caeb2: fix: ask user 护栏
  - @zhin.js/database@1.0.63
  - @zhin.js/logger@0.1.60
  - @zhin.js/schema@1.0.60
  - @zhin.js/ai@1.1.18
  - @zhin.js/kernel@0.0.37

## 1.1.19

### Patch Changes

- Updated dependencies [fcad030]
  - @zhin.js/ai@1.1.17
  - @zhin.js/database@1.0.62
  - @zhin.js/logger@0.1.59
  - @zhin.js/schema@1.0.59
  - @zhin.js/kernel@0.0.36

## 1.1.18

### Patch Changes

- Updated dependencies [cb9fbf1]
  - @zhin.js/ai@1.1.16
  - @zhin.js/database@1.0.61
  - @zhin.js/logger@0.1.58
  - @zhin.js/schema@1.0.58
  - @zhin.js/kernel@0.0.35

## 1.1.17

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/database@1.0.60
  - @zhin.js/logger@0.1.57
  - @zhin.js/schema@1.0.57
  - @zhin.js/kernel@0.0.34

## 1.1.16

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/kernel@0.0.33
  - @zhin.js/ai@1.1.14
  - @zhin.js/database@1.0.59
  - @zhin.js/logger@0.1.56
  - @zhin.js/schema@1.0.56

## 1.1.15

### Patch Changes

- @zhin.js/database@1.0.58
- @zhin.js/logger@0.1.55
- @zhin.js/schema@1.0.55
- @zhin.js/ai@1.1.13
- @zhin.js/kernel@0.0.32

## 1.1.14

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/database@1.0.57
  - @zhin.js/logger@0.1.54
  - @zhin.js/schema@1.0.54
  - @zhin.js/ai@1.1.12
  - @zhin.js/kernel@0.0.31

## 1.1.13

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/database@1.0.56
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53
  - @zhin.js/ai@1.1.11
  - @zhin.js/kernel@0.0.30

## 1.1.12

### Patch Changes

- Updated dependencies [bcd56d5]
  - @zhin.js/database@1.0.56
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53
  - @zhin.js/ai@1.1.11
  - @zhin.js/kernel@0.0.30

## 1.1.11

### Patch Changes

- 7b0227a: fix: ai 优化,定时任务优化

## 1.1.10

### Patch Changes

- d0250e8: fix: 修复 onebot11 的反向 bug,优化 cli
  - @zhin.js/database@1.0.55
  - @zhin.js/logger@0.1.52
  - @zhin.js/schema@1.0.52
  - @zhin.js/ai@1.1.10
  - @zhin.js/kernel@0.0.29

## 1.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
- Updated dependencies [0eba6d6]
  - @zhin.js/ai@1.1.9
  - @zhin.js/database@1.0.54
  - @zhin.js/logger@0.1.51
  - @zhin.js/schema@1.0.51
  - @zhin.js/kernel@0.0.28

## 1.1.8

### Patch Changes

- Updated dependencies [9aa08c3]
  - @zhin.js/ai@1.1.8
  - @zhin.js/database@1.0.53
  - @zhin.js/logger@0.1.50
  - @zhin.js/schema@1.0.50
  - @zhin.js/kernel@0.0.27

## 1.1.7

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/database@1.0.52
  - @zhin.js/logger@0.1.49
  - @zhin.js/schema@1.0.49
  - @zhin.js/kernel@0.0.26

## 1.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/database@1.0.51
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48
  - @zhin.js/ai@1.1.6
  - @zhin.js/kernel@0.0.25

## 1.1.5

### Patch Changes

- @zhin.js/database@1.0.50
- @zhin.js/logger@0.1.47
- @zhin.js/schema@1.0.47
- @zhin.js/ai@1.1.5
- @zhin.js/kernel@0.0.24

## 1.1.4

### Patch Changes

- @zhin.js/database@1.0.49
- @zhin.js/logger@0.1.46
- @zhin.js/schema@1.0.46
- @zhin.js/ai@1.1.4
- @zhin.js/kernel@0.0.23

## 1.1.3

### Patch Changes

- @zhin.js/database@1.0.48
- @zhin.js/logger@0.1.45
- @zhin.js/schema@1.0.45
- @zhin.js/ai@1.1.3
- @zhin.js/kernel@0.0.22

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
  - @zhin.js/kernel@0.0.21
  - @zhin.js/database@1.0.47
  - @zhin.js/logger@0.1.44
  - @zhin.js/schema@1.0.44
  - @zhin.js/ai@1.1.2

## 1.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/database@1.0.46
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43
  - @zhin.js/ai@1.1.1
  - @zhin.js/kernel@0.0.20

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

- Updated dependencies [8280fe7]
  - @zhin.js/ai@1.1.0
  - @zhin.js/database@1.0.45
  - @zhin.js/logger@0.1.42
  - @zhin.js/schema@1.0.42
  - @zhin.js/kernel@0.0.19

## 1.0.57

### Patch Changes

- c606a57: fix: ask_user 优化
  - @zhin.js/database@1.0.44
  - @zhin.js/logger@0.1.41
  - @zhin.js/schema@1.0.41
  - @zhin.js/ai@1.0.18
  - @zhin.js/kernel@0.0.18

## 1.0.56

### Patch Changes

- Updated dependencies [20ab379]
  - @zhin.js/ai@1.0.17
  - @zhin.js/database@1.0.43
  - @zhin.js/logger@0.1.40
  - @zhin.js/schema@1.0.40
  - @zhin.js/kernel@0.0.17

## 1.0.55

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理
  - @zhin.js/database@1.0.42
  - @zhin.js/logger@0.1.39
  - @zhin.js/schema@1.0.39
  - @zhin.js/ai@1.0.16
  - @zhin.js/kernel@0.0.16

## 1.0.54

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/database@1.0.41
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38
  - @zhin.js/ai@1.0.15
  - @zhin.js/kernel@0.0.15

## 1.0.53

### Patch Changes

- Updated dependencies [daee7f6]
  - @zhin.js/database@1.0.40
  - @zhin.js/logger@0.1.37
  - @zhin.js/schema@1.0.37
  - @zhin.js/ai@1.0.14
  - @zhin.js/kernel@0.0.14

## 1.0.52

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- bb6bfa8: feat: 技能全面文件化——仓库内插件/适配器使用 `skills/<name>/SKILL.md`；Core 已移除 `plugin.declareSkill` / `Adapter.declareSkill` API
  - @zhin.js/database@1.0.39
  - @zhin.js/logger@0.1.36
  - @zhin.js/schema@1.0.36
  - @zhin.js/ai@1.0.13
  - @zhin.js/kernel@0.0.13

## 1.0.51

### Patch Changes

- @zhin.js/database@1.0.38
- @zhin.js/logger@0.1.35
- @zhin.js/schema@1.0.35
- @zhin.js/ai@1.0.12
- @zhin.js/kernel@0.0.12

## 1.0.50

### Patch Changes

- @zhin.js/database@1.0.37
- @zhin.js/logger@0.1.34
- @zhin.js/schema@1.0.34
- @zhin.js/ai@1.0.11
- @zhin.js/kernel@0.0.11

## 1.0.49

### Patch Changes

- b00b6c9: fix: 代码逃逸拦截增强
- Updated dependencies [b00b6c9]
  - @zhin.js/kernel@0.0.10
  - @zhin.js/database@1.0.36
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33
  - @zhin.js/ai@1.0.10

## 1.0.48

### Patch Changes

- 7d09e5e: fix: 代码安全漏洞修复
- Updated dependencies [7d09e5e]
  - @zhin.js/kernel@0.0.9
  - @zhin.js/database@1.0.35
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32
  - @zhin.js/ai@1.0.9

## 1.0.47

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
  - @zhin.js/database@1.0.34
  - @zhin.js/logger@0.1.31
  - @zhin.js/schema@1.0.31
  - @zhin.js/ai@1.0.8
  - @zhin.js/kernel@0.0.8

## 1.0.46

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/ai@1.0.7
  - @zhin.js/database@1.0.33
  - @zhin.js/logger@0.1.30
  - @zhin.js/schema@1.0.30
  - @zhin.js/kernel@0.0.7

## 1.0.45

### Patch Changes

- 63b83ef: fix: 自定义 schema
- Updated dependencies [63b83ef]
  - @zhin.js/ai@1.0.6
  - @zhin.js/database@1.0.32
  - @zhin.js/logger@0.1.29
  - @zhin.js/schema@1.0.29
  - @zhin.js/kernel@0.0.6

## 1.0.44

### Patch Changes

- @zhin.js/database@1.0.31
- @zhin.js/logger@0.1.28
- @zhin.js/schema@1.0.28
- @zhin.js/ai@1.0.5
- @zhin.js/kernel@0.0.5

## 1.0.43

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
  - @zhin.js/database@1.0.30
  - @zhin.js/logger@0.1.27
  - @zhin.js/schema@1.0.27
  - @zhin.js/ai@1.0.4
  - @zhin.js/kernel@0.0.4

## 1.0.42

### Patch Changes

- Updated dependencies [0999ca6]
  - @zhin.js/ai@1.0.3
  - @zhin.js/database@1.0.29
  - @zhin.js/logger@0.1.26
  - @zhin.js/schema@1.0.26
  - @zhin.js/kernel@0.0.3

## 1.0.41

### Patch Changes

- 5a68249: fix: 文档优化
  - @zhin.js/database@1.0.28
  - @zhin.js/logger@0.1.25
  - @zhin.js/schema@1.0.25
  - @zhin.js/ai@1.0.2
  - @zhin.js/kernel@0.0.2

## 1.0.40

### Patch Changes

- 7ef9057: fix: 架构调整优化
  - @zhin.js/database@1.0.27
  - @zhin.js/logger@0.1.24
  - @zhin.js/schema@1.0.24
  - @zhin.js/ai@1.0.1
  - @zhin.js/kernel@0.0.1

## 1.0.39

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
  - @zhin.js/database@1.0.26
  - @zhin.js/logger@0.1.23
  - @zhin.js/schema@1.0.23

## 1.0.38

### Patch Changes

- ab5c54a: fix: ai 架构优化
  - @zhin.js/database@1.0.25
  - @zhin.js/logger@0.1.22
  - @zhin.js/schema@1.0.22

## 1.0.37

### Patch Changes

- a8ce720: fix: ai 优化,github 优化
  - @zhin.js/database@1.0.24
  - @zhin.js/logger@0.1.21
  - @zhin.js/schema@1.0.21

## 1.0.36

### Patch Changes

- 6d94111: fix: 增加 github 适配器,更改 auth 为 token auth
  - @zhin.js/database@1.0.23
  - @zhin.js/logger@0.1.20
  - @zhin.js/schema@1.0.20

## 1.0.35

### Patch Changes

- 8502351: fix: token 优化
  - @zhin.js/database@1.0.22
  - @zhin.js/logger@0.1.19
  - @zhin.js/schema@1.0.19

## 1.0.34

### Patch Changes

- 634e2d7: fix: ai 强化
  - @zhin.js/database@1.0.21
  - @zhin.js/logger@0.1.18
  - @zhin.js/schema@1.0.18

## 1.0.33

### Patch Changes

- 4abae79: fix: msg compile
  - @zhin.js/database@1.0.20
  - @zhin.js/logger@0.1.17
  - @zhin.js/schema@1.0.17

## 1.0.32

### Patch Changes

- 10d8bdc: fix: win 下 dev 错误
  - @zhin.js/database@1.0.19
  - @zhin.js/logger@0.1.16
  - @zhin.js/schema@1.0.16

## 1.0.31

### Patch Changes

- 771706d: fix: 技能优化
  - @zhin.js/database@1.0.18
  - @zhin.js/logger@0.1.15
  - @zhin.js/schema@1.0.15

## 1.0.30

### Patch Changes

- @zhin.js/database@1.0.17
- @zhin.js/logger@0.1.14
- @zhin.js/schema@1.0.14

## 1.0.29

### Patch Changes

- 4ec9176: fix: ai
  - @zhin.js/database@1.0.16
  - @zhin.js/logger@0.1.13
  - @zhin.js/schema@1.0.13

## 1.0.28

### Patch Changes

- 05a514d: fix: ai 增强,cli 增强
  - @zhin.js/database@1.0.15
  - @zhin.js/logger@0.1.12
  - @zhin.js/schema@1.0.12

## 1.0.27

### Patch Changes

- b27e633: fix: cli 优化
  - @zhin.js/database@1.0.14
  - @zhin.js/logger@0.1.11
  - @zhin.js/schema@1.0.11

## 1.0.26

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/database@1.0.13
  - @zhin.js/logger@0.1.10
  - @zhin.js/schema@1.0.10

## 1.0.25

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/database@1.0.12
  - @zhin.js/logger@0.1.9
  - @zhin.js/schema@1.0.9

## 1.0.24

### Patch Changes

- 6108e5d: fix: component
  - @zhin.js/database@1.0.11
  - @zhin.js/logger@0.1.8
  - @zhin.js/schema@1.0.8

## 1.0.23

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
  - @zhin.js/database@1.0.10
  - @zhin.js/logger@0.1.7
  - @zhin.js/schema@1.0.7

## 1.0.22

### Patch Changes

- @zhin.js/database@1.0.9
- @zhin.js/logger@0.1.6
- @zhin.js/schema@1.0.6

## 1.0.21

### Patch Changes

- 3960e70: fix: runtime err
  - @zhin.js/database@1.0.8
  - @zhin.js/logger@0.1.5
  - @zhin.js/schema@1.0.5

## 1.0.20

### Patch Changes

- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
  - @zhin.js/dependency@1.0.5
  - @zhin.js/database@1.0.7
  - @zhin.js/logger@0.1.4
  - @zhin.js/schema@1.0.4

## 1.0.19

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/database@1.0.6
  - @zhin.js/dependency@1.0.4
  - @zhin.js/logger@0.1.3
  - @zhin.js/schema@1.0.3

## 1.0.18

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/database@1.0.5
  - @zhin.js/dependency@1.0.3
  - @zhin.js/logger@0.1.2
  - @zhin.js/schema@1.0.2

## 1.0.17

### Patch Changes

- 3bc5d56: fix: 内存优化
- Updated dependencies [3bc5d56]
  - @zhin.js/hmr@1.0.8

## 1.0.16

### Patch Changes

- e733fab: fix: 异步组件优化

## 1.0.15

### Patch Changes

- f9e75ce: fix: 一致性调整,文档调整
- e783f90: fix:保护 bun
- f9e75ce: fix: recall,文档统一,mcp,githubnotifiy

## 1.0.14

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/database@1.0.4
  - @zhin.js/hmr@1.0.7

## 1.0.13

### Patch Changes

- a2e1ebc: fix: 优化监听
- Updated dependencies [a2e1ebc]
  - @zhin.js/hmr@1.0.6

## 1.0.12

### Patch Changes

- ff5a7ed: fix: 文件监听
- Updated dependencies [ff5a7ed]
  - @zhin.js/hmr@1.0.5

## 1.0.11

### Patch Changes

- Updated dependencies [ae680db]
  - @zhin.js/hmr@1.0.4

## 1.0.10

### Patch Changes

- c8c3996: fix: 修复 segment-matcher
- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1
  - @zhin.js/hmr@1.0.3

## 1.0.9

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖

## 1.0.8

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/database@1.0.3
  - @zhin.js/hmr@1.0.2

## 1.0.7

### Patch Changes

- 47845fb: fix: err
- Updated dependencies [47845fb]
  - @zhin.js/database@1.0.2

## 1.0.6

### Patch Changes

- c2d9047: fix: 重复插件 bug
- c2d9047: fix: 优化中间件逻辑

## 1.0.5

### Patch Changes

- f347667: fix: runtime error

## 1.0.4

### Patch Changes

- 15be776: fix: 修改 cli 错误,增加 permit

## 1.0.3

### Patch Changes

- 89bc676: fix: 类型反射优化
- Updated dependencies [727963c]
  - @zhin.js/database@1.0.1
  - @zhin.js/hmr@1.0.1

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- 3ecd487: fix: 函数式组件,更新文档

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/hmr@1.0.1
