# @zhin.js/command

## 1.3.0

### Minor Changes

- 7cd299e: 指令执行中抛出的「面向用户」的拒绝不再被静默吞掉（#1250）：`@zhin.js/command` 新增 `UserFacingError`（及 `isUserFacingError` / `userFacingErrorText`，经 `zhin.js/command` 导出），指令分发把它转成该指令的回复，经正常出站链（`$reply`）发出，按发送者语言调用 `format(locale)`；其他错误照旧抛给入站运行时记录日志，不把错误信息或堆栈回给用户。`GameSessionConflictError` 改为继承 `UserFacingError`，群里已有一局「guess」时发「rps 开始」会收到「你在当前频道已有进行中的「guess」对局…」，不再只在适配器日志里出现 `sandbox_gateway_receive_failed`。
- 9026329: 未命中的消息首词与已注册指令名 / 别名高度相似时（私聊、@机器人或带指令前缀；忽略大小写与 `-` / `_` / 空格，默认 1 次编辑且名称至少 5 个字符或 3 个汉字），经正常回复链直接回复「没有这个指令，你是不是想用：X、Y」，不再交给 AI 编造指令名（#1250）。只列出发送者有权使用的指令；根配置 `commandSuggestion: false` 关闭，`{ maxDistance, limit }` 调整。Agent 提示在有指令菜单时引导模型不确定就让用户发送菜单，而不是猜指令名。

  只有带指令前缀的消息才按首词命名空间匹配（`/rss foo` → `rss-list`）；私聊与 @机器人 但未带前缀时，只匹配与指令名本身相近、且简短像指令的消息（不含「是什么 / 怎么 / 吗 / 啥 / ？」等疑问词或问号，名称后只跟指令声明的参数），所以「rss 是什么」「process 太慢了」之类的问题仍交给 AI。

### Patch Changes

- 7cd299e: 指令菜单降噪（#1250）：「子插件」只列出子树里有当前发送者可用指令的插件，不再列出适配器（如 icqq、github）和无指令的纯服务插件（仍可用「菜单 <插件名>」直接查看）；根菜单标题不再显示内部实例名「=== root 指令菜单 ===」，改用项目显示名（`metadata.displayName`）或「=== 指令菜单 ===」。会话历史回放带原生按钮的回复时，未渲染的 JSX 不再被序列化成 `[markdown]{"$jsx":"zhin.jsx/1",…}`：Markdown 取原文，按钮（键盘行与 `<button>`）降级为 `[标签]`。
- Updated dependencies [e6d7cc1]
- Updated dependencies [7cc703a]
- Updated dependencies [cca4427]
- Updated dependencies [70ddaf4]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
  - @zhin.js/plugin-runtime@1.3.0
  - @zhin.js/im-contract@1.2.0
  - @zhin.js/feature-kit@1.1.18
  - @zhin.js/permission@1.2.2

## 1.2.2

### Patch Changes

- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/feature-kit@1.1.17
  - @zhin.js/permission@1.2.1

## 1.2.1

### Patch Changes

- 73ef48b: `defineCommand` 新增两项便捷写法：`reply` 用固定内容代替 `execute`；`match` 正则让整句消息触发命令（命令名路由优先，结果在 `context.match`，不允许 `g` / `y` 标志）。命令列表的描述中带上 `match` 的字面形式。

## 1.2.0

### Minor Changes

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

- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/permission@1.2.0
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/im-contract@1.1.14

## 1.1.17

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/feature-kit@1.1.15
  - @zhin.js/permission@1.1.15

## 1.1.16

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/feature-kit@1.1.14
  - @zhin.js/permission@1.1.14

## 1.1.15

### Patch Changes

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

- Updated dependencies [fed2c27]
- Updated dependencies [72b5a12]
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/feature-kit@1.1.13
  - @zhin.js/permission@1.1.13

## 1.1.14

### Patch Changes

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/permission@1.1.12

## 1.1.13

### Patch Changes

- Updated dependencies [976886c]
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/feature-kit@1.1.11
  - @zhin.js/permission@1.1.11

## 1.1.12

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
- Updated dependencies [2c3610a]
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/plugin-runtime@1.1.18
  - @zhin.js/permission@1.1.10

## 1.1.11

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- adb4af2: 允许应用 Root 显式选择命令反馈、菜单展示与按完整会话区分的出站展示偏好。未配置、返回 undefined 或策略函数异常时沿用默认展示；保留权限、30 项分页、代际隔离和统一发送链，投递失败不重试。
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/permission@1.1.9
  - @zhin.js/feature-kit@1.1.9

## 1.1.10

### Patch Changes

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/permission@1.1.8

## 1.1.9

### Patch Changes

- 8302701: Explain the parameter directory rule when a command path is invalid. Nested parameter directories such as `commands/term/[word]/[...definition]/index.ts`, or a static directory after a parameter directory, now fail with a message that states the rule (one parameter directory per command, and it must be the last directory), names the file and shows the corrected path and `params` declaration. A directory parameter that is not the first `params` entry now gets the reordered list in the error.
- 9943df6: Type the plugin config in convention commands and tools without losing inference (#857). `defineCommand.withConfig<Config>()({...})` fixes the config type and still infers `params`, `options` and the result; `defineAgentTool.withConfig<Config>()({...})` (or `defineAgentTool.withConfig<Config>()<Input>({...})` with a JSON Schema) does the same for tools. The returned definer can be shared across a plugin's files. The existing forms are unchanged: `defineCommand({...})`, `defineCommand<Config>({...})` (whose `params` still fall back to `Record<string, CommandParameterValue>`, because TypeScript has no partial type-argument inference) and `defineAgentTool<Input, Result, Config>({...})`. To get `params` inferred together with a typed config, change `defineCommand<Config>({` to `defineCommand.withConfig<Config>()({`.

  `zhin new` normal plugins now declare an `echoPrefix` option in `schema.json` and a matching `<Name>Config` type in `src/index.ts`, and use it in the echo command through `defineCommand.withConfig<<Name>Config>()`; the generated tests cover the typed config.

- de5b2a1: Plugin instances accept a framework-owned `disabledCommands` list (like `commandNamespace`). Listed commands, given by their local path without namespace or parameters (`fanyi`, `netease login`; a parent path covers its subcommands), are left out of routing, so an application can drop the few commands that overlap with another plugin instead of prefixing every command of the plugin.
- c5741c0: `runCommand(fake, definition, { source })`：传入命令的 `commands/.../index.ts`（路径或 `new URL(..., import.meta.url)`）时，先走运行时同一套约定路径校验（新导出的 `bindCommandSource`），`commands/term/[word]/[...definition]` 这类运行时会拒绝的布局在单测里也会报错；不传 `source` 行为不变。`zhin new` 生成的测试默认传 `source`。
- 584161e: 命令执行预算表满时，淘汰最旧的空闲（无运行中操作）条目，即使其冷却尚未结束，不再让所有新身份对带 `execution` 策略的命令一律得到 `capacity`；只有所有条目都在运行时才拒绝。
- 2a1a3d9: `CommandIndex.execute()` 不再因为没有入站来源而对声明了 `execution` 的命令一律返回 `operation_unavailable`：程序化调用按命令维度应用 `maxConcurrent` / `cooldownMs`（不做发送者预算，也不发送进度提示），并在执行结束时释放。权限 permit 检查仍保持 fail-closed，`dispatch` 行为不变。
- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- Updated dependencies [d3563d9]
  - @zhin.js/feature-kit@1.1.7

## 1.1.8

### Patch Changes

- c407bd2: 安装 HTML 渲染能力时，内置指令菜单通过统一发送链生成菜单图；渲染失败或平台无法投递图片时保留原有文本菜单。菜单采用可自定义标题、配色与背景的三列主题，每页最多 30 项，支持根菜单与插件菜单翻页。平台同时支持原生 Markdown 与按钮时自动附加上一页、下一页控件，在边界禁用；其他平台保留文本导航。Telegram 禁用按钮映射为 Bot API 10.3 DisabledButton。补充中英文文档。
- 064b06d: 通过中立的 operation input 生命周期 hook 将真实入站运行代的退休信号传给 CommandContext.signal，使补问与确认能及时取消。
  保留旧 lease 普通操作和已开始发送的正常排空语义，不全局拦截回复。
- a50fc8a: 群欢迎可配置完整账号与会话的精确白名单，区分全部、空范围及具体会话，修正欢迎出站 requester 身份。新增只读命令权限说明与内置规则假设检查，共享真实准入的主体投影与匹配语义，不执行命令、动态默认值、平台或自定义权限检查；显式区分未知、未评估与条件匹配。
- b58548a: 为命令增加可选冷却、并发准入与一次进度提示，以真实发送者和完整会话身份隔离；Root 预算跨热更新共用，并在业务、渲染、中间件和已启动发送真正结束后释放。准入拒绝通过 limited 状态与有界原因进入消息诊断，避免回落到 AI。
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.7

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/interaction@1.1.2
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.6

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/interaction@1.1.1
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/feature-kit@1.1.4

## 1.1.5

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/permission@1.1.4

## 1.1.4

### Patch Changes

- b9b3953: Resolve command permissions and command/component contexts from the current operation snapshot when unchanged projections are reused after hot reload. Preserve old snapshots for draining operations.

## 1.1.3

### Patch Changes

- Updated dependencies [0de4836]
  - @zhin.js/permission@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/feature-kit@1.1.2
  - @zhin.js/permission@1.1.2

## 1.1.1

### Patch Changes

- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [b076eae]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [2fd8017]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/feature-kit@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/interaction@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.16

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/feature-kit@1.0.13
  - @zhin.js/permission@1.0.4

## 1.0.15

### Patch Changes

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- Updated dependencies [67ef8c4]
- Updated dependencies [974772e]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/interaction@1.0.1
  - @zhin.js/feature-kit@1.0.12
  - @zhin.js/permission@1.0.3

## 1.0.14

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11

## 1.0.13

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10

## 1.0.12

### Patch Changes

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/feature-kit@1.0.9
  - @zhin.js/permission@1.0.2

## 1.0.11

### Patch Changes

- 7945544: fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

  `resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
  而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

  fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

  旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
  新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
  新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。

## 1.0.10

### Patch Changes

- 2d0a622: feat(command): 支持 shortcut 和 params.default 的动态函数取值

  引入 `CommandDynamicValue` 统一类型，shortcut 预填值、`params.default`、`defaultValue` 均可接受 `(session: CommandSession) => value` 形式的函数，在分发时从运行时上下文（adapter、endpoint、scene、sender）动态解析。

  - 新增 `CommandDynamicValue` 类型和 `resolveDynamicParams()` 集中解析函数
  - 新增 `CommandSession` 和 `resolveCommandSession()` 用于从 Message 提取上下文
  - 帮助文本中函数值显示为 `<dynamic>` 而非函数源码
  - 三条分发路径（shortcut、normal、host/execute）统一调用 `resolveDynamicParams`

## 1.0.9

### Patch Changes

- ca92e03: feat(command): add alias/permit/shortcut fields and Unicode command names

  Commands can now declare alias (multi-word static segment replacements),
  permit (builtin DSL access control), and shortcut (global exact-match with
  prefilled params). Static command filenames support Unicode names
  (e.g. 赞我.ts) alongside ASCII kebab-case. Permit failures result in silent
  non-match for graceful degradation.

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
  - @zhin.js/permission@1.0.1
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/feature-kit@1.0.8

## 1.0.8

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/feature-kit@1.0.7
  - @zhin.js/plugin-runtime@1.1.4

## 1.0.7

### Patch Changes

- afc0e66: feat!: IM 寻址全量统一为 ConversationRef（BREAKING，无兼容双轨）

  - `SendRequest` / `IncomingMessage` / `OutboundEnvelope` / `EndpointSendRequest` / `RuntimeMessageEvent` 全部收敛为 `conversation: ConversationRef` 单一寻址；`adapter` / `target` / `parent`（ChannelParent）/ `DeliveryMessageGateway` / `synthesizeConversation` / `parseLegacyConversationTarget`（core 侧）全部删除。
  - 20 个平台适配器入站直接构造 `ConversationRef`（endpoint/kind/id/parent，guild 容器与群临时会话归位）；`endpoint.send` 改读 `request.conversation`，legacy 字符串仅存在于平台 SDK 边界内部。
  - `Message` 类改为 conversation 原生（`adapter`/`target` 字段删除，`id` 为 `message?.id` getter）；owner 判定、interactive 频道键、CommandMessage 鸭式契约同步统一。
  - OutboundHost / sendEndpointMessage / console RPC / inbox / activity-feedback / 游戏插件全部 conversation 化；`MessageGateway.send` 返回 `DeliveryReceipt`。

  迁移：自定义适配器/插件的 `gateway.receive` 传 `{ conversation: { endpoint: { id, adapter }, kind, id }, content }`；发消息处 `conversation` 替代 `target`+`channelType`。

- 9f57124: feat!: 命令动态参数文件名改为 Next.js 风格（BREAKING）

  - 文件名不再携带类型：`[name:type=default].ts` → `[name].ts`（必需）/ `[[name]].ts`（可选）；类型与默认值统一在 `defineCommand({ params })` 中声明（`params.<name>.type` 必填，`default` 可选）。
  - 新增捕获所有段：`[...slug].ts` / `[[...slug]].ts`，运行时 `params.slug` 为数组；元素粒度随 `params.slug.type`——`text` 逐消息段，`word`/`string` 逐词切分，`number`/`integer`/`float`/`boolean` 逐词转换（任一词失败即不匹配），结构化类型逐消息段。
  - 旧格式文件名在发现期即抛 `CommandPathSyntaxError`；动态文件名缺少对应 `params` 声明、或必需文件名的 `params` 带 `default` 同样抛错。
  - `zhin new` 模板与 `zhin runtime migrate` 产物同步输出新格式；仓库内全部适配器 / 游戏 / 工具插件命令文件已迁移。

- Updated dependencies [afc0e66]
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/feature-kit@1.0.6

## 1.0.6

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/feature-kit@1.0.5

## 1.0.5

### Patch Changes

- 7c1e63a: feat(command)!: 命令名前缀分隔符由空格改为点号（BREAKING）

  非 root 插件命令的自动前缀从空格改为点号：`qq endpoint list` → `qq.endpoint list`，多级挂载 `b a foo` → `b.a.foo`；root 插件命令不变。点号前缀同时消除了旧规则下 root 目录段与子插件 owner 段的命名冲突（`child status` vs `child.status` 现在可共存）。配套的 endpoint 管理命令套件（`createEndpointCommands`）及 QQ/ICQQ 适配器的用户可见用法文案同步更新为新风格。迁移：用户与文档中所有 `<adapter> <command>` 形式的指令改为 `<adapter>.<command>`。

## 1.0.4

### Patch Changes

- d5cd4aa: Publish Plugin Runtime entry points and convention modules as JavaScript so
  installed npm plugins load on Node without TypeScript stripping. Workspace
  development continues to prefer TypeScript sources for local HMR.

  Remove the unconsumed legacy game hub APIs from game-kit; game navigation and
  records now use ordinary convention commands owned by the game hub plugin.

- Updated dependencies [d5cd4aa]
  - @zhin.js/feature-kit@1.0.4

## 1.0.3

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 50497a5: CommandContext session fields are structured objects (scene/sender) and TInput is constrained to CommandMessage.
- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.
- fa66c4c: Use `segment-matcher` as the CommandIndex engine, add typed canonical segment parameters and
  expose unmatched structured segments through CommandContext. Preserve structured command input
  while stripping adapter command prefixes in the Core message dispatcher.
- Updated dependencies [cdf64e7]
- Updated dependencies [078e3f7]
- Updated dependencies [fa66c4c]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/feature-kit@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/feature-kit@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [447f3e2]
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/feature-kit@1.0.1
