# @zhin.js/console-protocol

## 1.2.1

### Patch Changes

- cfa3dbf: 新增 `zhin enable <plugin>` / `zhin disable <plugin>`：把已安装并已声明的插件实例移出或加入 `disable_plugins`（实例键，或只声明一次的包名）。网关运行时经新的 `gateway.plugins.enable` / `gateway.plugins.disable`（`plugin.manage`）执行只写配置的事务：停实例、写配置、启实例，启动失败时恢复配置并启动旧实例；网关未运行时直接写配置，下次 `zhin start` 生效。已是目标状态时成功且不改动；未声明、保留键、项目根插件，以及启用时包未安装、依赖无法解析或配置不通过插件 Schema 时报错（退出码 1）。`PluginManagementWorkflow` 新增 `planSetEnabled` / `setEnabled`；事务结果新增 `plugin` 字段，包来源新增 `local`（本地插件只限所有者启停）。
- 7fb1ee7: Console 的插件全局开关改由管理网关作为启停事务执行（ADR 0054 §4）：网关在转发前拦截 `plugin:set-enabled` 与 `level: 'global'` 的 `feature.set-enabled`，按 `plugin.manage` 授权，执行与 `gateway.plugins.enable` / `disable` 相同的事务（停实例 → 写 `disable_plugins` → 启实例，失败回滚），并用两者原有的回复形状作答（另带 `transaction`；失败时为 `transaction_failed` / `rollback_failed` 错误信封）；成功变更后在事件流补发 `plugin:lifecycle-updated`。权限表中 `plugin:set-enabled` 改为 `plugin.manage`，`feature.set-enabled` 的全局层细化为 `plugin.manage`（其余层仍是 `feature.toggle`），新增 `isGlobalFeatureSwitch` / `FEATURE_GLOBAL_SWITCH_PERMISSION`。实例不再写全局开关：`plugin:set-enabled` 与 Console 路径上的全局 `feature.set-enabled`（409 `gateway-required`）一律拒绝，`--standalone` 下请用 `zhin enable` / `zhin disable`；`RuntimeConsoleRpcContext.setPluginEnabled` 已移除。`@zhin.js/client` 的 `setPluginEnabled` 改用依赖事务的可续期超时。聊天命令的全局开关暂不变。

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

- c2bbdcf: Console 访问控制（ADR 0049）：用户、角色、会话、API 令牌与审计日志存入项目数据库，每个 Console RPC、`/api` 路由与 Host 鉴权的 WebSocket 都按 `@zhin.js/console-protocol` 的权限表放行，未登记的一律拒绝。

  **破坏性变更**

  - `http.tokens` 与演示模式（`scope: demo` / `user`）删除；配置里仍有 `http.tokens` 时 Host 拒绝启动。Host 配置 Schema 同步删除该字段。
  - `http.token` 变为初始化令牌：只在创建第一个所有者之前有效，之后在所有接口上被拒绝。
  - 未在 `CONSOLE_WS_PERMISSIONS` 登记、又使用 Host 鉴权的插件 WebSocket 不再接受 Console 账号；插件自己的 WebSocket 应改用 `ws(path, { auth: 'protocol' })` 并自行校验凭据（新增 `verifyProtocolAccessToken`、`isLoopbackAddress`）。
  - OneBot 11 / 12、NapCat、Milky 的反向 WebSocket 改为只认适配器自己的 `access_token`；未配置 `access_token` 时只接受本机回环连接。
  - `zhin doctor --live` 等改从 `ZHIN_CONSOLE_TOKEN` 读取 API 令牌（仍兼容 `ZHIN_HTTP_TOKEN`）。

  **迁移步骤**（详见文档「升级到 Console 访问控制」）

  1. 升级后用 `http.token` 打开 Console 初始化向导创建第一个所有者，或运行 `zhin console init`（脚本：`zhin console init --yes --owner <名> --password-stdin`）。
  2. 删除配置里的 `http.tokens`，在 Console「访问控制」里为原来的令牌持有人创建用户并绑定角色（`viewer` / `operator` / `admin`）；演示环境改用 `viewer` 账号。
  3. 自动化在 Console 签发 API 令牌，放进 `ZHIN_CONSOLE_TOKEN`。
  4. 从其他机器或容器连接的反向 WebSocket endpoint 补上 `access_token`。
  5. 忘记密码或所有者被锁时，停下 Host，用 `zhin console user passwd|enable|create` 离线恢复。

  MCP / A2A 的 Bearer 访问同样接受用户 API 令牌（分别需要 `mcp.access`、`a2a.access`）。适配器与插件文档同步改为账号与角色的说法。

- 63595fc: 功能配置新增第四级「会话」（ADR 0055），并引入聊天角色（ADR 0056）。

  - `@zhin.js/plugin-runtime`：会话解析键与转义、会话覆盖读取令牌，门禁与缓存按会话判断；锁定可来自账号层。
  - `@zhin.js/runtime`：`x-zhin-config.levels` 支持 `conversation`，新增 `conversationFields` / `selfServiceFields` / `chatAdminFields` 声明与会话覆盖校验；`configFor` / `isEnabledFor` 解析到会话层；Host 配置新增 `features.selfService`。
  - `@zhin.js/console-protocol`：`feature.*` 支持 `level: 'conversation'`，新增 `feature.conversations`、`chat-roles.list|grant|revoke` 与 `featureScopeTarget`；被上级锁定的写入返回 409 `locked`；`iam.manage` 可按作用域绑定（仅 `chat-roles.*`）。
  - `@zhin.js/core`：命令、中间件、处理器的门禁按消息所在会话判断。
  - `@zhin.js/agent`：Agent 工具与技能披露按会话层功能开关判断。
  - `@zhin.js/schema`：新增 `Schema.object(...).featureLevels(...)`，声明插件根的分层级别与会话字段。
  - `zhin.js`：实例新增会话级功能覆盖存储、聊天角色、`chat-roles.*` RPC 与群内「功能」「角色」命令（默认关闭）；所有层级的启停按「上级停用则下级锁定」执行。
  - `@zhin.js/plugin-repeater`：支持按群覆盖复读阈值与冷却，群管理员可在聊天中调整阈值。
  - `@zhin.js/plugin-rss`：支持按群关闭 RSS，被关闭的会话不再收到推送。

- c2bbdcf: 三级功能配置（ADR 0050）：插件配置按「全局 ← 适配器 ← 账号」合并，覆盖写在插件配置块的 `overrides.adapters.<别名>` / `overrides.endpoints.<别名>/<账号>` 里；上级禁用锁定下级，`null` 清空、数组整体替换。消息分发、中间件与 Agent 工具按目标账号的启用状态门禁；Console 新增 `feature.*` RPC 读写各层配置。

  **破坏性变更**

  - `overrides` 成为插件配置的保留键（与 `commandNamespace`、`disabledCommands` 一样由框架注入 Schema）；原来把 `overrides` 当普通字段的插件需要改名。
  - `PluginSetupContext` 新增必需成员 `configFor(target)` 与 `isEnabledFor(target)`；自行构造或实现该接口的代码（测试替身等）需要补齐。

  **迁移步骤**

  1. 检查插件 Schema 里是否有名为 `overrides` 的字段，有则改名并迁移配置。
  2. 自建的 `PluginSetupContext` 替身补上 `configFor` / `isEnabledFor`（可直接返回全局配置与 `true`）。
  3. 需要按账号区分配置时，在插件 Schema 字段上声明 `x-zhin-config.levels`，再在 Console 功能页或配置文件 `overrides` 里填写。

### Patch Changes

- 1a5c569: 安装缺少必填配置的插件（如需要账号的适配器）时只安装依赖、不声明，结果报告 `needsConfiguration`（缺少的字段与环境变量），事务不再回滚；新增 `gateway.plugins.declare`（`plugin.manage`，按插件 Schema 校验、原子写入声明与配置、重启实例、失败回滚配置）。回滚日志尾部只含本次事务期间的实例输出。`zhin install` / `zhin setup` 对需要先配置的插件给出提示；经网关安装时显示网关阶段输出，不再打印本地 pnpm 命令行。
- c2bbdcf: 页面元数据新增可选 `section`（`overview` / `conversations` / `features` / `plugins` / `ops` / `access`，ADR 0052），声明页面在 Console 导航里属于哪个分区；`definePage` 校验取值，Host 的 `/entries` 与客户端 `resolveEntryRegister` 把它透传到路由 `meta.section`，未知值被丢弃。
- c2bbdcf: Console 终端（ADR 0051）：Host 配置新增顶层 `console.terminal`（`enabled`、`shell`、`cwd`、`idleTimeout`、`maxSessions`、白名单 `ssh` 目标），开启后 Console 可打开宿主 Shell（`node-pty`）或 SSH 会话（`ssh2`），两者都是 CLI 的可选依赖。只有持有 `ops.terminal` 的所有者能用，初始化令牌不可用；票据一次性、30 秒有效；会话开始与结束写入审计日志；改密码、禁用或删除用户、变更其角色绑定时立即结束该用户的终端会话。默认关闭，关闭时不注册任何路由，也不加载可选模块。`console.terminal` 列入自我变更禁改名单。
- 5120367: `schema:get` 支持按包名读取已安装但未声明插件的 Schema（返回 `declared: false`；以最新配置复核，经本地路径或别名已声明同一包的视为已声明）；`gateway.plugins.declare` 校验失败时返回结构化 `errors`（`path` / `message`）与 `missingEnv`，事务内复核失败时同样写入事务结果，提示文字保持不变。`@zhin.js/client` 的 `ConsoleTransportError` 新增 `details`（`serverCode`、`errors`、`missingEnv`）。
- fd22375: 修复功能分层配置（ADR 0050 / 0055）审查发现的问题：

  - 覆盖校验：值为 `null` 的键（显式清空）不再绕过字段白名单，下级层不能借此清掉仅全局字段，嵌套清空也必须指向 Schema 中存在的字段。
  - 环境变量引用：聊天自助在任何层级都拒绝写入 `${…}` / `env://`；Console 的 `feature.set-override` 只允许具备 `ops.env.write` 的用户写入，防止借 `feature.configure` 读取密钥。
  - 会话覆盖存储：数据库写入检查影响行数，0 行或并发插入同一键时重新加载并返回冲突；删除保留墓碑行，修订号单调递增（无 ABA）；Console 读取时节流重新加载以看到其他进程的写入；`feature.get` / `feature.conversations` 新增 `persistent`，非持久数据库在回复中提示重启后丢失。
  - Console：嵌套插件的开关沿祖先链计算锁定（409 `locked`）；会话键按各部分校验，不再限制总长 512；最近会话按事件 id 倒序扫描最近窗口并去重。
  - 推送门禁：管理员 RSS 任务按目标会话开关跳过并记录 `featureDisabled`；记账私信推送检查私聊会话开关；彩票推送目标先按 `AdapterIndex.resolve` 解析为账号再判断（`isEnabledFor` 新增 `{ endpoint: { adapter, endpointKey } }` 目标），无法解析时按原方式投递；活动反馈按事件携带的 `conversationRef`（Endpoint CapabilityId 与原始会话）判断。

- cc7a5f9: Console 访问控制迁到网关（ADR 0054 §3 / §7，B1.4）

  - gateway：网关自己打开项目数据库（新子路径 `@zhin.js/gateway/database`，按实例同一规则解析 `database`；SQLite 为 WAL，网关连接遇忙时异步退避重试（5 秒，不使用同步 busy*timeout），超时返回 `503 database_busy` 与 Retry-After，写入都是单语句自动提交），持有 `console*_` 表，本地认证会话、API 令牌与初始化令牌；`{base}/auth/_`、`iam.\*`、`onboarding.update`、初始化向导（切换数据库后网关重连并重启实例）、终端与审计都挂在网关上，没有实例时也能登录与初始化。数据库连接或重连期间按初始化标记失败即关闭。网关运行时另一个进程（`zhin console init`）创建了所有者，网关按初始化标记立即关闭开放 Host 并重读所有者状态，不再等 30 秒的定时刷新。网关接管 `{base}/events`（合并 `gateway.packages.progress`，实例离线时只含网关事件）与 `{base}/gateway/packages/progress`。
  - host-http：桥接协议升到 3：删除过渡消息 `auth.*`；实例上报插件权限目录（`catalog`）与审计条目（`audit`），网关下发 `principal-revoked`，实例关闭该用户的 SSE 与 WebSocket。
  - console-protocol：新增 `GATEWAY_PACKAGES_PROGRESS_PATH`，网关事件说明更新。
  - database：SQLite 文件库总是开启 WAL，新增 `busyTimeoutMs`；未设置同步等待的连接（实例）对事务外语句与 `BEGIN IMMEDIATE` 遇到 `SQLITE_BUSY` 时做有界的异步退避重试（默认 5 秒，`busyRetryMs`），事务默认 `BEGIN IMMEDIATE`，声明 `readOnly` 的事务用 `BEGIN DEFERRED` + `query_only`，网关短暂持有写锁时实例写入不再报错。
  - zhin.js：受监管实例不再安装 Console 账号与终端，只对网关转发的主体授权（`--standalone` 照旧自带）。
  - mcp / a2a：配合实例不再持有 Console 令牌注册表。
  - cli：`zhin console` 经网关模块打开项目数据库。

- cc7a5f9: 常驻网关与 `zhin start` / `stop` / `restart` / `status` / `logs`（ADR 0054 §5 / §6，B1.6）

  - gateway：`runGateway` 移到 `@zhin.js/gateway/server` 的独立模块；实例崩溃、风暴保护进入 `crashed` 或经 RPC 停止时网关照常运行，只在 SIGINT / SIGTERM、`gateway.shutdown` 或 `--once` 时结束。实例输出总是写入 `.zhin/logs/instance.log`，前台运行时同时回显。新子路径 `@zhin.js/gateway/local`：本地控制套接字 `.zhin/gateway.sock`（Windows 为命名管道，仅当前用户可连接），清理残留套接字、拒绝第二个网关，JSON 行协议（主体 `local`，另有 `gateway.info` / `gateway.shutdown` 与依赖事务进度流），状态文件 `.zhin/gateway.json` 与 CLI 客户端。
  - console-protocol：`gateway.packages.uninstall` 新增 `removeDependency`。
  - cli：`zhin start` 默认后台运行，`--foreground` 前台运行；新增 `zhin stop`、`restart [--gateway]`、`status [--json]`（未运行时退出码 3）、`logs [-f] [-n]`、`update`；网关运行时 `install` / `uninstall` 经网关执行。`zhin runtime start` 保留为前台别名。
  - zhin.js：提示改为 `zhin start`；网关前台运行时实例按交互终端输出。
  - runtime / scaffold-wizard / create-zhin-app：脚本与服务模板（systemd、Docker、PM2）改用 `zhin start --foreground`，README 附 Console 链接。

- f8bf684: 插件的安装、更新、卸载只走网关依赖事务 `gateway.packages.install | update | uninstall`（先停实例、失败回滚、需要配置的插件只装不声明）。删除实例内直接运行包管理器的 `plugin:install` / `plugin:update` / `plugin:uninstall` RPC 及其权限登记（`PLUGIN_RPC.INSTALL|UPDATE|UNINSTALL` 不再导出），实例只保留只读的 `plugin:plan-*`。`@zhin.js/client` 的 `installPlugin(packages, request?, options?)` / `updatePlugin(name, version, request?, options?)` / `uninstallPlugin(packages, request?, options?)` 改为调用网关 RPC，返回 `GatewayPackageTransactionResult`（`ok`、`status`、`needsConfiguration`、`errors`、`missingEnv`、`logTail`），不再接受 `expectedRevision`；新增 `planPackages()`（`gateway.packages.plan`），包事务默认超时改为 300 秒。

  网关转发失败的响应统一为 `GatewayInstanceErrorReply`：`503 instance_unavailable`（带 `Retry-After`）、`504 instance_timeout`、`502 instance_error`，都带 `requestOutcome`（`not-dispatched` / `unknown`）与实例 `state`；`GET /pub/health`（`GatewayHealth`）不缓存，可供 Console 在实例离线时轮询。

- 4e8ba38: 依赖事务与网关 RPC（ADR 0054 §4 / §5，B1.5）

  - gateway：`GatewayPackageService`——`gateway.packages.list | plan | install | uninstall | update` 复用插件管理事务：停实例 → 执行包管理器 → 起实例并等待稳定 → 失败时恢复 `package.json` / 锁文件 / 配置、重新安装、启动旧版本，并报告失败阶段与日志尾部；进度可订阅（`subscribe()`）；`dispatchGatewayRpc` 统一检查权限并分发 `gateway.packages.*` 与 `gateway.instance.*`；Windows 下包管理器经 `.cmd` 解析启动。
  - console-protocol：新增 `gateway.*` RPC 契约（请求 / 结果类型、`GATEWAY_RPC_PERMISSIONS`、`gateway.packages.progress`），并并入 `CONSOLE_RPC_PERMISSIONS`。

- 5cd9d3d: 插件权限按级别授予内置角色，插件 Console RPC 按方法鉴权（ADR 0049 修订）

  - console-protocol：插件权限（`<plugin>:<action>`）分为 read / operate / manage 三级，可在 `definePluginConsoleRpc({ permissions })` 声明，未声明时按后缀推断；新增目录权限 `plugin.perms.read|operate|manage`：viewer 得到 read，operator 得到 read + operate，admin 与 owner 得到全部。
  - gateway / host-http：自定义角色与 API 令牌可以写入插件权限；`iam.roles.list` 返回各角色实际生效的插件权限与当前运行时的插件权限目录（`pluginPermissions`）；`/auth/me` 按已加载插件展开级别授予。
  - zhin.js：已登录用户与 API 令牌调用 `plugin.<id>.<method>` 时，按方法自身、所属页面或目录兜底权限逐一检查（此前只检查 `feature.view` / `feature.configure`，operator 可以审批 `ops:approve` 操作）；门禁放行但无插件分发器应答的请求一律拒绝并记审计。
  - adapter：账号类方法的授权目标与处理函数选择账号的方式一致（`consoleAccountTarget`，先看 `data.instanceId`），`id` / `instanceId` 不一致或放在 `data` 之外时拒绝，避免按一个账号授权、却操作另一个账号；适配器 / 账号作用域的绑定可满足目录与插件权限。
  - plugin-runtime：`definePluginConsoleRpc` 支持声明权限级别。
  - rss / reminder / ledger / calendar / qrcode / short-url：补充权限级别声明（写操作为 operate 级）。

## 1.1.14

### Patch Changes

- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.

## 1.1.13

### Patch Changes

- bd524d1: **行为变更：Host 未运行时 `zhin config get|set|unset|list` 现在以退出码 7 失败，不再静默写本地文件；离线操作需显式加 `--offline`。**

  `zhin config get|set|unset|list` 默认连接运行中的 Host（`config:get-project` / `config:patch-project`）；新增 `--offline` 显式本地保存（与 Host 相同的 patchProject 校验，不启动 Runtime）、`--host` / `--token-env` 连接选项（推导地址时通配监听 `0.0.0.0` / `::` 改连 loopback）、`unset` 子命令（`delete`/`del` 为别名）、按 Schema 脱敏读取与 `--reveal`，以及公开退出码 0/3/4/5/6/7。写请求发出后只有 Host 的权威拒绝（HTTP 400 且回显 requestId）才算未保存，网关 502/504 等一律为结果未知（6），并输出 `requestId` / `expectedRevision` 供核对。新增 full-scope `config:get-project` RPC，读取失败不回显原始错误；`config:patch-project` 保存后事件发布失败不再变成拒绝。

- 126ae99: 新增可信项目配置补丁 `config:patch-project`（仅 full 权限，Demo 写入黑名单）：与 `config:patch` 共用单次修订 CAS、整份候选校验与按组生效链，跨分组一次提交；页面 `config:patch` 与 `HOST_CONFIG_PATCH_PATHS` 白名单保持不变。项目补丁拒绝写入 `configVersion` / `plugins` / `disable_plugins` / 根插件 `plugin` 及未声明实例（结构化 `invalid`），冲突回显中的秘密、writeOnly、`${…}` 引用与疑似凭据键一律遮蔽；提交确认丢失返回结构化 `unconfirmed`，不重试、不回滚。
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

## 1.1.12

### Patch Changes

- f3b7c9f: 新增 Console RPC `config:patch`：按路径写入配置，供面向普通用户的简单页面使用（#970）。

  - 路径白名单：带 `instanceKey` 时只能写该插件实例自己的配置块，以及插件 `schema.json` 根部 `x-zhin-config.patchPaths` 声明的 Host 子路径；省略时只能写 `HOST_CONFIG_PATCH_PATHS`（目前为 `ai.trigger.ambient`）。
  - `expectedRevision` 必填；文件已变时返回 `status: 'conflict'` 和最新值，不覆盖。
  - 写入前按 schema 校验每个被改动的配置块；成功响应带 `restartRequired`，`config:updated` 事件新增 `paths` 与 `revision` 字段。
  - `@zhin.js/client` 新增 `patchConfig()`；`@zhin.js/service-typesafe` 声明可写 `ai.decisions`。

  纯新增能力：`config:set`、`config:replace-source` 与 YAML 编辑器行为不变，无需迁移。`config:patch` 只接受 full scope Token，Demo 部署不可用。

- b8e594e: Plugins can register Console status and limited actions with `definePluginConsoleRpc` and `pluginConsoleRpcToken`. Pages call them as `plugin.<pluginId>.status` and `plugin.<pluginId>.<action>` through the existing Console request, using `pluginRpc()` from `@zhin.js/client`. Access follows the bound page's `requiredPermissions` and `requiredRoles`. Actions need the full-scope token, and the demo token can read status only when the plugin opts in. Input, output and run time are bounded, and raw errors never reach the page.

## 1.1.11

### Patch Changes

- d13b1d7: `config:explain` now explains a list of scalars (`{ type: 'array', items: <scalar or literal choice> }`) as a single field compared as a whole, instead of refusing the whole plugin as `complex-schema`. This keeps every plugin explainable now that the framework injects the `disabledCommands` string list next to `commandNamespace`. Arrays of objects, tuples, nested arrays, dictionaries, other unions and references are still reported as `complex-schema`.
- 1971e0c: `config:explain` now explains fixed string-literal choice fields (the `anyOf` of string `const`s the Console form edits as options) as string scalars, instead of refusing the whole plugin as `complex-schema`. Other unions, arrays, dictionaries and references are still reported as `complex-schema`.

  The `@zhin.js/console-protocol` README documents that literal-choice fields are explainable.

## 1.1.10

### Patch Changes

- 7edd04c: 新增当前运行代内的管理员任务 REST 读写接口，使用插件自己的持久化 CAS 与幂等回执，并严格校验完整投递目标、权限与生命周期。
- 2b4d6dc: 为已保存的插件配置提供只读字段来源与当前代一致性解释。复用同一次文件/运行代观察，仅返回有界 metadata；敏感字段、环境引用和不能证明的来源保持隐藏或未知。配置解释要求完整权限，不开放给 demo，也不执行应用或发送操作。
- b58548a: 为命令增加可选冷却、并发准入与一次进度提示，以真实发送者和完整会话身份隔离；Root 预算跨热更新共用，并在业务、渲染、中间件和已启动发送真正结束后释放。准入拒绝通过 limited 状态与有界原因进入消息诊断，避免回落到 AI。
- e914a93: 为完整权限 Console 提供只读单消息诊断查询，按完整会话与消息 ID 精确过滤，不回放消息或保存正文。

## 1.1.9

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

## 1.1.8

### Patch Changes

- 4778587: 补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

  修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

  保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

  明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

## 1.1.7

### Patch Changes

- b9b3953: Fix adapter connection races, transport health reporting, candidate rollback and delivery acknowledgement boundaries. Separate generation admission from locally observed connectivity, reject unconfirmed message receipts, and mark uncertain delivery results without recommending automatic replay.

  Class and compact endpoints should expose a `transportState` getter to report physical connection or local listener health. Unobserved endpoints now report an unknown transport and remain offline in diagnostics. Platform stability tiers remain unchanged until real account acceptance evidence is available.

- b9b3953: Return HTTP 403 for a valid demo token that lacks route authority, reserving 401 for invalid authentication so Console does not discard a valid credential on a permission denial. Keep the restricted demo REST surface unchanged. Raw config:get, config:get-all and config:get-source now require full scope because persisted configuration may contain secrets; demo is a limited inspection scope, not a general read-only editor account.

## 1.1.6

### Patch Changes

- 244e475: Add a shared CLI and Console plugin-management transaction for install, update,
  uninstall, configuration validation, lifecycle control, diagnostics, Marketplace
  discovery, and Endpoint connectivity checks. Console mutations use revision checks,
  exact-version plans, post-operation verification, and recoverable manifest and
  lockfile snapshots.
- baef56b: Require canonical dot-named Console RPCs with top-level camelCase request and response payloads, and remove legacy aliases and normalization paths.
- 507d602: Make the Root `ConfigFileDocument` the sole configuration authority for Runtime, Endpoint commands, and Console. Console source editing now preserves the active YAML or JSON format, uses optimistic revision checks, returns one consistent source-and-key snapshot, and exposes canonical `config:get-source` / `config:replace-source` RPCs without the former YAML-only compatibility names.

## 1.1.5

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

## 1.1.4

### Patch Changes

- b10d058: Preserve standard SSE event metadata, expose typed resumable Console event history, recover missed events before reconnecting the live stream, and allow durable unread notices to be rebuilt after a history gap.
- f2c532f: Expose exact per-Endpoint message operations through one validated Adapter capability model, route Core control calls through declared active capabilities, and connect existing recall, edit, reaction, and typing implementations across platform adapters.

## 1.1.3

### Patch Changes

- 5969c5b: Wire ICQQ login challenges (QR / slider / SMS / auth) through LoginAssist so pending tasks survive Console refresh; add login.list/submit/cancel RPC and TTY stdin consumer.
- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 985fa22: Remove `ai.workrooms` as a restart-bound configuration surface. Workroom definitions now live in the persistent Workroom Catalog, are validated against the exact active Plugin Runtime generation, and can be managed through the Console without rewriting process configuration.

  Remove the `AgentOrchestrator` and `ResourceHub` compatibility exports in favor of `AgentResourceHub`. The renamed resource hub is only the generation-scoped registry for Tool, Skill, SubAgent, MCP, and Hook capabilities; durable Workroom orchestration and Run/Task/Assignment state remain exclusively owned by the Workroom Kernel and its typed ports.

  Route durable IM ingress through canonical Interaction Space bindings before commands or ordinary chat Agents. Workroom and Sponsor spaces produce content-free Project Inbox or Task Input proposals; they never fall through to the ordinary chat Agent authority path.

  Add the authenticated Remote A2A callback host and the first durable outbound dispatch admission boundary. Remote dispatches preregister exact Assignment authority before transport, bind delivered remote task/context receipts before accepting callbacks, and recover crash windows without resending an already-bound dispatch. Missing or uncertain transport outcomes remain `reconcile_required` and cannot complete a Task.

  Persist each Workroom member's Assignment locality in the Catalog. Omitted routes retain the legacy local meaning; remote routes name one exact A2A endpoint and remain deterministic when several endpoint transports are enabled. Catalog/Profile/Grant authority is rechecked before either local or remote claim, so local and remote providers can coexist without first-wins or lexicographic routing.

  Replace the legacy file-backed Workroom Journal array format with content-addressed immutable v3 segments and database envelopes. The v3 schema uses an event-specific closed payload schema, stores only opaque control references beside governed payload receipts, and rejects unknown future fields before publication. Existing `.zhin/workroom-journal` data and database rows—including the blacklist-era v2 format—must be exported and migrated offline before starting this release; the runtime deliberately rejects legacy records instead of guessing their schema or silently upgrading historical `completed` work into accepted Project state.

  Replace arbitrary Effect Sponsor decision `reason` text with the closed v2 `reasonCode` contract. An exact pending-Intent resubmission first publishes a content-free, digest-bound quarantine/supersession receipt, durably replaces the legacy plaintext slot with that tombstone, and then publishes to a dedicated v2 slot. Partial migrations fail closed and resume idempotently after restart, while existing v2 records in the former slot remain replay-compatible. Human rationale must use a governed payload surface and is never persisted in the content-free decision repository.

  Require a full-scope token-bound principal plus current Catalog and P12 metadata authority for Portfolio Sponsor projections. Add the Root-authorized Data Steward/Privacy/Compliance Console plane for content-free lifecycle display, Hold review/release, subject erasure/export, retention purge, and reconciliation; identity and authority fields supplied by callers are rejected.

  Add an optional persistent `sponsorConversation` delivery view to Workroom Catalog entries. Multiple Projects may share one portfolio-level Sponsor Room address, while controls require an explicit Project id and every outbound item remains Project-scoped. The Host bootstraps the exact current Endpoint binding before the first outbound alert; queued projections revalidate current Catalog membership/binding plus the Sponsor-specific P12 channel and manifest immediately before delivery.

  Deliver content-free Portfolio lane, queue-head, grant/reclaim, budget, blocker, and fairness cards through that same governed Sponsor Room outbox. Strict Project-scoped Portfolio lane/status/budget-transfer controls use the authenticated Sponsor ingress path; a current card reply may supply the Project selector, switching Projects never rewrites a room-wide binding, and conflicting/stale explicit or reply targets are clarified without mutation.

  Keep Local Assignment recovery scans independent from long-running executors, and use one locale-independent canonical comparator throughout Workroom, Portfolio, and Data Governance authority ordering.

  Add `zhin agent legacy-runs <input>` and `zhin agent legacy-payloads <input> --kind <kind>` as offline recovery aids. Both commands read legacy data without mutating it and write create-only audit/proposal output; they never promote a legacy `completed` Run to accepted state, write a new Workroom Journal, delete embedded payloads, or perform an automatic migration. Any replacement work still requires explicit admission through the new Kernel.

## 1.1.2

### Patch Changes

- e4757a8: fix: bump

## 1.1.1

### Patch Changes

- f8c7a54: fix: im

## 1.1.0

### Minor Changes

- ac9da66: 深化 Remote Console wire contract：统一 canonical Endpoint RPC/SSE 名称与旧别名规范化，新增共享 `ConsoleEndpointSummary`、EndpointManagement 能力词汇和方法派生能力清单。Plugin Runtime Host 与 legacy Host 现在都会在 `endpoint.list` / `endpoint.info` 返回 `managementCapabilities`，Console SDK 与官方 UI 不再按适配器名称猜测管理能力。

  发布时必须同时发布 `@zhin.js/console-protocol` 与 `@zhin.js/client`；Client 从既有 protocol 运行时依赖重导出协议常量、规范化函数和 Endpoint wire 类型。
