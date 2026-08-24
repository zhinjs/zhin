# @zhin.js/plugin-runtime

## 1.1.8

### Patch Changes

- 12025ee: Project exact Endpoint control capabilities through the outbound Host and connect native typing, editable progress, ordered Agent/subagent/tool events, and transient Schedule completion states to IM activity feedback. Gate event ingress by the committed Runtime generation, pin Endpoint operations and retirement cleanup to that generation's IM snapshot, and guarantee terminal cleanup across public Agent error and cancellation paths.
- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.

## 1.1.7

### Patch Changes

- 67ef8c4: Publish each generation as one committed snapshot-and-state record so Runtime ownership and model sidecars cannot lag behind commit observers. `GenerationCommitEvent` now exposes `previous` and `current` committed records through their `snapshot` and `state` fields.

  Make HMR shutdown close admission and await the active reload, stop accepting generation work after a process restart is required, and isolate post-commit observer failures from the committed reload outcome.

## 1.1.6

### Patch Changes

- 63253bb: Restrict Root consumers to the read-only `SnapshotReader` lease interface and
  remove public `RootRuntime.controller` access. Generation commit, transaction,
  close, and stop authority now remain inside the Root lifecycle.

  Close Root admission when rollback cleanup or retired-generation disposal can
  no longer prove lifecycle integrity. Existing leases may drain, but new
  operations and generation transactions fail closed until the Process Host
  stops the Root.

  Bind externally driven capability resources to lifecycle-owned generation admission gates.
  Adapter candidates can establish Endpoint connections during readiness while their IM ingress
  remains invisible; snapshot commit atomically retires the old ingress and publishes the new one,
  without closing the old Endpoint before the transaction succeeds.
  Admitted HTTP, WebSocket, IM, isolated-RPC, Endpoint control, and Endpoint management operations
  now retain their exact generation until settlement instead of escaping with a live object.

  Remove inert unconfigured Endpoints and deferred soft-start. Configured Endpoint creation,
  connection readiness, and local admission are required generation prerequisites; any failure
  disposes the complete candidate set and leaves the previous generation serving traffic.

  Move the HTTP listener to Process Host ownership. Generation scopes now receive only an
  `HttpHost` routing port (without `listen`/`close` authority), and HTTP/WS registrations are tagged
  with generation admission so candidate routes cannot shadow committed routes before publish.

  Remove the fallible post-commit `openNext` phase and all pre-commit old-generation
  quiesce/resume hooks. Handoff now performs candidate readiness and reversible candidate cleanup
  only; the previous generation remains untouched until the single synchronous snapshot/admission
  publish point, then drains through its existing leases.
  Candidate setup, Feature projection, Endpoint readiness, MCP connection, isolation activation,
  database activation, and config commit now receive the Root transaction `AbortSignal`; Root Stop
  fails closed and awaits candidate cancellation cleanup.

## 1.1.5

### Patch Changes

- c106ecc: feat(permission): add unified @zhin.js/permission package with builtin DSL (adapter/group/private/channel/user/role), PermissionHost, and platform permit checker. Extract LegacyEndpointControlSurface to im-contract. Support Unicode capability local names in plugin-runtime.
- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- e40b048: Require generation leases at the IM ingress route instead of exposing a bare
  snapshot. Snapshot leases are store-owned, expose their active state, and can
  be rejected when presented to an Agent Runtime attached to another Root.

  Project configured MCP clients into the generation lifecycle. Configured
  servers must become ready during candidate activation; activation failure is
  fail-closed and leaves the previous generation serving traffic. Agent bindings
  filter the MCP servers visible to a turn, and MCP tools use owner-qualified
  `${qualifiedServer}__${tool}` names with fail-closed approval metadata.

## 1.1.4

### Patch Changes

- f8c7a54: fix: im

## 1.1.3

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

## 1.1.2

### Patch Changes

- c8f4d45: fix(plugin-runtime): 发布 database host 新导出（`createPluginDatabaseHost` / `databaseRootHostToken`）

  cli@3.0.0 的 `database-host-installer` 依赖这些导出，但当前 npm 上的 plugin-runtime@1.1.1 tarball 发布于导出加入之前，导致消费端 `SyntaxError: ... does not provide an export named 'createPluginDatabaseHost'`。需先发 plugin-runtime，再发 cli 使其锁到新版本。

## 1.1.1

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.

## 1.1.0

### Minor Changes

- 3ea84a0: Plugin Runtime 插件 agent 工具接线：新增 `agentToolsHostToken`（generation 作用域的 Agent Tools Host），插件 `setup()` 可经闭包向 Agent Host 注册工具（桥接 zod inputSchema → JSON parameters + execute 前校验），解决 Runtime 下插件 `agent/tools` 不被发现、`lottery agent deps not initialized` 的问题。lottery 7 个 `lottery_*` 工具已按此接线（`agent/runtime-tools.ts`）；`/api/introspection/tools` 合并 agent 注册工具。
- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

## 1.0.1

### Patch Changes

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。
