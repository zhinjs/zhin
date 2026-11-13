# @zhin.js/plugin-test-kit

## 1.0.10

### Patch Changes

- e1fda87: fix: 按审计待审清单处理（安全、功能、清理）

  **行为变更（升级前请阅读）**

  - kernel / core / zhin.js：出站文本中的 `${…}` 不再用 `vm` 求值，只替换 `TemplateContext` 上能解析到值的属性路径（如 `${sender.name}`）；表达式、函数调用、未知名字原样保留。整套 vm 沙箱（`evaluate` / `execute` / `compiler` / `getValueWithRuntime`）已移除。
  - kernel / core / zhin.js：移除零引用的遗留导出——`Scheduler`、错误管理器与 `ZhinError` 子类、`compose`、`segment.from/toString`、AI 触发/准入函数、`@zhin.js/core/queue-im-field-contract`、`zhin.js/contexts`。
  - agent：readonly 执行预设不再放行重定向、后台 `&`、进程替换、`find -delete/-exec`、`sed -i`、`sort -o`、`tee`、`xargs`、awk；curl/wget 校验每个 URL 与裸主机并识别更多上传参数；自定义 `execAllowlist` 中的只读命令带写入风险时改走审批。沙箱超时/取消会杀掉进程组或具名容器，默认镜像改为 `node:22-bookworm-slim` + `bash`。移除无生产调用的 `AuditLogger`、`AnomalyDetector`、旧 vision 回合等导出。
  - ai：移除 `storage`、`FileStateCache`、`CostTracker`、`model-name-utils`、`./agent-step-checkpoint` 子路径、`ContextManager` 及旧压缩管线；延迟工具快照改为有界 LRU。
  - cli：`zhin send` / `watch` / `schedule` 改为与运行中的 Host 通信（新增 `POST /message/send` 与 `/assistant/jobs` 写接口），`schedule` 不再支持离线改文件；移除 `zhin uninstall service`（用 `zhin service uninstall`）、`build --analyze`、`install -S`；`zhin stop` 杀不掉进程时保留 pid 文件并以非零退出；`runtime migrate` 新增 `verify`；未设置 `TZ` 时调度默认时区改为系统时区；不带 `ZHIN_SUPERVISOR_PID` 的进程被 init 接管后不再自行退出。
  - schedule：后台 reconcile 出错不再产生未处理 rejection（新增 `onStoreError`）；启动途中 `stop()` 不再遗留定时器。
  - schema：元组校验与 `safeParse`、JSON Schema 一致（空数组不通过，缺省的可选元组为 `undefined`）。
  - client / contract：删除无后端路由的 agent-stream API、未使用的 `definePage` 与旧 PageManager 类型；`@zhin.js/contract` 不再依赖 `@zhin.js/ai`；客户端收到 401 会清除已保存的凭据；安装/更新/卸载 RPC 默认超时 120 秒。
  - a2a：流式响应中途出错写入 SSE error 并结束；未配置 token 的非生产环境只接受本机请求；任务存储有上限与过期；Mailbox 凭据回退与生产环境缺密钥检查修复。
  - speech：`provider: openai` 不再套用 Ollama 的默认 host/model；识别语言改为可配置，不再写死 `zh`。
  - adapter-lark：支持 `encryptKey` 加密事件解密。adapter-github：Device Flow 可取消、带超时并回复失败原因。adapter-wecom / dingtalk：请求加超时并校验 HTTP 状态。adapter-weixin-ilink：输入关闭期间暂停轮询。adapter-milky：SSE 支持 CRLF、缓冲上限与空闲重连。adapter-onebot-events：好友删除通知改为 `notice.friend.decrease`。
  - plugin-group-suite：`teachAllowRegex` 默认关闭，正则安全检查更严格。plugin-qrcode：改为本地生成，回复 data URL 图片。plugin-rss / short-url / link-poster：拒绝解析到内网的地址；rss 修复条目每周重复推送；short-url 的 Console 创建改为真实调用 is.gd。plugin-lottery：按 `historyLimit` 同步。

  **其余**

  - host-http：插件市场详情加缓存与包名校验，SSE 回放容忍背压。host-http-contract：新增 `readTextBody()`，九个适配器改用它。
  - pagemanager：页面外壳 importmap 升级到 React 19.2.8 / react-router 7.12.0。console-contract：`definePage` 接受 `description` / `group` / `parent` / `fullWidth`。
  - command：进度提示本地化，匹配不再重复拷贝消息段。runtime：源码监听降级后退避重试原生监听。
  - html-renderer：删除未接线的 `aiTextAsImage`。create-zhin-app / scaffold-wizard：移除不起作用的"全局安装 CLI"与运行时选择提示。
  - 依赖声明清理、发布清单不再携带解析不到的 `src` 目录、移除未使用的 Skill 挂载、README 与示例配置按当前实现更正。

- a9c7a13: 聊天角色安全审查修复（ADR 0056 修订）：

  - 角色的作用范围：Runtime 在 `sender.chatRole` 之外写入 `sender.chatRoleLevels`（每个角色最高来自哪一层）。宿主全局能力——Agent 危险工具 / exec / 文件策略、主人审批的接收人、重启实例、写全局 / 平台记忆、定时任务的高信任运行、聊天改项目配置、`icqq login` 跨适配器恢复——只认**全局层** `owner`；增删适配器账号需要适配器层或以上的 `owner`。会话 / 账号 / 适配器层的 owner 在 Agent 信任档位上按 `admin` 计（`principal.roles`），链上角色保留在 `principal.chatRole` / `chatRoleLevels`。`@zhin.js/im-contract` / `@zhin.js/core` 新增 `chatRoleHeldAt`、`hostChatRole`、`ChatRoleLevels`。
  - permit 新增层级限定写法 `<角色>@<层级>`（`owner@global`、`owner@adapter`、`admin@endpoint`……，也可写在 `role(…)` 中）；不带层级的 `owner` 含义不变。
  - 聊天 `角色 授予 / 撤销`：被替换或撤销的已有角色同样计入「被触及的角色」，低角色的授予不能覆盖同级或更高的角色，触及 owner 需更高层 owner；`角色 列表` 需要 admin，上级条目不显示身份。
  - Console `chat-roles.grant|revoke`：涉及 owner（授予、替换、撤销）需要全局 `iam.manage`；`chat-roles.list` 对调用者作用域之外的条目脱敏（`redacted: true`，`ConsoleChatRoleEntry.adapter` / `userId` 变为可选）。
  - 非关系型数据库时授予 / 撤销被拒绝（RPC 503 `chat-roles-unpersisted`，聊天回复「未保存」）；迁移来的授予只在内存生效、记录保持 pending 并标记，不再「撤销后复活」。
  - 迁移保持旧语义：适配器 `master` 迁为「没有自己 master 的账号」的账号层 owner（不再建适配器层 owner）；`ai.trigger.masters / trusted` 不再登记到声明 `runtime.sandbox` 的模拟适配器与无法判断的适配器（写日志）。
  - 线程 / 子话题沿用父会话键：Discord 线程上报为父频道 + `threadId`（出站仍发到线程）；会话无法生成会话键时退回账号层链解析，全局 owner 不再丢失角色。
  - 执行时复检重新读取发言者当前角色与机器人身份（`PermissionHost.setSenderRoleResolver` / `currentSenderRoles`）；定时任务记录创建者所在会话，到期按创建者当前角色运行，普通用户的任务以普通成员信任运行。
  - `AdapterIndex.selfStanding` 的 `cachedOnly` 读到过期缓存视为未知；入站时丢弃适配器上报的 `chatRole`，事件流发布增强后的 sender。`@zhin.js/testing` 的 `PluginTestKit` 声明的角色按全局层处理。
  - 跨群 / 账号级 Agent 工具改用层级限定：钉钉 `add_chat_members` / `update_chat`、Slack `unarchive` 要求 `owner@global`；NapCat `delete_friend` 要求 `owner@endpoint`。

- 120e225: 聊天角色（ADR 0056，2026-11-12 修订）：zhin 角色 owner / admin / trusted 分四级、只来自授予；发言者的平台身份与机器人自身的平台身份是独立维度，命令、Agent 工具 / 技能、中间件与按钮按三条维度共用一个评估器过滤。升级说明见 docs/migrations/chat-roles.md。

  - zhin.js：实例首次启动把适配器 `master` / `trusted`、`endpoints[i].master|trusted` 与 `ai.trigger.masters|trusted` 迁入项目数据库 `chat_roles`（先记入 `.zhin/chat-roles-migration.json`，再从配置移除并记日志）；之后配置再出现这些字段时启动报错并指向升级指南。平台身份不再映射为 zhin 角色：删除 `roles.mappings`（适配器块与 `endpoints[i].roles` 出现即启动报错）、`chat_role_mappings` 表与 Console `chat-roles.mappings` / `chat-roles.set-mappings`；`features.selfService.platformAdmins|roles|allowUsers` 删除；群内「功能」「角色」命令只认 zhin 角色，平台群主不再自动具备；聊天改配置、聊天重启、Agent 主人审批按 zhin `owner` 判断。
  - @zhin.js/core（minor，破坏性）：角色模型与解析移入 core（`ChatRoleService`、`createChatRoleSenderEnricher`），入站消息带 `sender.chatRole` 与归一的 `sender.platform`；删除 `SenderRole`、`senderRolesFromMessage`、`roleSatisfies` 等，`master` 改名 `owner`；删除映射规则 API（`createMappingChatRoleSource`、`DEFAULT_CHAT_ROLE_MAPPINGS` 等）与 `ChatRoleSource`；`createSenderEnricher` / `createConfigurationChatAuthorizer` 改为基于聊天角色。IM Runtime 为 PermissionHost 提供机器人自身身份（经 Adapter 索引缓存），机器人的角色变化事件使缓存失效；命令拒绝回复说明缺少的平台 / 机器人条件；`<Button permit>` 按点击者鉴权；场景治理工具工厂同时要求 `platform:*` 与 `bot:*`；`ai.trigger.masters|trusted` 删除。
  - @zhin.js/permission（minor，破坏性）：permit 语法 `owner` / `admin` / `trusted` / `role(...)`（zhin 角色）、`platform:owner|admin`、`platform-role:<id>`、`platform-permission:<name>`（发言者平台身份），新增 `bot:owner|admin`、`bot-role:<id>`、`bot-permission:<name>`（机器人自身平台身份，`PermissionSubject.bot`）；`PermissionHost` 新增 `setBotStandingResolver`、`withBotStanding`、`firstDenied`，`checkAll` 可带 `source` 解析机器人身份；新增 `describeDeniedPermit`、`permitsNeedBotStanding`。删除 `role(master)`、`scene_admin`、`scene_owner`、`platform(adapter,perm)` 及 `registerPlatform`、`createSceneRolePlatformChecker`、`platformPermission`、`definePlatformPermission`，定义时报错并给出替代写法。
  - @zhin.js/command（minor，破坏性）：命令会话的发送者改为 `chatRole` / `platform`，不再从 metadata 读角色；`CONVERSATION_MANAGER_PERMIT` 改为 `admin`（平台群主不再自动满足）；分发结果 `denied` 带 `denial`（第一条不满足的规则与原因）；指令菜单只列出当前发送者在本会话可用的命令。
  - @zhin.js/agent（minor，破坏性）：危险工具、文件 / exec 策略、主人审批、Agent 回合主体只读 zhin 角色（`principal.roles` 只含展开的聊天角色，平台地位在 `principal.platform`）；`SenderRole` → `PrincipalRole`，`SELF_CHANGE_MASTER_ROLE` → `SELF_CHANGE_OWNER_ROLE`；回合开始时读取机器人自身身份（`contextState.bot.platform`），按三条维度过滤 tool / skill / Agent 包后才披露，执行工具时再校验一次；群规「群主和管理员豁免」改为平台群主 / 管理员与 zhin `owner`。
  - @zhin.js/feature-kit：`OperationSession.sender` 改为 `chatRole` / `platform`。
  - @zhin.js/im-contract：新增 `PlatformStanding`、`SelfStandingRequest`、`standingFromMemberRole`。
  - @zhin.js/adapter：入站 sender 可带 `platform`；账号管理命令需要聊天角色 `owner`；`EndpointManagement` 新增可选 `inspectSelfStanding`，能力画像新增 `scene.selfStanding`（声明即须实现），`AdapterIndex.selfStanding` / `invalidateSelfStanding` 按会话缓存机器人自身身份。
  - @zhin.js/middleware：入站中间件可声明 `permit`，不满足时跳过该中间件（机器人身份只读缓存）。
  - @zhin.js/tool：定义工具时拒绝已移除的 permit 写法。
  - @zhin.js/ai：注释更新。
  - @zhin.js/console-protocol：`chat-roles.list|grant|revoke`（`iam.manage`）；`ConsoleChatRoleSource` 只有 `grant`。
  - @zhin.js/runtime：Host 配置 Schema 删除 `features.selfService.platformAdmins|roles|allowUsers`。
  - @zhin.js/testing：伪造消息与 `PluginTestKit` 用 `sender.chatRole` 声明测试身份。
  - @zhin.js/scaffold-wizard：ICQQ 向导不再写 `master`，完成后提示在 Console 账号「角色」页签或聊天 `角色 授予` 设置 owner。
  - 适配器：配置 Schema 删除 `master` / `trusted`（以及预览版的 `roles`）；群管理类工具同时声明发言者条件与机器人条件（如 `platform:admin` + `bot:admin`、`bot-permission:manage_roles`），NapCat / OneBot11 工具不再使用已移除的 `platform(adapter,…)` 写法。
  - 插件：内容审核以 `inbound.bypass`（permit 列表，默认 `owner` 或 `platform:admin`）取代 `masters` / `inbound.bypassMasters`；群管、音乐、日历、地震、B 站、轮盘赌的权限改用 zhin 角色，订阅类命令只认 zhin `admin` / `owner`。

- eae4ea8: 官方插件接入分层功能配置（ADR 0050 / 0055）：所有带配置 Schema 的官方插件都声明全部四级（全局 / 适配器 / 账号 / 会话），Console 的适配器、账号与会话页面都能开关它们；密钥、调度与全局资源类字段收窄为仅全局。answers 与 group-suite 可按会话覆盖字段并开放群内自助字段（答题超时、科目一开关；欢迎语、排行条数、教学冷却与分页），ledger 的 `reportWhenEmpty` 可按订阅者会话覆盖。主动推送在发送前按目标会话检查开关：提醒（含管理员提醒）、日历授权通知、地震速报、记账日报、彩票推送、B 站开播 / 动态推送、activity-feedback 的状态提示在已停用的账号或会话上不再发送；roulette 的超时扫描在已停用的会话里静默结束对局（不结算、不禁言、不发消息）。`@zhin.js/schema` 新增 `.fieldLevels(levels)` 用于收窄单个字段的层级；`@zhin.js/testing` 的假插件上下文提供 `isEnabledFor` / `configFor`（`feature` 选项可模拟按会话停用与字段覆盖）。
- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。

## 1.0.9

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.

## 1.0.8

### Patch Changes

- bc6ccb1: Deep audit bug fixes and 7 architectural improvements:
  - Sink Agent Turn ingress pipeline from `@zhin.js/cli` into `@zhin.js/agent/runtime` (`plugin-runtime/ingress/`) and decompose `ingress-route.ts` into modular pipeline stages.
  - Bind Session State Plane (`JsxButtonRegistry`, `InteractionRuntime`, `RuntimeInteractiveRouter`) to `PluginIncarnationRef` so active buttons and interactions survive unrelated-plugin HMR while expiring when the owning plugin reloads, and support per-conversation fallback numbering (`numberingScope: 'conversation'`).
  - Establish `conversation_events` as the canonical message SSOT and reference `conversation_event_id`, `conversation_key`, `platform_message_id`, and `message_key` in `agent_messages` (`AGENT_MESSAGE_QUERY_VERSION = 2`), threading `conversationSequence` across inbound and outbound delivery receipts.
  - Push down `DatabaseContextRepository` and `DatabaseScheduleJobStorage` full-session/full-table memory scans to indexed SQL queries.
  - Add kernel-level inbound `replyTo` and `mentioned` auto-promotion (`promoteInboundMessagePayload`) plus reusable `InboundDeduper` and `TtlLookupCache` primitives in `@zhin.js/adapter`.
  - Add `MiddlewareContext.dispatch` (`InboundDispatchSummary`) and `onAfterDispatch` hooks for `after-dispatch` middlewares, and support incremental rendering of in-place `envelope.payload` array mutations in `OutboundDeliveryRuntime`.
  - Unify `HistoryWindowTracker` and `AgentCompactionRuntime` token/message budgets (`resolveUnifiedHistoryAndCompactionBudget`).
  - Fix schema validation, database transaction connection cleanup and SQLite WAL mode, schedule timer wheel head-of-line blocking, security policy bash read paths and subagent guard propagation, group merge window permission carrier handoff, micro-compact namespaced tool matching, and WebSocket force-close / inbound segment mapping across adapters.
- 72b5a12: Improve plugin authoring DX, operator/CLI onboarding, IM/AI chat UX, CI reliability, and documentation narrative across the workspace:

  - **Plugin Authoring DX**:
    - Compare `mtimeMs` between `src/*.ts` and compiled `lib/*.js` in native TypeScript development runtime so stale `lib/` build outputs never shadow newer source edits.
    - Support `@zhin.js/schema` `Schema.object()` directly in `defineAgentTool` (`inputSchema`) with full TypeScript type inference and default value population.
    - Allow equivalent `definePlugin({ config })` and `schema.json` to coexist without throwing `PluginConfigSourceConflictError`.
    - Add `.withConfig<TConfig>()` helpers to `defineMiddleware`, `defineHandler`, `defineComponent`, `defineSchedule`, and `defineMcp`, and expose `has(token)` on `CapabilityContext`.
    - Enhance `@zhin.js/testing` with `createFakeInteraction`, automatic positional/option default parsing in `runCommand`, and `$sendTo` / `$replyTo*` helpers on `FakeMessage`.
  - **CLI, Wizard & Local Sandbox UX**:
    - Automatically seed `ai.plan.yml` into the Host database on first startup when the inference graph is empty.
    - Add domestic and aggregator AI provider presets (`qwen` / DashScope, `siliconflow`, `volcengine`, `minimax`, `openrouter`) and automatic capability pre-filling in `@zhin.js/scaffold-wizard`.
    - Add `/sandbox?token=...` query bootstrap and header token input UI for zero-DevTools local sandbox debugging, plus `zhin start` alias and unset `${ENV_VAR}` config warnings.
  - **IM Command, Interactive Fallback & AI Chat UX**:
    - Reset per-conversation fallback button numbering once previous interactive prompts finish and ignore TTL-expired bare numeric messages in group chats.
    - Deduplicate numbered option lists in text-fallback `user-interaction` prompts.
    - Support out-of-the-box `菜单` / `帮助` / `help` / `menu` aliases, flattened root command menus (when ≤ 8 commands), `-h` help flag, distinct missing-parameter diagnostics, and `@Bot /cmd` mention stripping in group chats.
    - Preserve `<header>` / `<footer>` in HTML text fallback, format Markdown tables cleanly in plain-text fallback, bind tool approval prompts to master senders, and lower turn progress feedback interval to 15s.

- aa41889: Upgrade official business plugins with declarative Console pages & AI skills/tools, decompose core monolith modules, and polish scaffolding DX:

  - **Official Plugin Ecosystem Upgrade**: Add declarative Console pages (`pages/index/index.ts`), `definePluginConsoleRpc` handlers (`src/console.ts`), and progressive-disclosure AI skills/tools (`skills/<name>/tools/`) across `@zhin.js/plugin-ledger`, `@zhin.js/plugin-reminder`, `@zhin.js/plugin-rss`, `@zhin.js/plugin-calendar`, `@zhin.js/plugin-group-suite`, `@zhin.js/plugin-content-moderation`, `@zhin.js/process-monitor`, and `@zhin.js/plugin-game-hub`.
  - **Core Monolith Decomposition**: Decompose 9 core monolith modules (`agent-core-run.ts`, `full-agent-turn-engine.ts`, `ingress-route.ts`, `request.ts`, `root-runtime.ts`, `account-runtime.ts`, `page-renderer.ts`, `console-rpc.ts`, and `console-rest-pages.ts`) into cohesive, acyclic submodules (`< 620` lines each) while preserving 100% of public exports.
  - **Scaffolding & First-Screen DX**: Upgrade `create-zhin-app` and `@zhin.js/scaffold-wizard` to generate declarative `ConsolePageBlueprint` homepages and `definePluginConsoleRpc` status/ping endpoints in both `zh-CN` and `en`; upgrade `zhin new` (`@zhin.js/cli`) to include `pages/` and compile progressive-disclosure tools under `skills/**/tools/` and `agents/**/tools/`.

## 1.0.7

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

## 1.0.6

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。

## 1.0.5

### Patch Changes

- 5be09ae: Stop installing a second Zhin stack next to the plugin's own `zhin.js` (#899). `@zhin.js/testing` no longer pins exact versions of `@zhin.js/core`, `@zhin.js/runtime`, `@zhin.js/plugin-runtime`, `@zhin.js/adapter` and the other `@zhin.js/*` packages. It resolves them through the plugin's `zhin.js` (`zhin.js`, `zhin.js/plugin-runtime`, `zhin.js/core/runtime`, `zhin.js/command`, …) and declares `zhin.js`, `@zhin.js/runtime` and `@zhin.js/tool` as peer dependencies. A standalone plugin with both `zhin.js` and `@zhin.js/testing` now installs every `@zhin.js/*` package once with pnpm and npm, so the Runtime no longer fails with `Multiple package locations … are not supported in one generation`, and tests run on the same stack as a real bot. `@zhin.js/command` is no longer a separate peer; it comes from `zhin.js`.

  Migration: pnpm and npm (7+) install the peers automatically, so nothing changes there. With a package manager that does not install peers (yarn 1, or pnpm with `auto-install-peers=false`), add them yourself: `yarn add -D zhin.js @zhin.js/runtime @zhin.js/tool @zhin.js/testing`. Upgrade `@zhin.js/testing` together with `zhin.js`: the kit requires a `zhin.js` at least as new as the one released with it, and with an older one npm stops with `ERESOLVE` while pnpm reports an unmet peer.

- c5741c0: `@zhin.js/command` 从 `dependencies` 改为 `peerDependencies`：测试工具使用插件自己（经 `zhin.js`）安装的那一份，独立插件不再装出第二份。pnpm / npm 会自动安装 peer，无需改动；yarn 1 等不自动安装 peer 的项目需要执行一次 `yarn add -D @zhin.js/command`。
- c5741c0: `runCommand(fake, definition, { source })`：传入命令的 `commands/.../index.ts`（路径或 `new URL(..., import.meta.url)`）时，先走运行时同一套约定路径校验（新导出的 `bindCommandSource`），`commands/term/[word]/[...definition]` 这类运行时会拒绝的布局在单测里也会报错；不传 `source` 行为不变。`zhin new` 生成的测试默认传 `source`。
- d3563d9: Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
- b15c86b: `PluginTestKit` accepts a file-backed configuration (`createConfigDocument(path)`) as `config`, so tests share the same file authority as `zhin start` (saved vs applied config, `config:explain`, reload of the config file). Adds end-to-end smoke scenarios for literal-choice config forms, `config:explain` and structured replies.

  `@zhin.js/agent` evals gain a structured-reply seed case (mention + text segments) that the nightly real-model run replays under the existing request budget.

- 37dc280: `PluginTestKit` exposes `messageDiagnostics`, the same body-free reader the Console serves at `GET /api/messages/diagnostics`, so integration tests can assert route, dispatch status and delivery outcomes. Adds the first end-to-end smoke scenarios for the #829 loop (v1 → v2 migration, boot, diagnostics API, scenario-lab export).
- 8822cae: `PluginTestKit` exposes `snapshots`, the committed-snapshot authority Console routes read, so integration tests can mount real Console routes such as the task center. Adds end-to-end smoke scenarios for command admission, `welcomeConversations`, natural-time reminders with the task center, and RSS quiet hours on a fake clock.
- ec1dea1: `FakeClock.advance()` now moves the clock to each firing instant before running the jobs due at that instant, so a scheduled job that reads `clock.now()` sees the time it fired at instead of the time `advance()` started from.
- e9e10ce: `FakeClock.advance()` 在某个 cron 任务抛错时仍会把时钟停在目标时间（try/finally）；该窗口内剩余未执行的任务会被跳过而不是延后补跑，错误照常向上抛出。
- 6f05209: 新增 `runTool` / `createToolContext` / `toolOriginFromMessage`，可以在单元测试里运行 Agent 工具。执行方式与运行时的工具索引一致：可执行 `inputSchema` 先解析输入，绑定 `adapter` 的工具必须传匹配的 `client`。传 `message` 时，`origin` 和 `principal` 从假消息推导。

  **行为变化**：插件声明了 `config` schema 时，`runPluginSetup` 现在会像运行时一样校验 `config`、填充默认值，并且只保留 schema 顶层声明的字段。不合法时抛出 `PluginConfigValidationError`。新增 `resolvePluginConfig(definition, input)`。

  迁移：如果某个测试故意传了不合法或不完整的配置，先补齐配置；或者给这个测试加上 `runPluginSetup(plugin, { config, validateConfig: false })`，恢复原来"原样传入"的行为。没有声明 `config` 的插件，以及 `createFakePlugin` / `fake.setup()`，都不受影响。

  Added `runTool` / `createToolContext` / `toolOriginFromMessage` for unit-testing Agent tools. Behaviour change: when the plugin declares a `config` schema, `runPluginSetup` now validates and defaults `config` like the Runtime does (throws `PluginConfigValidationError`). To keep the old verbatim behaviour, pass `validateConfig: false`.

## 1.0.4

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [2b4d6dc]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [8550f17]
- Updated dependencies [7edd04c]
  - @zhin.js/command@1.1.8
  - @zhin.js/core@1.1.46
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/runtime@1.1.9
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/handler@1.1.6
  - @zhin.js/adapter@1.1.20
  - @zhin.js/middleware@1.1.7

## 1.0.3

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45
  - @zhin.js/runtime@1.1.8

## 1.0.2

### Patch Changes

- b947298: testing 新增类型化的假运行环境：`createFakePlugin` / `runPluginSetup` 提供真实 Scope 与内存版数据库、定时（可控时钟）、出站记录，`runCommand` / `runMiddleware` / `runHandler` 直接执行约定目录里的定义，`fakeOf` 取代 `as never`。activity-feedback 的测试已迁移。

  包名由 `@zhin.js/plugin-test-kit` 改为 `@zhin.js/testing`（目录 `packages/toolkit/testing`）。旧名 `@zhin.js/plugin-test-kit` 不再更新，请改用新包；API 与 `PluginTestKit` 类名不变。

- Updated dependencies [a64716a]
- Updated dependencies [0c35b96]
- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/runtime@1.1.7
  - @zhin.js/adapter@1.1.19
  - @zhin.js/command@1.1.7
  - @zhin.js/core@1.1.44
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/handler@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/middleware@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.0.1

### Patch Changes

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- Updated dependencies [9891e66]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [7d2263c]
- Updated dependencies [7d2263c]
- Updated dependencies [a62acca]
- Updated dependencies [386150d]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/core@1.1.43
  - @zhin.js/runtime@1.1.6
  - @zhin.js/plugin-runtime@1.1.13
