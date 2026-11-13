# @zhin.js/adapter-email

## 1.1.27

### Patch Changes

- 57c6cdc: fix: 全仓审计修复

  - kernel: 模板求值沙箱不再泄漏宿主对象——宿主函数的返回值与抛出的错误会重新包裹代理（`segments.map(x=>x).constructor.constructor(...)` 之前可拿到宿主 `Function`），并禁止通过代理写入/删除宿主属性。
  - agent: exec 白名单正则按整体锚定（`git|npm` 不再匹配 `gitevil`）；SSRF 主机名黑名单识别尾点形式（`localhost.`）；Docker 沙箱 `always` 模式的 fail-closed 分支可被触达；声明缺失的 `chalk` 依赖。
  - ai: 摘要按最新优先加载（超过 500 条时不再使用过期锚点）；修复 `test` 脚本指向不存在的配置。
  - cli: `ZHIN_LOG_LEVEL` 生效（修复运算符优先级）；移除旧守护进程遗留的无引用进程辅助函数。
  - logger: `formatCompact` 不再把 `config: 'yaml'`、`direction: 'in'` 这类非路径值改写成 `./yaml`。
  - host-http: 未配置数据库时 `db:tables` 与有数据库时一致返回 `{ tables }`。
  - a2a: 405 响应把 `Allow` 放进响应头。
  - pagemanager: 内联进 `<script>` 的页面元数据转义 `<`。
  - client: 事件历史请求失败时携带 HTTP 状态，token 失效可触发重新登录。
  - scaffold-wizard / create-zhin-app: 修正适配器文档 URL 与模板里的 `@zhin.js/tool` 导入。
  - adapter-wechat-mp: 签名比较改为常量时间。
  - adapter-kook: 声明运行时依赖 `ws`。
  - plugin-lottery: 遗漏值按最近一次出现计算；推送目标 schema 字段与实现一致（`endpointKey`）。
  - plugin-code-runner: 语言校验改用自有属性判断。
  - plugin-link-poster: 抓取前校验主机名白名单（修复 SSRF），超时覆盖响应体读取。
  - 其余包：从 `files` 中移除不存在的目录。
  - feature-kit / middleware: 修正 README 中层级错误的文档链接。

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

- Updated dependencies [53932e5]
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [fd055d2]
- Updated dependencies [c2bbdcf]
- Updated dependencies [663473b]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
- Updated dependencies [d655ef0]
- Updated dependencies [1e54b1e]
  - @zhin.js/adapter@1.1.33
  - @zhin.js/core@1.2.0
  - @zhin.js/logger@1.1.3
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/console-contract@1.1.6
  - @zhin.js/im-contract@1.1.14
  - @zhin.js/page@1.1.18

## 1.1.26

### Patch Changes

- 0d76a7c: Overhaul Console interactive workbenches, platform-specific adapter account onboarding/login flows, DeclarativePageView visual/interactive capabilities, and official utility plugin Console pages.
- Updated dependencies [0d76a7c]
  - @zhin.js/adapter@1.1.32
  - @zhin.js/core@1.1.60

## 1.1.25

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/console-contract@1.1.5
  - @zhin.js/core@1.1.59
  - @zhin.js/page@1.1.17
  - @zhin.js/adapter@1.1.31
  - @zhin.js/feature-kit@1.1.15
  - @zhin.js/skill@1.1.16

## 1.1.24

### Patch Changes

- cbf1fb1: Unify Console page blueprints (`definePageBlueprint`, `defineAdapterPage`, `defineCommentReviewPage`, `projectBlueprintToImCard`, `projectBlueprintToCliPanel`) into `@zhin.js/console-contract` and `@zhin.js/page`, add zero-esbuild pure Blueprint synthesis + static client bundle mounting to `@zhin.js/pagemanager`, remove `@zhin.js/client` (React 19) and `.tsx` from all 30 server-side plugins and adapters (including `bilibili` and `juejin`), and remove legacy Era-1 Koa `PageManager` code.
- Updated dependencies [cbf1fb1]
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
  - @zhin.js/console-contract@1.1.4
  - @zhin.js/page@1.1.16
  - @zhin.js/core@1.1.58
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/adapter@1.1.30
  - @zhin.js/feature-kit@1.1.14
  - @zhin.js/skill@1.1.15

## 1.1.23

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
- Updated dependencies [4427e72]
- Updated dependencies [22bd14a]
  - @zhin.js/core@1.1.57
  - @zhin.js/client@1.1.25
  - @zhin.js/page@1.1.15
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/adapter@1.1.29
  - @zhin.js/feature-kit@1.1.13
  - @zhin.js/skill@1.1.14

## 1.1.22

### Patch Changes

- 41ff1a5: ADR 0044 C5: every official adapter now declares a capability `profile` (its `segments` moved into `profile.default.messaging.segments`). icqq declares the complete profile (per conversation kind: scene, all 14 actions with real limits, events, feedback, delivery) and implements the seven new management ports (`pokeUser`, `unmuteGroupMember`, `muteAllGroupMembers`, `setGroupCard`, `setGroupTitle`, `setGroupEssence`, `inviteGroupMember`) with fresh bot-role reads. qq official declares its passive reply windows; undeclared capabilities stay unsupported.
- cbd3f14: ADR 0044 integration and C6 guard. `delivery.spool` now reproduces the pre-0044 media rule (icqq `false`, every other official adapter `true`). icqq narrows `actions.recall.others` unless the Bot is admin or owner, and declares recall for groups. Endpoint kind capabilities merge the Endpoint's `operations` (Discord reactions keep working; Discord declares reaction feedback). Adapters in the `@zhin.js/` scope are trusted: their custom prompt text is not labelled `external_content`. Core no longer keeps a telegram/discord interactive-policy table (adapters declare `segments.interactive`). New `pnpm check:no-platform-branches` blocks platform-name branches in runtime code.
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [4fe49b5]
- Updated dependencies [cce07db]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/adapter@1.1.28
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/skill@1.1.13
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/client@1.1.24
  - @zhin.js/page@1.1.14

## 1.1.21

### Patch Changes

- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- Updated dependencies [b88e988]
- Updated dependencies [f78eb84]
- Updated dependencies [c15cef9]
- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/adapter@1.1.27
  - @zhin.js/client@1.1.23
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/core@1.1.55
  - @zhin.js/page@1.1.13
  - @zhin.js/feature-kit@1.1.11
  - @zhin.js/skill@1.1.12

## 1.1.20

### Patch Changes

- Updated dependencies [5e878ba]
  - @zhin.js/page@1.1.12

## 1.1.19

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

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
  - @zhin.js/adapter@1.1.26
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/core@1.1.54
  - @zhin.js/client@1.1.22
  - @zhin.js/page@1.1.11
  - @zhin.js/skill@1.1.11

## 1.1.18

### Patch Changes

- 6345a38: feat(adapters): add per-adapter Console pages

  Every platform adapter now ships a `pages/index` Console page backed by a shared
  `createAdapterConsolePage` component and `createAdapterConsoleRpc` server helper:

  - See running endpoints, test connectivity, and manage
    `plugins.<adapter>.endpoints` (add/remove writes `.env` references) from the
    Console instead of chat commands.
  - Surface LoginAssist pending tasks (QR / slider / SMS / device) so ICQQ login no
    longer requires the terminal.
  - QQ moves its QR binding flow (`qq endpoint add`) into Console actions with
    public/private selection.
  - Pages are permission-gated by `<adapter>:read`; writes need `<adapter>:write`.

- Updated dependencies [6345a38]
- Updated dependencies [ff3efe7]
- Updated dependencies [c58c589]
  - @zhin.js/adapter@1.1.25
  - @zhin.js/client@1.1.21
  - @zhin.js/core@1.1.53
  - @zhin.js/im-contract@1.1.9

## 1.1.17

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [e23cabc]
- Updated dependencies [4d728c0]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/adapter@1.1.24
  - @zhin.js/im-contract@1.1.8

## 1.1.16

### Patch Changes

- 53bc6a0: 适配器配置标签、端点命令和工具反馈支持中英文；复用当前操作语言，保持协议值、用户内容、身份、权限与发送链路不变。Sandbox 展示使用项目语言，QQ 绑定与交互状态保留完整会话身份。
- 7595136: Upgrade `nodemailer` to 10.1.4+ and `js-yaml` to 5.4.1+ to clear security advisories.
- Updated dependencies [334e92d]
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/adapter@1.1.23
  - @zhin.js/core@1.1.51
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7
  - @zhin.js/feature-kit@1.1.9

## 1.1.15

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/core@1.1.50
  - @zhin.js/adapter@1.1.22
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/skill@1.1.9

## 1.1.14

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49

## 1.1.13

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.12

### Patch Changes

- fbfefb7: Share segments accept `data.platform` (the song's music service: qq, netease, kugou, kuwo, migu). icqq maps it to the matching music app id when `config.appid` is absent and offers it to the Agent; adapters that cannot render share app metadata reject it like `audio` and `config`.
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [c618eb7]
- Updated dependencies [fbfefb7]
  - @zhin.js/core@1.1.47
  - @zhin.js/adapter@1.1.21
  - @zhin.js/feature-kit@1.1.7
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/skill@1.1.8

## 1.1.11

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [064b06d]
  - @zhin.js/core@1.1.46
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/adapter@1.1.20
  - @zhin.js/skill@1.1.7

## 1.1.10

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/core@1.1.45

## 1.1.9

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/adapter@1.1.19
  - @zhin.js/core@1.1.44
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/skill@1.1.6
  - @zhin.js/logger@1.1.2

## 1.1.8

### Patch Changes

- Updated dependencies [9891e66]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/core@1.1.43
  - @zhin.js/feature-kit@1.1.4
  - @zhin.js/skill@1.1.5

## 1.1.7

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42

## 1.1.6

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
  - @zhin.js/core@1.1.41
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/adapter@1.1.17
  - @zhin.js/skill@1.1.4

## 1.1.5

### Patch Changes

- b9b3953: Use the shared endpoint lifecycle for IMAP recovery, settle startup on stop, and isolate retired transport/fetch callbacks. Keep polling admission in flight through MIME parsing and dispatch; deduplicate completed mailbox/UIDVALIDITY/UID admissions within a bounded instance cache and permit failed admission retry. Document markSeen, restart and uncertain SMTP delivery boundaries.

  Require SMTP recipient acceptance evidence instead of confirming a locally generated Message-ID alone. Map explicit SMTP rejection safely and preserve partial/network outcomes as delivery-unconfirmed without retry. Reject unmapped canonical reply/unknown segments before SMTP instead of silently dropping them.

- b9b3953: Report observed IMAP readiness and connection loss in endpoint health, and log successful SMTP verification plus IMAP startup at info level.

  Normalize incoming sender identities to mailbox addresses so display names do not prevent conversation allowlist matching. Start unread-mail polling only after the endpoint opens, avoiding startup consumption before admission is available.

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/adapter@1.1.16
  - @zhin.js/im-contract@1.1.3
  - @zhin.js/core@1.1.40
  - @zhin.js/skill@1.1.3

## 1.1.4

### Patch Changes

- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39
  - @zhin.js/adapter@1.1.15

## 1.1.3

### Patch Changes

- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/core@1.1.38
  - @zhin.js/adapter@1.1.15
  - @zhin.js/feature-kit@1.1.2
  - @zhin.js/skill@1.1.2

## 1.1.2

### Patch Changes

- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- 0ae758a: Require the canonical expanded Email endpoint configuration. The protocol no longer reinterprets nested `endpoints` or reads endpoint identity from `process.env`. The public config type is now `EmailEndpointConfig`, and the schema now exposes the complete per-endpoint IMAP and command configuration.
- 5c3858e: Make `@zhin.js/im-contract` the explicit zero-dependency owner of transport identities, canonical segments, media guards, conversation facts, stores, and delivery contracts. Platform adapters now read media contracts from that foundation instead of reaching through Core.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [cd54131]
- Updated dependencies [a9e4a40]
- Updated dependencies [5855db7]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [25a845a]
- Updated dependencies [9110ab8]
- Updated dependencies [eb3227a]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [73a24b7]
- Updated dependencies [1cb1163]
- Updated dependencies [be3061e]
- Updated dependencies [75f8332]
- Updated dependencies [81935e2]
- Updated dependencies [f9ed01b]
- Updated dependencies [ac0ab50]
- Updated dependencies [5140ce1]
- Updated dependencies [522d75f]
- Updated dependencies [a7611b3]
- Updated dependencies [8823044]
- Updated dependencies [379439b]
- Updated dependencies [11c9352]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [df9f76b]
  - @zhin.js/core@1.1.37
  - @zhin.js/adapter@1.1.14
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/skill@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/im-contract@1.1.1

## 1.1.1

### Patch Changes

- 33b1582: Update vulnerable dependencies and replace unsafe HTML and protocol-text regular expressions with bounded scanners.
- Updated dependencies [769e67f]
  - @zhin.js/adapter@1.1.13
  - @zhin.js/core@1.1.36

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/adapter@1.1.12
  - @zhin.js/core@1.1.35
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/logger@1.1.0

## 7.0.1

### Patch Changes

- Updated dependencies [f7ee28d]
  - @zhin.js/adapter@1.2.2
  - @zhin.js/core@1.5.16
  - zhin.js@7.0.1

## 7.0.0

### Patch Changes

- zhin.js@7.0.0

## 6.0.2

### Patch Changes

- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - zhin.js@6.0.15

## 6.0.1

### Patch Changes

- e9c6a73: Ignore late disconnect events from replaced IMAP transports so reconnect does not leak duplicate connections.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [4e8117c]
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/adapter@1.2.1
  - @zhin.js/core@1.5.14
  - @zhin.js/logger@1.0.77
  - zhin.js@6.0.14
  - @zhin.js/feature-kit@1.0.13

## 6.0.0

### Patch Changes

- Updated dependencies [f2c532f]
  - @zhin.js/adapter@1.2.0
  - @zhin.js/core@1.5.13
  - zhin.js@6.0.13

## 5.0.12

### Patch Changes

- 5969c5b: Add SideEventGateway so adapters forward notice/request/system into HandlerIndex. HandlerContext now exposes only generation-safe capabilities and prompt ports; live Endpoint escape hatches are removed.
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/core@1.5.12
  - @zhin.js/adapter@1.1.11
  - zhin.js@6.0.12

## 5.0.11

### Patch Changes

- @zhin.js/core@1.5.11
- zhin.js@6.0.11

## 5.0.10

### Patch Changes

- eb84b77: fix: 更新文档,建立正确的依赖关系
- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - zhin.js@6.0.10
  - @zhin.js/adapter@1.1.10

## 5.0.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/adapter@1.1.9
  - zhin.js@6.0.9

## 5.0.8

### Patch Changes

- Updated dependencies [63253bb]
- Updated dependencies [8e973dc]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/adapter@1.1.8
  - zhin.js@6.0.8

## 5.0.7

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - zhin.js@6.0.7

## 5.0.6

### Patch Changes

- @zhin.js/adapter@1.1.7
- @zhin.js/core@1.5.6
- zhin.js@6.0.6

## 5.0.5

### Patch Changes

- @zhin.js/adapter@1.1.7
- @zhin.js/core@1.5.5
- zhin.js@6.0.5

## 5.0.4

### Patch Changes

- Updated dependencies [c106ecc]
- Updated dependencies [b0f37ae]
- Updated dependencies [ba08a2f]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [162fa34]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/adapter@1.1.7
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - zhin.js@6.0.4

## 5.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/adapter@1.1.6
  - @zhin.js/core@1.5.3
  - @zhin.js/im-contract@1.0.2
  - @zhin.js/plugin-runtime@1.1.4
  - zhin.js@6.0.3

## 5.0.2

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
- Updated dependencies [9f57124]
  - @zhin.js/core@1.5.2
  - @zhin.js/adapter@1.1.5
  - @zhin.js/im-contract@1.0.1
  - @zhin.js/plugin-runtime@1.1.3
  - zhin.js@6.0.2

## 5.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/adapter@1.1.4
  - @zhin.js/core@1.5.1
  - zhin.js@6.0.1

## 5.0.0

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
- Updated dependencies [5b94d9c]
  - @zhin.js/adapter@1.1.3
  - @zhin.js/core@1.5.0
  - zhin.js@6.0.0

## 4.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - zhin.js@5.0.3

## 4.0.2

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

  - zhin.js@5.0.2
  - @zhin.js/adapter@1.1.2
  - @zhin.js/core@1.4.2

## 4.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- Updated dependencies [cdf64e7]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [9c997b2]
- Updated dependencies [09d4f25]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - zhin.js@5.0.1
  - @zhin.js/adapter@1.1.1
  - @zhin.js/core@1.4.1

## 4.0.0

### Patch Changes

- 7db69c1: 命令前缀改为适配器配置项：`MessageDispatcher` 不再硬编码 `/`，默认按消息所属适配器实例 config 的 `commandPrefix` 解析（默认 `''` 无前缀，任意文本按命令匹配），`endpoints[i].commandPrefix` 逐项覆盖；`ImRuntime({ commandPrefix })` 仍可设全局静态前缀。全部 20 个平台适配器 schema 新增 `commandPrefix` 属性。

  BREAKING（行为变化）：未配置时命令不再需要 `/` 前缀——原 `/zt` 写法不再命中，直接发 `zt` 即可；需要斜杠风格的适配器请在配置里显式设 `commandPrefix: '/'`。

- 713445c: 适配器配置格式定稿（不兼容旧格式）：`plugins.<adapter>` 顶层仅共享字段 + `commandPrefix`，`endpoints[i]` 携带 endpoint 级字段（`name` + 凭据，各 schema 已类型化），`endpoints` 为必填（icqq 另需顶层 `master`）；icqq 新增 `trusted` 列表（顶层/逐项均可）。scaffold-wizard 全部字段式与自定义 configure() 产出改为新格式，examples（full-bot / qq-games-bot）与 20 个适配器 README 同步迁移。
- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/adapter@1.1.0
  - @zhin.js/plugin-runtime@1.1.0
  - zhin.js@5.0.0

## 3.0.3

### Patch Changes

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

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - zhin.js@4.1.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/adapter@1.0.1

## 3.0.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - zhin.js@4.1.2

## 3.0.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- b9b3881: fix: 增加游戏引擎以及部分游戏
- Updated dependencies [5cc9c03]
- Updated dependencies [7700903]
  - zhin.js@4.1.1

## 3.0.0

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - zhin.js@4.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [ae5239c]
  - zhin.js@4.0.1

## 2.0.0

### Patch Changes

- zhin.js@3.0.0

## 1.0.1

### Patch Changes

- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - zhin.js@2.0.1

## 1.0.0

### Patch Changes

- zhin.js@2.0.0

## 0.1.79

### Patch Changes

- Updated dependencies [d8547d2]
  - zhin.js@1.0.92

## 0.1.78

### Patch Changes

- Updated dependencies [3735e96]
  - zhin.js@1.0.91

## 0.1.77

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
  - zhin.js@1.0.90

## 0.1.76

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - zhin.js@1.0.89

## 0.1.75

### Patch Changes

- Updated dependencies [ccb6e24]
  - zhin.js@1.0.88

## 0.1.74

### Patch Changes

- 90d9efd: fix: 处理包名
  - zhin.js@1.0.87

## 0.1.73

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [7e14f8d]
  - zhin.js@1.0.86

## 0.1.72

### Patch Changes

- zhin.js@1.0.85

## 0.1.71

### Patch Changes

- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
  - zhin.js@1.0.84

## 0.1.70

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - zhin.js@1.0.83

## 0.1.69

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - zhin.js@1.0.82

## 0.1.68

### Patch Changes

- Updated dependencies [8086ccb]
  - zhin.js@1.0.81

## 0.1.67

### Patch Changes

- zhin.js@1.0.80

## 0.1.66

### Patch Changes

- zhin.js@1.0.79

## 0.1.65

### Patch Changes

- zhin.js@1.0.78

## 0.1.64

### Patch Changes

- zhin.js@1.0.77

## 0.1.63

### Patch Changes

- Updated dependencies [cb9fbf1]
  - zhin.js@1.0.76

## 0.1.62

### Patch Changes

- zhin.js@1.0.75

## 0.1.61

### Patch Changes

- Updated dependencies [c9dec38]
  - zhin.js@1.0.74

## 0.1.60

### Patch Changes

- f1e9a76: fix: 提高 skill 质量
  - zhin.js@1.0.73

## 0.1.59

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - zhin.js@1.0.72

## 0.1.58

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - zhin.js@1.0.71

## 0.1.57

### Patch Changes

- zhin.js@1.0.68

## 0.1.56

### Patch Changes

- zhin.js@1.0.67

## 0.1.55

### Patch Changes

- zhin.js@1.0.66

## 0.1.54

### Patch Changes

- zhin.js@1.0.65

## 0.1.53

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - zhin.js@1.0.64

## 0.1.52

### Patch Changes

- ba30934: fix: web 优化
  - zhin.js@1.0.63

## 0.1.51

### Patch Changes

- zhin.js@1.0.62

## 0.1.50

### Patch Changes

- zhin.js@1.0.61

## 0.1.49

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - zhin.js@1.0.60

## 0.1.48

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - zhin.js@1.0.59

## 0.1.47

### Patch Changes

- zhin.js@1.0.58

## 0.1.46

### Patch Changes

- zhin.js@1.0.57

## 0.1.45

### Patch Changes

- zhin.js@1.0.56

## 0.1.44

### Patch Changes

- zhin.js@1.0.55

## 0.1.43

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - zhin.js@1.0.54

## 0.1.42

### Patch Changes

- zhin.js@1.0.53

## 0.1.41

### Patch Changes

- a3511a0: 各包内 Agent 技能说明已固定为随包发布的 `skills/*/SKILL.md`（替代已移除的运行时 `declareSkill`）。本批为 registry / 分发侧对齐的 **patch** 版本递增。

## 0.1.40

### Patch Changes

- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - zhin.js@1.0.52

## 0.1.39

### Patch Changes

- zhin.js@1.0.51

## 0.1.38

### Patch Changes

- zhin.js@1.0.50

## 0.1.37

### Patch Changes

- zhin.js@1.0.49

## 0.1.36

### Patch Changes

- zhin.js@1.0.48

## 0.1.35

### Patch Changes

- Updated dependencies [de3e352]
  - zhin.js@1.0.47

## 0.1.34

### Patch Changes

- Updated dependencies [7394603]
  - zhin.js@1.0.46

## 0.1.33

### Patch Changes

- zhin.js@1.0.45

## 0.1.32

### Patch Changes

- zhin.js@1.0.44

## 0.1.31

### Patch Changes

- Updated dependencies [72ec4ba]
  - zhin.js@1.0.43

## 0.1.30

### Patch Changes

- zhin.js@1.0.42

## 0.1.29

### Patch Changes

- zhin.js@1.0.41

## 0.1.28

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - zhin.js@1.0.40

## 0.1.27

### Patch Changes

- zhin.js@1.0.39

## 0.1.26

### Patch Changes

- Updated dependencies [ab5c54a]
  - zhin.js@1.0.38

## 0.1.25

### Patch Changes

- zhin.js@1.0.37

## 0.1.24

### Patch Changes

- zhin.js@1.0.36

## 0.1.23

### Patch Changes

- zhin.js@1.0.35

## 0.1.22

### Patch Changes

- zhin.js@1.0.34

## 0.1.21

### Patch Changes

- zhin.js@1.0.33

## 0.1.20

### Patch Changes

- zhin.js@1.0.32

## 0.1.19

### Patch Changes

- zhin.js@1.0.31

## 0.1.18

### Patch Changes

- Updated dependencies [460a6c6]
  - zhin.js@1.0.30

## 0.1.17

### Patch Changes

- zhin.js@1.0.29

## 0.1.16

### Patch Changes

- zhin.js@1.0.28

## 0.1.15

### Patch Changes

- Updated dependencies [b27e633]
  - zhin.js@1.0.27

## 0.1.14

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - zhin.js@1.0.26

## 0.1.13

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - zhin.js@1.0.25

## 0.1.12

### Patch Changes

- zhin.js@1.0.24

## 0.1.11

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - zhin.js@1.0.23

## 0.1.10

### Patch Changes

- Updated dependencies [26aba27]
  - zhin.js@1.0.22

## 0.1.9

### Patch Changes

- zhin.js@1.0.21

## 0.1.8

### Patch Changes

- a3b7673: fix: 调整依赖项
- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [5141137]
  - zhin.js@1.0.20

## 0.1.7

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - zhin.js@1.0.19

## 0.1.6

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - zhin.js@1.0.18

## 0.1.5

### Patch Changes

- f9e75ce: fix: 一致性调整,文档调整
- f9e75ce: fix: recall,文档统一,mcp,githubnotifiy
  - zhin.js@1.0.15

## 0.1.4

### Patch Changes

- 547028f: fix: 优化包结构,优化客户端支持
- Updated dependencies [547028f]
  - @zhin.js/types@1.0.5
  - zhin.js@1.0.14

## 0.1.3

### Patch Changes

- c490260: fix: 更新脚手架结构,优化包依赖
  - zhin.js@1.0.9

## 0.1.2

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/types@1.0.3
  - zhin.js@1.0.8

## 0.1.1

### Patch Changes

- 89bc676: fix: 类型反射优化
- Updated dependencies [89bc676]
  - @zhin.js/types@1.0.2
  - zhin.js@1.0.3
