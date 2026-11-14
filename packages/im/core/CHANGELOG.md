# @zhin.js/core

## 1.7.0

### Minor Changes

- ce8edf5: 网关存储隔离（ADR 0059）：

  - Console 的用户、角色、绑定、会话、API 令牌与审计从项目数据库移到网关自己的 `.zhin/gateway.db`（SQLite，`0600`），与项目库方言无关；redis / memory 项目也能建 Console 账号（删除 `IAM_DIALECTS`）。网关不再常驻连接项目库。
  - 升级后网关在连接阶段自动迁移旧表：备份为 `.zhin/backups/gateway-db-<时间>/console-tables.json`，在 gateway.db 事务内复制并按行数与校验和核对，再从项目库删除；完成前 `/auth/*` 回 503 `iam_unavailable`，初始化令牌被拒。`zhin console migrate [--revert]` 手动迁移与降级前回退。
  - `@zhin.js/database`：SQLite 方言 `denyAttach`（事务内发现 `ATTACH` 回滚并作废事务、再 `DETACH`）与 `backupTo`；`console-credential`：受限账号的建号语句、`planConsoleRole` / `provisionConsoleRole` / `probeConsoleCredential` / `refreshConsoleGrants`；MongoDB `listCollections` 操作。
  - `@zhin.js/core`：实例 SQLite 连接强制 `denyAttach`；PostgreSQL / MySQL 的 Console 原始 SQL 只在 `database.console` 受限账号的独立连接池上执行（启动探针、PostgreSQL 补授权、失败后最多每 5 分钟重试），没有可用账号时 `capabilities.sql = false` 并给出 `sqlReason`；新增 `capabilities.sqlIsolation`；删除 `gatewayTableHost()`。
  - `@zhin.js/cli`：新增 `zhin db console-role [--print-sql] [--role]`、`zhin console migrate [--revert]`；`zhin console …` 网关未运行时打开 gateway.db；`zhin doctor` 检查 gateway.db 权限、迁移状态、项目库里重新出现的旧表与受限账号（`--fix` 建号）。
  - `zhin.js/instance`：`--standalone` 的 Console 访问控制改用 gateway.db（不经 DatabaseHost）。
  - `@zhin.js/plugin-runtime`：`DatabaseHostConsoleCapabilities` 新增 `sqlReason`、`sqlIsolation`。`@zhin.js/runtime`：主机配置 Schema 新增 `database.console`（`password` 标为密钥）。`@zhin.js/agent`：补测试固定 Agent 文件 / bash 工具拒绝 `.zhin/gateway.db*` 与 `.zhin/keys/`。
  - `@zhin.js/host-http`：Console 数据库 RPC 的驱动错误回复带上 SQLSTATE（`data.sqlState`，如受限账号的 42501），Console 据此提示改用结构编辑器。
  - 评审加固：项目库标记表 `zhin_gateway_store` 记录 gateway.db 的 id，gateway.db 丢失 / 被替换时 Console 保持关闭，`zhin console init --reset-store` 显式重置；需要运维处理的迁移失败不再自动重试（`zhin doctor` 报告），暂时性失败指数退避，同一快照只备份一次；受限连接由 `consoleConnectionOptions` 构造（去掉连接串 / URI 中的主账号凭据与查询开关）并在归还前重置会话；PostgreSQL 探针检查 CVE-2018-1058 前提、对象所有权、角色设置与网关表授权，60 秒过期并在出错后重探；MySQL 探针检查角色、PROXY 与表 / 列权限；建号用 SCRAM 校验值，错误信息擦除口令；匿名响应只给类别码；插件原始句柄为冻结视图；Agent `bash` 按命令文本拒绝间接读取 `.zhin`。
  - PostgreSQL 探针拒绝受限账号可执行的、其他角色拥有的 SECURITY DEFINER 函数（函数名只写日志；不替用户撤销 PUBLIC 的 EXECUTE，`--print-sql` 附检查与撤销提示）。
  - 第三轮评审：SQLite 首次运行即写标记（网关创建项目库文件，建所有者 / 实例就绪后再补写）；插件原始句柄改为显式门面、`denyAttach` 构造时捕获；Agent `bash` 拒绝通配 / 引号拆分 / `find` 模式触及 `.zhin` 与网关表名，Docker 沙箱隐藏 `.zhin/`；PG 标记表撤销 PUBLIC 与被授予者权限，探针补文件 / 远程函数、列级权限、大对象、其他模式；驱动错误一律按暂时性重试。
  - 第四轮评审：Docker 沙箱的只读回合也隐藏 `.zhin/`，`useDocker: 'auto'` 回退宿主时记警告；插件原始句柄与事务句柄的每个方法、每个字符串类参数都做网关表名检查（`trx.queryStatement` 等）；网关运行中发现 `store_mismatch` 时关闭 Console；Agent `bash` 文本检查解码 `$'…'` 并展开花括号；PostgreSQL / MySQL live 测试各用独立数据库，可并行运行。
  - 第五轮评审：Agent `bash` 文本检查覆盖反斜杠、续行、参数默认值与扩展通配；插件原始句柄参数总是以检查过的副本交给驱动；运行中因 store 不匹配关闭 Console 时一并结束用户连接与终端；ADR 写明动态 SQL 与文本检查的限度。

### Patch Changes

- f74b4a5: Console 数据库页：服务端排序筛选、SQL 控制台与表结构编辑：

  - `db:select` 支持 `orderBy: { column, direction }`（全表排序，主键作为次序键保证分页稳定）；`where` 只接受表中存在的列与 `$eq/$ne/$gt/$gte/$lt/$lte/$like/$nlike/$in/$nin`（`null` 表示为空/不为空），修复列名未转义可拼入 SQL 的问题。`db:info` 返回 `capabilities`，Console 据此判断 Host 是否支持新功能。
  - 新增 `db:query`（`ops.database.schema`，与写 SQL 相同只给 `owner`：共用数据库上按文本判断只读不能当安全边界，其他角色保留 `db:select` 结构化浏览）：单条只读语句（SELECT / WITH / EXPLAIN / SHOW / 只读 PRAGMA），在只读事务中执行（SQLite `query_only`、PostgreSQL `READ ONLY` + `SET LOCAL statement_timeout`、MySQL `START TRANSACTION READ ONLY` + `max_execution_time`），最多返回 1000 行且只读取这些行（PostgreSQL 游标、MySQL 流式、SQLite 逐行）；SQLite 文件库在子进程中用只读连接执行，超时即强制结束，不阻塞事件循环。
  - 新增权限 `ops.database.schema`（内置角色中仅 `owner` 拥有）与 `db:execute`（写 SQL，可多语句，`dryRun` 在事务中执行后回滚以预估影响行数）、`db:schema:describe` / `db:schema:preview` / `db:schema:apply`（加列、改列名、删列、改类型/可空/默认值、建表、建/删索引；删除类操作需输入名称确认）。网关 `console_*` 表、迁移记录表与引擎系统表拒绝写入与结构调整；SQL 与结构调整的语句文本（字符串字面量脱敏为 `'…'`，失败的结构调整也记录所尝试的 DDL）写入审计日志，不记录结果行。代码声明的表不能在 Console 删列或改列名。MySQL 改列时其余列定义（完整类型、字符集/排序规则、`ON UPDATE`、注释、表达式默认值）取自 `information_schema`。MongoDB / Redis / memory 方言返回不支持。
  - 未由代码声明的物理表（Console 新建或已卸载插件留下的表）在启动时被发现并出现在表列表中。
  - `@zhin.js/database`：PostgreSQL / MySQL 事务支持 `readOnly`；PostgreSQL 查询结果数组带不可枚举的 `command` / `rowCount`。
  - Console SQL 一律经单语句协议执行（PostgreSQL 扩展查询协议、MySQL 预处理语句、SQLite `prepare`），并拒绝事务控制、`PREPARE`/`EXECUTE`、定义函数/过程/规则/扩展、PostgreSQL `U&` 写法、动态 SQL 与文件/设置函数（`*_to_xml*`、`xpath`、`dblink*`、`lo_*`、`pg_read_*`、`set_config` 等，按规范化后的函数名比对）、MySQL `/*! */` 与 `/*+ */`；词法器修正 PostgreSQL `E'…'`、嵌套注释、带数字的 `$tag$` 与 MySQL `--`。
  - `@zhin.js/database`：事务新增可选 `queryStatement(sql, { maxRows })`（单语句协议、按行数截断）；SQLite 方言新增 `queryReadOnlyIsolated()`（子进程只读连接，超时 SIGKILL）；MySQL `escapeString` / `formatDefaultValue` / `formatJson` 转义反斜杠（此前含 `\` 的默认值与 JSON 会被改写）；`referencesGatewayOwnedTable` 解码 `U&`、`E''` 与反斜杠转义后再判断。PostgreSQL 的单语句执行需要 `pg` 8.11 及以上（`queryMode: 'extended'`）。
  - `@zhin.js/gateway`：审计详情超过 4096 字符时改存可解析的 `{ truncated, length, preview }`，不再截断成非法 JSON。
  - 复审加固：统计视图（`pg_stats*`、`pg_statistic*`、`sqlite_stat*`、MySQL `column_statistics`）、角色密码哈希与大对象（`pg_authid`、`pg_shadow`、`pg_largeobject`、`mysql.*`）在 SQL 控制台读写两侧都拒绝；`DROP OWNED`、`REASSIGN OWNED`、数据库与模式的建改删、`DROP/TRUNCATE … CASCADE`、`ALTER … OWNER TO`、表空间、用户与角色、MySQL 服务端管理语句、触发器（含 `DEFINER=` 写法）一律拒绝；服务端字符串语义与默认不同（PostgreSQL `standard_conforming_strings = off`、MySQL `NO_BACKSLASH_ESCAPES` / `ANSI_QUOTES`）时 SQL 控制台关闭并说明原因；SQLite 只读查询改在子进程中执行并在超时时强制结束（不拖住实例进程），内存库不提供 SQL 控制台；审计脱敏改用控制台词法器并去掉注释。

- f2fa3d7: ICQQ 改用登录辅助 v2 的登录流程（ADR 0058 P2）：每次登录一条流程（连接 → 挑战 → 验证中 → 在线 / 失败），声明 `login: { mode: 'interactive', relogin: true, refreshQr: true }` 并实现「重新登录」「刷新二维码」钩子。扫码时自动跟踪扫码状态（已扫码提示、确认后自动继续、过期自动换码两次）；滑块带托管验证码辅助页（`media.captcha`）和手动提取 ticket 的分步说明，NT 登录提交 `ticket,randstr`、旧版只提交 ticket；设备锁提供「我已在手机完成验证」和「改用短信验证码」（6 位验证码、60 秒后可重新发送，发送失败报 `rate_limited` / `unknown` 并留在设备锁）；身份验证提供设备 JSON（敏感，只在活动挑战上）、验证链接二维码和只在 `accounts.qq.com/login/attack` 运行的静态辅助脚本。`system.login.error` 按一张表映射到错误码，验证码错误留在原挑战；需要人处理的失败不再自动重新登录，只有被踢下线、网络错误等不需要验证的失败保留退避重试并记入时间线。QQ 命令 `icqq login confirm / code / status / qr` 按挑战作答（设备锁 `code sms`、短信 `code resend`），`code` 支持带 QQ 号。core：流程挑战的兼容待办 `payload.message` 带上简短说明，`payload.url` 在没有 `media.link` 时取第一个链接块。

  adapter：`AdapterIndex.loginControl` 的登录钩子（重新登录、刷新挑战）在账号启动中（卡在登录挑战上）也能调用，新增 `acquireLogin` 租约；已停止的账号和被替换的旧 incarnation 仍然拒绝。

  验证链接带会话标识：icqq 日志只记录挑战类型和链接主机名；core 的 `withoutLoginMedia`（`endpoint.login.flow` 事件与历史）去掉滑块 / 设备锁 / 身份验证 / link_verify 挑战的 `media.link`、`media.captcha` 和链接块，并标 `linkOmitted: true`（console-protocol 增加该字段）。

  复审修正：NT 滑块答错后重新登录拿新滑块（NT / 旧版格式按挑战记录，不再重新判断）；「ticket 已过期」映射为 `challenge_expired`；`system.receive` 的登录挑战副事件只带 `{ kind, host }`；包装 icqq SDK 日志，去掉链接查询串和手机号（SDK 直接写控制台的终端二维码和 237 分支 `console.log` 无法拦截，已在 README 说明）；自动重新登录 8 次用尽后流程失败并通知；扫码时 SDK 的 `internal.error.qrcode` 转为结果；登录钩子随租约中止；token 不兼容提示删除 token 文件；`icqq login code` 在多账号时不回显参数；短信冷却跨重新登录保留。core：纯字符串等于某个无输入操作的 id 时选择该操作（旧 Console 输入 `sms` 仍可用）。

- eba2566: 登录辅助加固（ADR 0058 复审）：登录 RPC 与权限表读同一组 `adapter` / `endpointKey` 字段（`data` 与顶层不一致即拒绝），只凭适配器 / 账号范围授权的调用方，`login.list`、`login.flow.list` / `get`、`login.submit` / `cancel`、`login.relogin` / `refresh` 都限定在被授权的账号，不能再借 `data` 里的目标读取或应答其他账号的挑战；终端只把敏感块和验证链接写到不被采集的终端（TTY stderr 或 `/dev/tty`），`zhin start --foreground` 管道输出里不再出现，没有控制终端时提示改在 Console 查看；兼容事件 `endpoint.login.pending` / `expired` 去掉二维码图片（`imageOmitted: true`）；超过约 24.8 天的挑战截止时间不再立即过期；终端绑定在流程结束后释放其记录。
- ac72706: 登录辅助 v2 第一期（ADR 0058）：每个账号一条登录流程（`LoginAssist.beginFlow`、时间线、提交后自动「验证中」与「结果待确认」、错误码与 `next`），挑战描述符带分步引导、复制 / 链接 / 提示块（敏感块只在活动挑战上）、`parseLoginTicket()` 与托管验证码辅助页的共享函数；`defineAdapter({ login })` 能力声明与 Endpoint `login` 钩子；Console 新事件 `endpoint.login.flow` 与 RPC `login.flow.list` / `login.flow.get` / `login.relogin` / `login.refresh`，`login.submit` 支持 `{ action, values }` 与 `wait: true`；登录操作审计结果类别；终端按流程逐行显示进度、按编号选择操作；账号行填写 `pendingLogin` / `loginStep` / `login`；配置 `console.loginAssist.captchaHelperUrl`。旧 `waitForInput` / `login.list` / `login.submit` 行为不变。
- 8f237bd: `login.list` / `login.flow.list` / `login.flow.get` return live challenge material (QR image, sensitive copy blocks, verification links, legacy `payload.image` / `payload.url`) only to callers holding `endpoint.operate` on that Endpoint; read-only (`endpoint.view`) callers get the event-safe form (ADR 0058 §8). `LoginAssist.eventSafeFlow()` exposes `withoutLoginMedia` to the Console host.
- b2aae3c: 登录流程事件与历史不再带验证链接：`withoutLoginMedia` 去掉滑块 / 设备锁 / 授权 / 链接验证挑战的 `media.link`、`media.captcha` 与链接块（它们带 sid），标记 `media.linkOmitted: true`，需要时用 `login.flow.get` 读取；二维码挑战不变。icqq 登录辅助日志只记录挑战类型与链接主机名。
- 3c14aeb: MariaDB 兼容性修复（由新增的 MariaDB 实库验证发现）：
  - 索引文本列的排序规则按服务器选择：MySQL 8.0+ 用 `utf8mb4_0900_bin`，MariaDB 用 `utf8mb4_nopad_bin`（MariaDB 11.4 之前没有 0900 排序规则，建表会报 `Unknown collation`），MySQL 5.7 用 `utf8mb4_bin`。
  - Console 只读 SQL 的超时在 MariaDB 上改用 `max_statement_time`（秒）；MariaDB 没有 `max_execution_time`，之前每条只读查询都会失败。
  - 结构编辑器修改列时，按 MariaDB 的 `COLUMN_DEFAULT` 写法（带引号的字面量、裸表达式、字符串 `NULL`）还原默认值；之前会把 `current_timestamp()` 当成字符串，导致 `Invalid default value`。
- Updated dependencies [f74b4a5]
- Updated dependencies [f28d8b9]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
- Updated dependencies [f2fa3d7]
- Updated dependencies [ac72706]
- Updated dependencies [3c14aeb]
- Updated dependencies [cdf04b2]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/database@1.2.0
  - @zhin.js/adapter@1.1.34
  - @zhin.js/command@1.2.2
  - @zhin.js/component@1.1.18
  - @zhin.js/feature-kit@1.1.17
  - @zhin.js/handler@1.1.17
  - @zhin.js/middleware@1.1.18
  - @zhin.js/permission@1.2.1
  - @zhin.js/schedule-feature@1.1.17

## 1.6.0

### Minor Changes

- d80964d: 修复 1.2 发版撞号：`@zhin.js/core` 与 `@zhin.js/agent` 按 minor 升到 1.2.0 时，npm 上早已有同号的旧架构版本（core 1.2.0–1.5.16、agent 1.2.0–1.2.1），`changeset publish` 只提示 already published 就跳过，导致 `zhin.js@1.1.26` 等已发布的包依赖了旧 core / agent，启动时缺少 `CHAT_ROLES`。

  本次把 core 发为 1.6.0、agent 发为 1.3.0（npm 上第一个空闲的 minor），并重新发布所有直接依赖它们的包，让依赖版本与 peer 范围指向新版本（`^1.6.0` / `^1.3.0`，不再落进旧架构版本）。

### Patch Changes

- Updated dependencies [73ef48b]
- Updated dependencies [fa22d4b]
  - @zhin.js/command@1.2.1
  - @zhin.js/schema@1.1.7
  - @zhin.js/adapter@1.1.33

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

- 53932e5: 修复平台身份 permit 与操作目标不一致的问题（ADR 0056 §5）：`platform:*` / `platform-permission:*` / `bot:*` / `bot-permission:*` 按**当前会话**判定，但群管理工具此前接受模型传入的任意群 / 服务器 / 频道 ID，机器人同在 A、B 两群当管理员时，A 群管理员可让 Agent 在 B 群踢人。

  - 目标改为取自当前会话、去掉目标 ID 入参（模型传入的 ID 被忽略）：ICQQ（踢人、禁言、设管理员、头衔、公告、匿名；设精华校验消息属于本群）、Telegram（邀请链接、置顶 / 取消置顶、群描述、默认权限）、Discord（加 / 移除身份组、身份组列表、建子线程）、KOOK（黑名单、授予 / 撤销 / 创建 / 删除角色）、飞书（加成员、设 / 撤管理员、改群信息、解散群）、NapCat（群公告、删公告、头衔、群头像；精华消息校验属于本群）、OneBot11（头衔）、QQ 官方频道（身份组增删建与列表、子频道列表、成员详情；子频道详情只限本频道）。核心场景治理工具工厂（`createSceneManagementTools`）同样只作用于调用消息所在会话，没有会话时拒绝；Agent 侧同名工厂改用与核心一致的 `platform:<地位>` + `bot:<地位>`（此前误作 zhin 角色）。
  - 钉钉群管理接口使用旧版 `chatid`（无法由当前会话推出），`dingtalk_add_chat_members` / `dingtalk_update_chat` 改为要求 zhin `owner`（`update_chat` 此前没有任何门禁）；`dingtalk_create_chat` 改为要求 zhin `trusted`（`admin` / `owner` 亦满足），不再依赖钉钉从不上报的 `platform-permission:chat_owner`。
  - Slack 不上报发言者平台身份，频道工具改用 zhin 角色并只作用于当前频道：话题、用途、邀请、置顶 / 取消置顶要求 `admin`，归档 / 恢复归档要求 `owner`；`PERMITS.md` 同步修正。
  - Discord：加 / 移除身份组要求目标身份组低于发起者的最高身份组（服务器主豁免；托管身份组拒绝），低位 `manage_roles` 管理员不能借机器人给自己加更高身份组。平台权限统一为服务器级：机器人自身改读 `GuildMember.permissions`（不再用频道级 `permissionsFor`）；Interactions 模式的位域含频道覆盖，只上报不能被频道覆盖的权限（管理员上报全部），并用最近一次交互的 `app_permissions` 上报机器人自身身份（同一口径，10 分钟内有效）。
  - Telegram：`set_permissions` 改要求 `platform-permission:restrict_members`，`set_description` 改 `change_info`，`create_invite` 改 `invite_users`；发送者 `getChatMember` 并发合并为一次、失败负缓存 10 秒，收到 `chat_member` / `my_chat_member` 更新时以新状态覆盖缓存（默认 `allowedUpdates` 增加这两项）；restricted 成员的个人 `can_*` 不再作为平台权限上报（与普通成员一致，只有管理员上报权限）。
  - KOOK：服务器主与持有「管理员」位的成员（含机器人自身）展开为全部权限；并入「全体成员」（role_id 0）的基础权限。
  - 飞书：`chat.get` 失败或未返回 `owner_id` 时发送者 / 机器人地位为未知（不再报确定的 `member` 并缓存 60 秒），失败负缓存 10 秒。
  - QQ 官方：发送者平台身份只在频道子频道上报（群、单聊、频道私信不上报）。
  - `AdapterIndex.selfStanding`：共享查询使用独立的 10 秒期限，调用方的 `signal` 只中止自己的等待，不再取消他人共享的查询或把结果缓存为未知；查询期间被 `invalidateSelfStanding` 失效时不写回旧结果。
  - OneBot11 / NapCat / Milky：机器人自身身份不再永久记住首次 `get_login_info` 的账号（重连或换号后刷新；只为合并突发请求复用 5 秒，查询失败即丢弃）。
  - 删除遗留导出（生成永不匹配的 permit 或已不再注册）：`discordGroupPermitResolver` / `checkDiscordPlatformPermit` / `normalizeDiscordSenderForPermit`、`telegramGroupPermitResolver` / `checkTelegramPlatformPermit` / `normalizeTelegramChatMember`、`kookGroupPermitResolver` / `checkKookPlatformPermit` / `normalizeKookSenderForPermit` / `KookSenderInfo`、`larkGroupPermitResolver` / `checkLarkPlatformPermit` / `normalizeLarkSenderForPermit`、`slackGroupPermitResolver` / `checkSlackPlatformPermit` / `normalizeSlackSenderForPermit`、`dingtalkGroupPermitResolver` / `checkDingtalkPlatformPermit` / `normalizeDingtalkSenderForPermit`、`wecomGroupPermitResolver` / `checkWecomPlatformPermit` / `normalizeWecomSenderForPermit`、`qqGuildPermitResolver` / `checkQqPlatformPermit` / `normalizeQqGuildSenderForPermit`。permit 一律交给内置评估器（`@zhin.js/permission`），`platformPermit()` 仍保留；各适配器 `PERMITS.md` 按实际上报的字段重写。

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

- 663473b: Agent 模型输出不能再借出站媒体段发送宿主文件（ADR 0056 §2）：

  - 此前模型可以在回复里写 `{"kind":"file","value":"file:///etc/passwd"}`（或 `/etc/passwd`）这样的「平台文件引用」，Agent 发布层原样放行，OneBot / NapCat 会把它当作本地文件读取上传；模型以 `path` 引用工作区文件时也只做了工作区与敏感文件名检查，没有按发起人角色做 `read_file` 的读取判定（普通成员可发出 `.git/config`、`package.json`）。
  - Core 新增不可信来源的出站媒体策略：`untrustedContent(content, trust)` 包装的内容在渲染器里（出站中间件与 Endpoint 之前，出站链仍唯一）只允许 http(s) 链接、有上限的内联数据（默认 25 MiB）与裸平台文件标识；本地路径（含 `file://`）只在 `trust.authorizePath` 认可或由可信代码 `trustedMediaRef()` 构造时放行；嵌套的本地来源拒绝，`html` 只保留文字，不做 `${…}` 模板替换。被拒的段替换为可见提示（「[图片未发送：媒体来源不被允许]」）并记录 `op=outbound_media_refused`。
  - Agent 的回复、流式回复（`OpenReplyStreamOptions.mediaTrust`）、场景事件回复、主动发送与 QQ / ICQQ / Telegram / Discord / NapCat / 企业微信的 Agent 工具发送都按不可信来源投递；模型引用的本地路径按发起人文件角色（只有全局 `owner` 是 `owner`）做与 `read_file` 相同的判定，需要确认的敏感读取直接拒绝。插件代码自己构造的内容不受影响；工作区内工具生成的截图、图表与 Agent 落盘的大附件照常发送。

- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。
- 1e54b1e: 安全加固：实例侧数据库宿主（Console 数据库页、原始 SQL、模型定义与事务）拒绝访问网关的 `console_*` 表，独立模式改用仅根可用的 `gatewayTableHost()`；Agent 文件工具把 SQLite 数据库文件视为敏感文件。SSH 终端目标必须配置 `hostFingerprint`，只有显式 `insecureAcceptAnyHostKey: true` 才跳过校验并在 Console 标为不安全。新增 `http.trustProxy`（受信任代理时从 `X-Forwarded-For` / `Forwarded` 推导客户端地址，用于限速、审计、协议鉴权与桥接）；带转发头的请求不再算本机连接（未配 `access_token` 的反向 WebSocket、MCP / A2A 本机免鉴权一律拒绝）。
- Updated dependencies [53932e5]
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [fd22375]
- Updated dependencies [cc7a5f9]
- Updated dependencies [518cd79]
- Updated dependencies [c2bbdcf]
- Updated dependencies [eae4ea8]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
- Updated dependencies [d655ef0]
- Updated dependencies [1e54b1e]
  - @zhin.js/adapter@1.1.33
  - @zhin.js/kernel@1.1.7
  - @zhin.js/logger@1.1.3
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/middleware@1.1.17
  - @zhin.js/command@1.2.0
  - @zhin.js/component@1.1.17
  - @zhin.js/database@1.1.8
  - @zhin.js/handler@1.1.16
  - @zhin.js/jsx@1.1.13
  - @zhin.js/permission@1.2.0
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/schedule-feature@1.1.16
  - @zhin.js/schema@1.1.6
  - @zhin.js/im-contract@1.1.14

## 1.1.60

### Patch Changes

- Updated dependencies [0d76a7c]
  - @zhin.js/adapter@1.1.32

## 1.1.59

### Patch Changes

- 8adce16: fix: post-refactor audit fixes across runtime, console blueprints, AI setup, and plugin stores

  - **Agent & Runtime**: adapt `DatabaseHost` models for `DatabaseEngagementJournal` after `DatabaseHost.start()` (`this[#db].select is not a function`), suppress deferred database warning in `seedInitialAiPlanIfEmpty`, lazy-load `@zhin.js/agent/runtime` in `agent-console.ts`, wrap `#receiveSideEvent` with `withEndpointEventPayload` and `captureInteraction`, select only `('id', 'timestamp')` in `SystemLogDatabaseTransport.prune()`, and surface clear install errors when optional AI/protocol packages are absent.
  - **Console Blueprints & RPC**: bundle `.ts` blueprint page entries via `esbuild` in `TypeScriptClientBuilder` so `spec`, `fields`, `dictionary`, `pollMs`, and `reviewSpec` are preserved in browser bundles; wire `CommentReviewSession` in `DeclarativePageView`; authorize `zhin.game` / `zhin.feature.game` in `plugin-console-rpc.ts`; forward `locale` in `entry-routes.ts`; pass `pluginId: entry.owner ?? entry.id` in `loadConsoleEntries.ts`.
  - **Plugin Store & Capabilities**: make `deriveStoreDisposer` idempotent in `@zhin.js/plugin-runtime`, guard nullish `carrier.resources`, handle `{ dispose }` return shapes in isolate `bootstrap.ts`, remove duplicate manual disposals in `answers`/`earthquake`, guard optional `projectLocaleToken` in `calendar`/`reminder`/`rss`/`lottery`, migrate `process-monitor` to `definePluginStore`, and align `capabilityGraph` declarations across plugins.
  - **Architectural Enhancements**:
    1. **Model Capability Baseline Catalog + Override Layer** (`@zhin.js/ai`, `@zhin.js/scaffold-wizard`, `@zhin.js/cli`): add `MODEL_CAPABILITY_CATALOG`, `inferModelCapabilities`, and `applyModelCapabilityDefaults` so built-in models carry accurate `input`/`streaming`/`toolCalling`/`thinking` baselines while preserving explicit `provider.capabilities` overrides.
    2. **Zero-Bundler Declarative Blueprint Protocol** (`@zhin.js/console-contract`, `@zhin.js/client`, `@zhin.js/pagemanager`): add JSON-serializable `DeclarativeValueExpr` operators (`$path`, `$count`, `$sum`, `$format`, `$map`, `$join`, `$coalesce`) evaluated identically across Web, IM Card, and CLI Panel projections, plus in-process `ts.transpileModule` synthesis (`synthesizePureBlueprintModule`) in `TypeScriptClientBuilder`.
    3. **Auto CapabilityGraph Convention Merge & Codegen** (`@zhin.js/plugin-runtime`, `@zhin.js/runtime`, `@zhin.js/cli`): add `mergePluginCapabilityGraph`, `scanConventionCapabilityFeatures` (auto-merged during `PluginScopeAssembler.setupTree`), and `zhin runtime codegen [dir] --write --json`.
    4. **Durable Turn Step Checkpointing** (`@zhin.js/agent`): add `TurnCheckpointStore` and `DatabaseTurnCheckpointStorage` (`agent_turn_checkpoints`) so multi-step tool turns interrupted mid-flight record completed `(assistant[toolCall] -> toolResult[])` rounds and resume from the last committed `toolResult` boundary on retry or `"继续"`/`"continue"`.
  - **UI Component System & Developer Preview Workbench** (`@zhin.js/client`, `@zhin.js/components`, `@zhin.js/cli`, `create-zhin-app`):
    - Expand `@zhin.js/client/ui` and `@zhin.js/components` with unified design tokens (`UI_DESIGN_TOKENS`), option icons (`RadioGroup`/`CheckboxGroup`), custom chart images/logos (`BarChart`/`Sparkline`/`DonutChart`/`GaugeBar`), batch table selection & sticky columns (`DataTable`), responsive viewport presets (`CardCanvas`), and shared layout/display primitives.
    - Add `zhin preview [dir]` command in `@zhin.js/cli` (and `"preview": "zhin preview"` in `create-zhin-app`) for zero-build live SSE component & page blueprint previewing, interactive `previewProps` JSON editing, canvas width/background presets, and box-model outline debugging.
  - **IM Chat Controlled Restart & Post-Restart Channel Receipt** (`@zhin.js/cli`):
    - Add `installRestartHost` (`restart` / `重启` / `reboot` command for Bot owners) and `deliverPendingRestartReceipt` so owners can trigger a supervised process restart from any IM conversation and automatically receive the restart completion summary in the originating channel once the endpoint reconnects.
    - Ignore `SIGHUP` in `NativeTypeScriptSupervisor` when running in `--daemon` mode.

- Updated dependencies [8adce16]
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/adapter@1.1.31
  - @zhin.js/command@1.1.17
  - @zhin.js/component@1.1.16
  - @zhin.js/feature-kit@1.1.15
  - @zhin.js/handler@1.1.15
  - @zhin.js/middleware@1.1.16
  - @zhin.js/permission@1.1.15
  - @zhin.js/schedule-feature@1.1.15

## 1.1.58

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- a1f1028: Sink runtime, HTTP, IM, database, inference, and agent host installers from `@zhin.js/cli` into their owning runtime packages (`@zhin.js/runtime`, `@zhin.js/host-http`, `@zhin.js/core/runtime`, `@zhin.js/agent/runtime`), extract the canonical `executeInboundTurnSpine` with `InboundTurnRecord` in `@zhin.js/core/runtime`, and unify `ZhinAgent.hostMailbox`, `AgentTurnIngressRoute`, and `EngagementJournal` onto a single Actor/Mailbox runtime spine.
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/command@1.1.16
  - @zhin.js/handler@1.1.14
  - @zhin.js/im-contract@1.1.13
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/adapter@1.1.30
  - @zhin.js/jsx@1.1.12
  - @zhin.js/component@1.1.15
  - @zhin.js/feature-kit@1.1.14
  - @zhin.js/middleware@1.1.15
  - @zhin.js/permission@1.1.14
  - @zhin.js/schedule-feature@1.1.14

## 1.1.57

### Patch Changes

- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
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

- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/schema@1.1.5
  - @zhin.js/database@1.1.7
  - @zhin.js/im-contract@1.1.12
  - @zhin.js/adapter@1.1.29
  - @zhin.js/middleware@1.1.14
  - @zhin.js/command@1.1.15
  - @zhin.js/component@1.1.14
  - @zhin.js/feature-kit@1.1.13
  - @zhin.js/handler@1.1.13
  - @zhin.js/schedule-feature@1.1.13
  - @zhin.js/permission@1.1.13
  - @zhin.js/kernel@1.1.6
  - @zhin.js/jsx@1.1.11

## 1.1.56

### Patch Changes

- b249e5e: ADR 0044 C4：事件映射迁出 core。新增 `@zhin.js/adapter-onebot-events`，承载 OneBot v11 / NapCat / icqq 的原始通知与请求 → 标准事件映射（`receiveOneBotLikeSideEvent`、`mapNoticeParts`、`mapRequestParts`、`resolveSideEventDedupeKey` 及 OneBot 映射表，icqq 差异用覆盖表表达）；KOOK、Slack 的映射迁入各自适配器；`@zhin.js/core` 只保留标准事件名、类型与 `buildNotice` / `buildRequest` / `buildSystem` / `senderFromId`，不再含任何平台名。core 不再导出上述映射函数与 `ONEBOT_/KOOK_/SLACK_NOTICE_PARTS_MAP`、`SideEventPlatform`、`OneBotLike*` 类型，适配器改从共享包导入。
- 57661f6: core 转出 ADR 0044 能力类型（`TurnCapabilities` 等）与 `adapterFeatureId` / `isAdapterIndex`，agent 层经 core 读取，遵守依赖分层（agent 不直接依赖 adapter）。
- cbd3f14: ADR 0044 integration and C6 guard. `delivery.spool` now reproduces the pre-0044 media rule (icqq `false`, every other official adapter `true`). icqq narrows `actions.recall.others` unless the Bot is admin or owner, and declares recall for groups. Endpoint kind capabilities merge the Endpoint's `operations` (Discord reactions keep working; Discord declares reaction feedback). Adapters in the `@zhin.js/` scope are trusted: their custom prompt text is not labelled `external_content`. Core no longer keeps a telegram/discord interactive-policy table (adapters declare `segments.interactive`). New `pnpm check:no-platform-branches` blocks platform-name branches in runtime code.
- b652db3: Keep default Database, Core and Agent declarations independent of unselected external database drivers. Memory and SQLite remain available from the root; native MySQL, PostgreSQL, MongoDB and Redis classes/configuration move to their precise `@zhin.js/database/dialects/*` entries. TypeScript `Registry.create()` callers select the corresponding dialect types, and third-party dialects augment the single `@zhin.js/database/registry` contract.

  This updates author imports: plugins using these new entries need `@zhin.js/database >=1.1.6` (pending this patch release). Built-in registration, synchronous creation, connection-time driver loading and existing Host database configuration remain unchanged. No drivers, type peers, data migration or version bump are added by this change.

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [aaa93d7]
- Updated dependencies [4fe49b5]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/adapter@1.1.28
  - @zhin.js/im-contract@1.1.11
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/feature-kit@1.1.12
  - @zhin.js/database@1.1.6
  - @zhin.js/command@1.1.14
  - @zhin.js/component@1.1.13
  - @zhin.js/handler@1.1.12
  - @zhin.js/middleware@1.1.13
  - @zhin.js/schedule-feature@1.1.12
  - @zhin.js/jsx@1.1.10
  - @zhin.js/permission@1.1.12

## 1.1.55

### Patch Changes

- b0c02a2: Keep the published `Keyboard` / `Action` JSX helper declarations on their leaf type module instead of `import("../index.js")`, so consumers of `zhin.js/command` / `zhin.js/adapter` no longer type-check core's full entry (which needs `@zhin.js/ai` and optional database drivers).
- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- 26fda97: Deliver validated final answers progressively through configured QQ C2C, Telegram drafts, Slack streams, Lark cards and Sandbox updates. Keep complete-message delivery for unsupported scenes, disabled adapters and outbound middleware that does not explicitly support revisions. Discord retains complete-message delivery.

  Preserve source-account leases, media order and confirmed delivery facts across cancellation, capacity rollover and follow-up answer phases. Preview drafts and uncertain outcomes do not become sent history. Bound each reply's semantic snapshot to 1 MiB, retain confirmed prefixes on failure and avoid replaying published answers.

  Project the latest confirmed message revision into paginated conversation history and synchronize Sandbox message updates across connections. Existing adapter implementations and complete-send callers remain compatible.

- 976886c: Preserve confirmed progressive reply content, routing and delivery evidence across cancellation, rollover and closing failures without replaying published text. Keep error dispositions and actual message references, and abort the owning provider request when its functional text consumer fails.

  Enable native Sandbox Markdown through the real Core projection so Console updates retain formatting in one message. Preserve instance-level streaming opt-outs, recall tombstones and multi-page synchronization. The first safe content is immediate; later updates retain the configured pacing, including large valid intervals.

  Keep Slack and Lark Markdown streaming within the current physical message. When continuation formatting cannot be verified, stop and retain confirmed content instead of replaying or silently changing it to plain text. Plain-text continuations retain their original reply route.

  Use rebuildable revision metadata and indexes in the existing conversation event table for bounded SQL history reads. Original event JSON and retention remain unchanged; older writers and models keep their compatible read path. Supported adapter streaming remains enabled by default, with complete-message fallback for disabled settings or outbound middleware without incremental: true.

- 032dc96: Only replay a failed scheduled task when its actual tool calls can be proven safe to repeat. Preserve committed or unknown effects, original attempt results and canonical delivery receipts instead of retrying the whole task after an observation or notification failure.

  Add generation-owned execution history for run times, attempts, basic progress, final output and separate delivery outcomes. Use the configured file or SQL backend, retain a UTC calendar month, and expose full-scope Console read and expired-history cleanup endpoints. Deleted task definitions do not delete their execution history; unfinished records are shown as unsettled or interrupted without automatic recovery.

  Keep observation writes independent of business execution. Coalesce snapshots through one bounded owner, including audit and optional activity projections. At most 128 completed runs / 16 MiB of unpersisted terminal snapshots are retained, including an in-flight snapshot; oversized or overloaded records produce visible recording gaps and never replay work. Shutdown does not wait indefinitely for an unabortable observation write.

  The optional internal Tool effect reporter grants no authority and does not require a plugin API floor change. Existing tools continue to work without it; undeclared effect safety is not inferred from their names or returned text. The Console execution-history UI requires the corresponding new Host endpoints; this changeset does not publish or deploy either application.

- Updated dependencies [b88e988]
- Updated dependencies [c15cef9]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/adapter@1.1.27
  - @zhin.js/im-contract@1.1.10
  - @zhin.js/middleware@1.1.12
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/jsx@1.1.9
  - @zhin.js/command@1.1.13
  - @zhin.js/component@1.1.12
  - @zhin.js/feature-kit@1.1.11
  - @zhin.js/handler@1.1.11
  - @zhin.js/permission@1.1.11
  - @zhin.js/schedule-feature@1.1.11

## 1.1.54

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

- f8505b0: Expose a read-only projection of current conversational prompts for the live Sandbox connection. Recover only delivered, unanswered prompts bound to the original scene, subject, deadline and active generation; answers continue through the existing single-settlement IM interaction path.
- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [2c3610a]
  - @zhin.js/adapter@1.1.26
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/command@1.1.12
  - @zhin.js/handler@1.1.10
  - @zhin.js/middleware@1.1.11
  - @zhin.js/plugin-runtime@1.1.18
  - @zhin.js/component@1.1.11
  - @zhin.js/schedule-feature@1.1.10
  - @zhin.js/permission@1.1.10

## 1.1.53

### Patch Changes

- c58c589: Group deferred tools by their canonical plugin or MCP server instead of installation paths. Omit already represented delivered text and ledger facts only from the current model projection, preserving full history and restoring facts when their covering reply leaves the active context. Allow tools to declare a synchronous, read-only availability predicate before turn disclosure, with execution-time checks remaining authoritative.

  Preserve every confirmed platform message identity across Agent replies and ICQQ split sends. Give each bubble its own stable single-message alias while retaining the reply's ordered association; preserve confirmed prefixes on partial delivery without retrying or inventing unknown message IDs.

- Updated dependencies [6345a38]
- Updated dependencies [ff3efe7]
- Updated dependencies [c58c589]
  - @zhin.js/adapter@1.1.25
  - @zhin.js/im-contract@1.1.9
  - @zhin.js/jsx@1.1.8

## 1.1.52

### Patch Changes

- f67883e: feat(group-rules): ADR 0039 切片 E — content-moderation 迁移到群规执行器（有意的行为收紧）

  - content-moderation 只判定广告 / 辱骂，判定后经新的 `groupRuleViolationToken`（`@zhin.js/core/runtime`，Agent host 提供）交给群规执行器；插件自身不再调用平台禁言 / 踢人。
  - 迁移：`groupModeration` 名单里的群首次有消息时，按默认模板「提醒 → 警告 → 禁言 600 秒，冷静期 30 分钟」为广告、辱骂各生成一条**待确认**规则并在群里出预览卡；**群主 / 管理员确认前只提醒 / 警告，不再自动禁言**。未装 Agent 时插件也只提醒 / 警告。
  - **新人发广告不再直接踢**：入群 10 分钟内的明确广告改为出一张踢人审批卡（每次人批），驳回或超时不踢。
  - 升级须知：原先自动禁言 / 踢人的群，升级后需群主或管理员在群里发 `/rule approve <短码>`（或 Console 批准）一次才恢复自动禁言；踢人始终逐次人批。

- 4d728c0: ADR 0043 §4 + §5 (H4) and the ADR 0041 actor-only amendment. Participant headers are no longer stored: user messages keep only `actor`, assistant messages keep `assistantActor` (plus the delivered `messageId`), and the header is rendered at the LLM boundary; legacy rows that still carry `name` are read as before. Headers now use session message aliases `id:m<n>` (an ordinal over the stored active path, so already-sent prefixes never change), `time:HH:mm` shown only when a minute has passed since the last shown time (the first message and the first message of a day also carry `date`), and `reply_to:m<n>` when the message replies to one inside the visible window. A reply to a message outside the window gets one `[quote id:…;user_id:…;time:…;] <first 120 chars>` line (media as placeholders, a forward expanded one level) so the model no longer needs `inspect_conversation_reference` for ordinary quotes; the quote is resolved by the ingress through the reference port (3 s timeout) and stored as structured `UserMessage.quote`. Tool arguments named `message_id` / `message_ids` / `*_message_id` / `reference` and `reply` segments accept the alias as well as the platform id; `inspect_conversation_reference` also accepts the quoted message id.
- 24a2b71: Danmaku mode (ADR 0038 slice E1): adapters can declare the `liveDanmaku` capability. In their conversations every danmaku is a candidate; the Agent collects them in one window (`ai.agent.inboundQueue.live`: `windowMs` 10000, at least `minIntervalMs` 15000 after the previous danmaku reply, newest 100 kept) and replies once — `mode: pick-one` (default) picks one danmaku and `@`s its viewer, `summary` answers the window as a whole. Danmaku turns run as an anonymous viewer with only tools that declare the new `readOnly: true` flag (native file reads, web search / fetch, knowledge and memory search are marked), no skills, sub-agents, MCP or shell, and never an approval card. Replies are audited as `danmaku_window_picked` with the candidate count and the viewers picked.
- 3771f7a: 修复同一群先后两人入群时后一次入群被当重复事件丢掉：side event 去重键（core 与 icqq）加入成员与操作人。
- 4f96ad5: Fix member-join welcome display: icqq now sends the mention's display name as the `at` element text, the joining member's nickname from the notice is threaded into `target.name`, and icqq group messages populate `conversation.name` from `group_name` so `{group}` renders the group name instead of the group number.
- Updated dependencies [e23cabc]
- Updated dependencies [24a2b71]
- Updated dependencies [d0e1fac]
- Updated dependencies [4f96ad5]
  - @zhin.js/adapter@1.1.24
  - @zhin.js/im-contract@1.1.8
  - @zhin.js/jsx@1.1.7

## 1.1.51

### Patch Changes

- 18296cf: 群欢迎 A9 方案 ②（#1012）：新增 `memberWelcomeOwnerToken`，Agent host 在根作用域提供。group-suite 欢迎发送前询问归属；会话开启 session-ops `welcome.enabled` 时让路不发，由 MemberLifecycle 发唯一一条，两边同时开启不再双发。未装 Agent 或会话未开启时行为不变。
- 08e64de: Expose current ICQQ conversation and bot-role inspection through a private Agent skill. Add conversation-scoped quote, merged-forward, own/member recall, and owner-approved leave-group tools with live platform checks and documented guild-channel limitations.

  Include real message IDs in the existing turn and conversation context so message operations can target actual messages without guessing.

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- 66b6404: 让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

  显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。

- adb4af2: 允许应用 Root 显式选择命令反馈、菜单展示与按完整会话区分的出站展示偏好。未配置、返回 undefined 或策略函数异常时沿用默认展示；保留权限、30 项分页、代际隔离和统一发送链，投递失败不重试。
- 69f9ef6: Scene awareness (#996): high-priority social events (bot muted/unmuted, join request, member joined/left, group notice updated, bot poked) now wake one short Agent turn on their own after a 3–5 s coalesce window (at most one wake per scene every 15 s), without waiting for the next human message. Low-priority events (reactions, card/title/remark changes, person-to-person pokes) never wake alone. Every turn carries the recent scene events as a short ephemeral `[Scene events]` block (≤5 lines / ≤200 chars) that is never stored in `agent_messages`. When the bot cannot speak, the wake only updates the session profile and skips the model, same as the session-profile speak gate. Configure with `ai.trigger.sceneEvents` (`conversations` defaults to `ai.trigger.ambient.conversations`).
- 17d1301: 新增危险工具硬闸（ADR 0036 切片 E，fail-closed）：

  - 工具可以声明 `risk: 'dangerous' | 'safe'` 和 `riskCategory: 'member' | 'publish' | 'funds' | 'identity'`。宿主内置一份危险工具清单，`ai.toolHardGate.dangerousTools` 只能把工具调高为危险，插件声明 `safe` 不能调低。
  - 危险工具执行前必须拿到一次全新的人工审批（`humanOnly`），`execApprovalMode: bypass`、自动审核、主人自动放行和已记住的授权都不能越过。拒绝、超时（默认 5 分钟）、无人可批都按拒绝处理，本轮不再重试同一工具或同一类别。
  - 资金类（`funds`）默认禁用；打开 `ai.toolHardGate.allowFunds` 后仍需审批。
  - 无人值守的轮次会排进审批队列，Console 通过 `plugin.root.tool-approvals` 查看、`plugin.root.resolve-tool-approval` 批准或拒绝（权限 `tool_approvals:read` / `tool_approvals:resolve`），批准后下一次同参数调用只放行一次。
  - 结果写进 `ai_decision_events`：`tool_hard_gate`（allow / deny）、`tool_approval`（defer / allow / deny），safe / 只读工具放行但仍写 `tool_call`（allow）；新增码 `tool_approval_requested`、`tool_approval_approved`、`tool_funds_disabled`、`tool_hard_gate_latched`、`tool_safe_allowed`（追加在码表末尾）。

- Updated dependencies [334e92d]
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
  - @zhin.js/adapter@1.1.23
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/command@1.1.11
  - @zhin.js/permission@1.1.9
  - @zhin.js/schema@1.1.4
  - @zhin.js/im-contract@1.1.7
  - @zhin.js/component@1.1.10
  - @zhin.js/feature-kit@1.1.9
  - @zhin.js/handler@1.1.9
  - @zhin.js/middleware@1.1.10
  - @zhin.js/schedule-feature@1.1.9
  - @zhin.js/jsx@1.1.6

## 1.1.50

### Patch Changes

- f98025b: 自动输出统一的每轮 Agent 用量汇总，DEBUG 展示模型调用与首请求上下文预算。沿用 TurnTrace 汇总主回合及子回合，传递缓存写入、模型身份和用量可用性；未知或部分数据明确标记，日志不包含消息、提示词或工具内容。
- 66ec1a5: Batch queued group moderation by conversation and sender while allowing ordinary inbound handling to continue. Preserve original-message evidence, notice-based escalation, model-owned recall and generation cancellation. Bound each group's pending buffer, explicitly audit reviews skipped at capacity, and attribute shared completions proportionally without counting the group request more than once. Older completion hosts retain per-message attribution.
- 7d68df6: 精简 Agent 内置固定提示词与消息说明，保留工具、审批和结构化回复能力。适配器 Skill 按会话场景拆分，群／频道管理仅向对应场景披露；提示段与模型消息段支持场景声明，沿用当前回合权限和 generation 投影。
- bf0fa9f: Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
- 3326db3: 减少已加载 Skill、工作区规则和工具参数 Schema 的重复上下文；保留原始记录、更新版本和压缩检查点。合并等价消息输出 Schema，稳定请求前缀与工具顺序，并沿现有开关扩展 Anthropic 历史缓存标记。上下文追踪包含输出 Schema 和去重后的消息估算。
- e91235e: Let the bot answer with a reaction, the way a person taps 👍 instead of typing. Adapters declare reactions with `segments.reaction` (values with meanings, optional scopes); the reply schema then has a `reaction` field limited to those values, the instruction says when a reaction alone is enough, and the reply port applies it to the message being answered before any words. icqq offers 21 QQ face reactions in groups.
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

- Updated dependencies [7d68df6]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/adapter@1.1.22
  - @zhin.js/database@1.1.5
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/command@1.1.10
  - @zhin.js/component@1.1.9
  - @zhin.js/feature-kit@1.1.8
  - @zhin.js/handler@1.1.8
  - @zhin.js/middleware@1.1.9
  - @zhin.js/permission@1.1.8
  - @zhin.js/schedule-feature@1.1.8
  - @zhin.js/jsx@1.1.5

## 1.1.49

### Patch Changes

- 974fa85: Add ambient group engagement (`ai.trigger.ambient`): for a group message nobody addressed, wait for the burst to settle, apply a per-group cooldown and hourly cap, and let a judge model decide whether the bot would naturally chime in. Engaged turns tell the Agent nobody called it, so it can still return no messages. Mentions, quotes and DMs are unchanged and always reach the Agent. Off unless groups are listed; `mode: shadow` logs judgments without replying.
- 1e9b3d6: Keep the bot's own messages in conversation context, labeled `You (this bot)`, instead of dropping them. Without them the Agent could not tell its own words from the members', missed what it sent outside its reply (command replies, music cards, scheduled notices) and lost the order of the chat. Progress updates (`⏳`), messages the bot later recalled (activity indicators) and interaction prompts with their answers stay out. An inbound message without a sender is now recorded as `Unknown sender` so it is never mistaken for the bot's own.
- Updated dependencies [070bb6b]
  - @zhin.js/kernel@1.1.5

## 1.1.48

### Patch Changes

- db06de8: An outbound payload that fails to render (for example a JSX card given an object as a child) is still rejected without leaking details to chat, but now logs a warning with the reason instead of failing silently. `ZHIN_LOG_LEVEL` / `LOG_LEVEL` now take effect even when the config sets no `log_level`; an empty variable counts as unset.

## 1.1.47

### Patch Changes

- 5be09ae: Re-export the `ConversationRef`, `DeliveryReceipt`, `CapabilityContext` and `OperationClientPort` types from `@zhin.js/core` and `zhin.js`, so toolkits such as `@zhin.js/testing` can type against the app's single `zhin.js` tree instead of depending on `@zhin.js/im-contract` and `@zhin.js/feature-kit` directly (#899). Type-only and additive.
- a3ab153: Adapters can declare `segments.model` per segment type (extra optional string fields the model may fill, plus a prompt hint) that only that platform's Agent replies see. icqq now declares the segment types its encoder supports and a share extension, so the Agent can send music share cards from tool results.
- e8f7309: Agent structured replies now offer only the segment types the reply endpoint delivers (derived from the adapter's `segments.supported`), and the model can send quick-reply keyboard buttons. reply / forward / face are no longer offered to the model because it has no reliable source for their platform IDs.
- 5afc18f: 引用一条消息再发送指令（例如引用入群申请通知回复「同意」）现在能正常匹配指令。平台把引用段放在文本之前，此前没有指令前缀时引用段挡在指令名前面导致不匹配、消息落到 AI；现在开头的引用段会移到指令文本之后参与参数解析，`message.replyTo` 不变。
- d3563d9: Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
- c618eb7: IM conversation turns now get a chat prompt: the workspace persona (SOUL.md) leads, a chat style section replaces the report-style one, and the coding-workflow sections are reduced to a short "workspace tasks" note; critical rules no longer claim to override the persona. Structured replies become `{"messages":[{"segments":[...]}]}` so the model can send several short messages, delivered in order with a short pause; a legacy single `{segments}` reply is still accepted. Workspace prompt files may use a `{{nickname}}` slot filled from `ai.agents.<name>.nickname` (default `Zhin`).
- fbfefb7: Share segments accept `data.platform` (the song's music service: qq, netease, kugou, kuwo, migu). icqq maps it to the matching music app id when `config.appid` is absent and offers it to the Agent; adapters that cannot render share app metadata reject it like `audio` and `config`.
- Updated dependencies [8302701]
- Updated dependencies [9943df6]
- Updated dependencies [a3ab153]
- Updated dependencies [de5b2a1]
- Updated dependencies [c5741c0]
- Updated dependencies [d3563d9]
- Updated dependencies [584161e]
- Updated dependencies [2a1a3d9]
- Updated dependencies [e40899f]
- Updated dependencies [fbfefb7]
  - @zhin.js/command@1.1.9
  - @zhin.js/adapter@1.1.21
  - @zhin.js/feature-kit@1.1.7
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/component@1.1.8
  - @zhin.js/handler@1.1.7
  - @zhin.js/middleware@1.1.8
  - @zhin.js/schedule-feature@1.1.7
  - @zhin.js/jsx@1.1.4

## 1.1.46

### Patch Changes

- c407bd2: 安装 HTML 渲染能力时，内置指令菜单通过统一发送链生成菜单图；渲染失败或平台无法投递图片时保留原有文本菜单。菜单采用可自定义标题、配色与背景的三列主题，每页最多 30 项，支持根菜单与插件菜单翻页。平台同时支持原生 Markdown 与按钮时自动附加上一页、下一页控件，在边界禁用；其他平台保留文本导航。Telegram 禁用按钮映射为 Bot API 10.3 DisabledButton。补充中英文文档。
- 064b06d: 通过中立的 operation input 生命周期 hook 将真实入站运行代的退休信号传给 CommandContext.signal，使补问与确认能及时取消。
  保留旧 lease 普通操作和已开始发送的正常排空语义，不全局拦截回复。
- b58548a: 为命令增加可选冷却、并发准入与一次进度提示，以真实发送者和完整会话身份隔离；Root 预算跨热更新共用，并在业务、渲染、中间件和已启动发送真正结束后释放。准入拒绝通过 limited 状态与有界原因进入消息诊断，避免回落到 AI。
- e914a93: 新增按消息查看的有界运行诊断，关联真实入站决策与发送结果，保留平台降级原因且不存储消息正文或原始异常。
- e914a93: 改善跨平台富消息的文本降级：保留安全链接、列表层级、表格列和图片描述，避免输出嵌入媒体与链接凭据；代码内容和作者指定的 HTML 备用文本继续保留。

  文本键盘降级不再为禁用按钮注册可执行编号或别名；启用按钮的显示编号与当前会话、generation 的实际映射保持一致。

- 064b06d: 提供只读 SnapshotLease.retirementSignal，在运行代退休时及时结束交互等待，同时保留旧操作的 lease 排空语义。
  问答在发送提示前建立精确会话与发送者约束，发送异常撤销等待；原生回答使用每题独立的短 callback token，避免旧按钮回答新问题。
- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/command@1.1.8
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/handler@1.1.6
  - @zhin.js/adapter@1.1.20
  - @zhin.js/component@1.1.7
  - @zhin.js/middleware@1.1.7
  - @zhin.js/schedule-feature@1.1.6

## 1.1.45

### Patch Changes

- dd7f25f: Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。

## 1.1.44

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/adapter@1.1.19
  - @zhin.js/command@1.1.7
  - @zhin.js/component@1.1.6
  - @zhin.js/database@1.1.4
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/handler@1.1.5
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/interaction@1.1.2
  - @zhin.js/jsx@1.1.3
  - @zhin.js/kernel@1.1.4
  - @zhin.js/middleware@1.1.6
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/schedule-feature@1.1.5
  - @zhin.js/logger@1.1.2
  - @zhin.js/schema@1.1.3

## 1.1.43

### Patch Changes

- bf52b40: 修复 IM 会话事件背景污染当前回复：机器人撤回自己发出的消息（如活动指示「正在处理中...」的 autoRemove）不再进入下一轮的会话事件上下文；超过 30 分钟的积压消息不再注入；事件块明确标注为背景、不要直接回答，并提示下一条用户消息才是需要回复的当前消息。
- bf52b40: Harness 组合修复：直接调用被策略移除的 bash 不再被自动加载进会话；standalone 子 loop 支持传入父 turn 策略以同样隐藏 bash；交互提示的回答（如审批回复 y）不再作为背景事件进入下一轮上下文。
- bf52b40: 修复 IM 审批静默拒绝：审批结果区分「用户拒绝 / 审核器拒绝 / 超时 / 无审批通道」，并以不诱导重试的文案返回给模型；审批提示支持回复 y/同意、n/拒绝；超时不再被当作用户拒绝记忆；owner 读取工作区内 package.json、锁文件等非机密项目文件不再需要确认（.env、密钥等仍需确认，写入审批不变）。
- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- 9891e66: 入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

  - 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
  - self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
  - `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
  - `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
  - 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。

- 9891e66: 入站来源判定的摘要兜底仅用于 group/channel 会话；Registry 就绪且账号已知的发送者不再走摘要匹配；摘要命中最多映射为 peer_bot / member（只记录），不再映射为被丢弃的 self，修复真人复读 Bot 文本被静默丢弃。plugin-runtime/im 入口改为具名导出 MessageOrigin、isMessageOrigin、RoomMembershipPort、roomMembershipToken，来源分类器实现细节标 @internal。
- 4778587: 补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

  修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

  保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

  明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。

- 40537e3: 修正 Console 配置 Schema 的本地包、实例别名和嵌套插件解析，按 Runtime 的包解析规则定位；合并继承插件后检查重复实例。缺失 Schema 与非法 Schema 分别反馈。校验 required 元数据，递归拒绝插件文件中表单不支持的引用、组合、动态字段与 JSON Schema 元组，避免丢弃约束后展示不完整表单。内置 Host 配置保留既有字段投影，复杂配置仍可使用配置文件或源码编辑器；不将该投影视为完整 JSON Schema 编辑器。

  业务 Outbound Host 发送会拒绝失败、拦截、不支持或结果未知的投递，避免转为成功的空消息 ID；回执保留明确的平台拒绝状态与未知状态，不凭错误码覆盖投递证据。可选状态提示仍由调用方处理发送失败。

  RSS 从公开 Message 字段提取会话，以端点隔离订阅，拒绝缺失或不支持的父频道/线程地址，避免改投其他会话。无效来源的 extractChannelInfo 返回 null，移除伪造会话的 SMOKE_CHANNEL 导出。修正实用插件的安装命令与实例配置示例。

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- 9891e66: `RoomMembershipPort` 新增可选 `hasRoom(conversation)`：返回 true 时，同一会话的多个 Endpoint 收到的同一条人类消息（按平台+会话+发送者+消息 id）只路由一次，其余只记录；不实现 `hasRoom`（目前没有实现）则行为不变，普通群、私聊、无消息 id 的消息仍由每个 Endpoint 各自处理。去重判定出错时 fail-closed：记录并 publish、告警、不路由。
- 9891e66: Room Router 与 Room Bus（B2b）。`@zhin.js/core`：`RoomMembershipPort` 新增可选 `route(input)`，必须与 `hasRoom` 成对实现（同步、无副作用，按消息缓存决策，返回目标 Endpoint 与按优先级排序的 `fallbackEndpointIds`）；Room 会话中处理消息的目标 Endpoint 改由 Router 决定，目标副本强制 `mentioned=true`，其余副本只记录。core 无法预知哪个 Endpoint 会收到副本（例如隐私模式），目标没收到副本时，非目标成员副本在宽限期（默认 2s）后按 fallback 优先级接管，保证消息恰好处理一次、不静默丢失；`route` 抛错退化为先到先得。带 action 段的平台按钮回调只由接收它的 Endpoint 处理，绕过 Room 路由和去重；无消息 id / 无发送者 / 私聊（unkeyed）保持逐 Endpoint 处理；待回答探测仅在本条消息能解析到该 Endpoint 的按钮或有该发送者的待回答 claim 时为 true。没有 `route` 时保持 B2 的先到先得去重。`ImRuntimeOptions` 新增 `inboundClaimPending`。`@zhin.js/workroom`：新增 Room Registry、Room Router（待回答 > @ > 回复 > coordinator > 按角色匹配，@alias 使用 Unicode 边界）、`createRoomMembershipPort`、Room Bus（handoff 事件 + 经正常发送链的群内可见投影）。

  `hasRoom` 按“会话 + 接收 Endpoint”判定，只对成员 Endpoint 的副本为 true，非成员 Bot 按普通群处理（不 claim、不强制 mentioned）；decision 之外已投递副本的成员作为最低优先级接管候选（带 `room_unlisted_member_takeover` 告警），不再静默丢弃。

- Updated dependencies [9891e66]
- Updated dependencies [bf52b40]
- Updated dependencies [386150d]
- Updated dependencies [2dfe5fa]
- Updated dependencies [2dfe5fa]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/interaction@1.1.1
  - @zhin.js/schema@1.1.2
  - @zhin.js/command@1.1.6
  - @zhin.js/middleware@1.1.5
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/schedule-feature@1.1.4
  - @zhin.js/kernel@1.1.3
  - @zhin.js/feature-kit@1.1.4
  - @zhin.js/handler@1.1.4
  - @zhin.js/component@1.1.5

## 1.1.42

### Patch Changes

- 5ab6307: 修正 JSX 的默认语义为消息排版：内置小写标签无需导入并提供属性类型，标签与属性映射为 Segment；只有显式 html / Html 子树序列化为 HTML。支持注册组件标签、原生 share 与平台 card，以及 Button onClick 回跳与返回值自动回复；同步脚手架、示例和文档。

  运行实例统一分配递增、不重复的按钮降级编号，会话交错发送时允许跳号，回调有效期为一小时，发送确认前的点击可正常执行；等待文字输入不会吞掉 JSX 按钮事件。修复 Card 原生 key 载荷、带 MIME 参数的图片 data URI、注册组件递归深度和媒体/HTML 类型约束。原有裸 HTML 布局需要显式包裹 `<html>` / `<Html>`。

- Updated dependencies [36f1d02]
- Updated dependencies [5ab6307]
  - @zhin.js/database@1.1.3
  - @zhin.js/jsx@1.1.2

## 1.1.41

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

- Updated dependencies [badcc1f]
  - @zhin.js/command@1.1.5
  - @zhin.js/component@1.1.4
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/jsx@1.1.1
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/middleware@1.1.4
  - @zhin.js/adapter@1.1.17
  - @zhin.js/handler@1.1.3
  - @zhin.js/schedule-feature@1.1.3
  - @zhin.js/permission@1.1.4

## 1.1.40

### Patch Changes

- b9b3953: Fix adapter connection races, transport health reporting, candidate rollback and delivery acknowledgement boundaries. Separate generation admission from locally observed connectivity, reject unconfirmed message receipts, and mark uncertain delivery results without recommending automatic replay.

  Class and compact endpoints should expose a `transportState` getter to report physical connection or local listener health. Unobserved endpoints now report an unknown transport and remain offline in diagnostics. Platform stability tiers remain unchanged until real account acceptance evidence is available.

- b9b3953: Resolve command permissions and command/component contexts from the current operation snapshot when unchanged projections are reused after hot reload. Preserve old snapshots for draining operations.
- b9b3953: Validate persisted Workroom Endpoint bindings against the exact projected candidate generation, including adapters authored by the project root. Defer file-backed Endpoint validation until candidate activation. Resolve Console Endpoint package aliases consistently with discovery and reject ambiguous aliases instead of selecting an account.

  Resolve Workroom human ingress from the canonical Endpoint capability identity and the operation Endpoint projection so root-local adapters use the same Catalog address as Console discovery. Unknown or duplicate canonical identities cannot select another account.

- b9b3953: 修复框架生命周期与消息处理的竞态：HMR 停止等待异步 watcher 清理，并在清理失败时仍等待在途 reload；命令前缀通过端点能力所属插件读取配置，前导空白不再丢失结构化参数；工具在异步策略检查后再次检查取消信号；文件缓存遇到超限替换时删除旧内容并保持字节计数一致。
- b9b3953: Bind reused middleware projections to the current operation snapshot after capability hot reload, while retaining the old snapshot for draining operations.
- b9b3953: Bound QQ startup to 30 seconds with cancellation and late-client cleanup, own asynchronous CLI startup failures, and patch qq-official-bot session startup so authentication/receiver failures reject the returned promise without orphan rejection or lost synchronous readiness.

  Encode native QQ callback buttons with official action type 1, subscribe to interaction events by default, and map SDK action notices into canonical clicks with platform ACK and honest source-message association metadata.

  Reject outbound messages containing segments excluded by an explicit adapter supported policy, and reject unimplemented QQ share cards instead of silently dropping title/description/URL while confirming neighboring text.

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/adapter@1.1.16
  - @zhin.js/im-contract@1.1.3
  - @zhin.js/command@1.1.4
  - @zhin.js/component@1.1.3
  - @zhin.js/middleware@1.1.3
  - @zhin.js/kernel@1.1.2

## 1.1.39

### Patch Changes

- 43eda99: Unify Notice and Request payloads with their public types and runtime exports. Use camelCase fields, preserve native data under metadata, and bind canonical endpoint identity and request actions to the held generation. Remove legacy data aliases and from factories.

  Keep login and lifecycle signals as independent SystemEvent payloads on system.receive, without chat conversation fields or user interaction. Update built-in adapter projections and authoring guidance.

- 0de4836: Expose the canonical Plugin Runtime `Message` contract from `@zhin.js/core`, `@zhin.js/core/runtime`, and the `zhin.js` root entries, and migrate Agent, permission, and GitHub integrations to the fields middleware actually receives. Document and lock the `EndpointEvent<Notice | Request>` handler boundary so side-event payload fields match editor inference.
- Updated dependencies [0de4836]
- Updated dependencies [fa542a2]
  - @zhin.js/permission@1.1.3
  - @zhin.js/schema@1.1.1
  - @zhin.js/command@1.1.3
  - @zhin.js/adapter@1.1.15

## 1.1.38

### Patch Changes

- 5b5d270: Complete the canonical share segment contract and preserve native ICQQ share delivery through Core and AI outbound pipelines.
- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
- Updated dependencies [a417170]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/database@1.1.2
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/adapter@1.1.15
  - @zhin.js/command@1.1.2
  - @zhin.js/component@1.1.2
  - @zhin.js/handler@1.1.2
  - @zhin.js/middleware@1.1.2
  - @zhin.js/permission@1.1.2
  - @zhin.js/schedule-feature@1.1.2

## 1.1.37

### Patch Changes

- c861789: Own the Agent lifecycle event contract inside the Agent package and remove the
  classic Plugin event subscription bridges. Runtime consumers now subscribe
  through explicit event targets instead of Plugin AsyncLocalStorage. Agent event
  publication no longer double-writes into `Plugin.dispatch()`, and Core no longer
  declares Agent or Schedule events in `Plugin.Lifecycle`. Replace the process-global
  activity bus with a generation-owned Resource, and remove concrete Plugin objects
  from ZhinAgent and its tool security path.
- 1414ccb: Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
- 743d470: Make `@zhin.js/tool` the sole owner of Agent Tool input Schema admission, JSON Schema projection, and pre-execution parsing. Require an object-root JSON Schema or the public Zod 4 `safeParse` plus `toJSONSchema` contract, remove Zod 3 structural compatibility, and delete the duplicate `@zhin.js/core/tool-zod` entry point.
- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- cd54131: Remove the deleted `usePlugin`, `getPlugin`, and host-root registry signatures
  from the public runtime instead of retaining throwing or no-op compatibility
  exports. Remove the module-global `registerAIHook` compatibility registry;
  Agent hooks now belong to generation-owned resources and canonical stream events.
- 5855db7: Decouple canonical Message, Side Event, and middleware contracts from the classic Adapter class registry. Adapter identity now follows the Plugin Runtime string contract, and the unused `RegisteredAdapters`, adapter-message inference, and classic Endpoint config aliases are removed.
- ec921d2: Move conversational claims, typed question sequences, action routing, and keyboard fallback state into a dedicated runtime-owned interaction coordinator. `ImRuntime` now delegates interaction behavior instead of implementing a second state machine inside the message gateway.
- 9110ab8: Move optional Speech loading and pipeline ownership into the CLI composition root. Agent media handling now depends on an explicitly injected `AudioTranscriptionPort`; Core no longer exposes a process-global Speech loader, and Logger no longer exposes the process-global warn-once registry.
- b853dba: Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
- e561309: Give each IM runtime one dedicated conversation owner for event-store replacement, inbound and outbound fact recording, notice normalization, reference lookup, context aggregation, and consumer cursors. Split the conversation contract into reader and writer ports so Agent and CLI receive only the read capability while Core retains mutation authority.
- d4c6175: Move generation-leased Endpoint discovery, capability lookup, Console delivery, controls, and management into a dedicated `EndpointRuntime`. Remove the flat Endpoint methods from `ImRuntime`, migrate Host composition to `im.endpoints`, and narrow the outbound Host dependency to its required runtime port.
- 7a0e1ca: Move Endpoint ingress normalization, generation leases, inbound middleware, handlers, interaction and command routing, Agent fallback, and side-event action scopes into one `InboundRuntime`. Remove the flat `ImRuntime.receiveEndpointEvent()` entry and require Adapter ingress through the canonical `endpointEvents.receive()` gateway.
- 103b5d3: Move rendering, outbound policy projection, middleware execution, Endpoint delivery, conversation recording, and observer publication into one `OutboundDeliveryRuntime`. Replace the flat `ImRuntime.onMessage()` method with a read-only `messageEvents` subscription source and narrow Console message and Inbox dependencies to explicit ports.
- 5a7a7f7: Remove the duplicate classic interactive handler registry and process-global keyboard fallback store. `ImRuntime` now owns one encapsulated interactive router whose handlers and fallback mappings are isolated by runtime instance, generation, and conversation.
- b076eae: Replace the permission host factory with an explicitly owned `PermissionHost` class. Each IM runtime now holds a private permission registry, so platform and custom checkers cannot leak between roots or generations.

  Remove Core's duplicate permit parser, checker, legacy `PermissionFeature`, and process-global platform permit registry. Permit syntax and evaluation now have one owner in `@zhin.js/permission`, and scene-management tool construction no longer mutates global authorization state.

- 1cb1163: Remove the unused process-global `Adapter.Registry`, `Adapter.register`, and `Adapter.Factory` APIs. Adapter definitions and live instances are now discovered and owned only by the current generation's `AdapterIndex`.
- be3061e: Remove the classic Core `Adapter` class, Core `Endpoint` compatibility type, capability WeakMap, and their connection and lifecycle helpers. Platform integrations now have one model: `defineAdapter`, `Endpoint<TClient>`, and the current generation's `AdapterIndex` from `zhin.js/adapter`.
- 75f8332: Remove the classic `MessageCommand` and `CommandFeature` runtime, its Plugin extension, legacy Endpoint command registration, and the command branch in the classic dispatcher. Commands now have one execution model: `defineCommand` definitions projected into the generation-owned `CommandIndex`.
- 81935e2: Remove the unused classic `ComponentFeature` registry and `Plugin.addComponent` extension. Component definitions are discovered and projected by the generation-owned Component Feature, while Core keeps only the message and JSX rendering primitives it owns.
- f9ed01b: Remove the unmounted classic Config and Schema Feature registries, schema-driven Endpoint provisioning service, and their service-locator based Adapter hooks. Runtime configuration now has one generation-owned authority through `ConfigComposer`, `ConfigView`, and `primaryConfigToken`; adapter endpoint configuration remains owned by `@zhin.js/adapter` and its explicit command surface.
- ac0ab50: Remove the closed classic Core Plugin runtime, its duplicate dispatcher and inbound pipeline, and the public types that only described those dead paths. Handler authoring now derives canonical IM event types directly from the generation-owned Runtime contract.
- 5140ce1: Remove the unmounted classic Database Feature, its `defineModel` extension, and the process-global post-start migration hook. Database tables and lifecycle now have one authority through the generation-owned Database Host. Also remove the inactive online `bot_id` compatibility migration; supported schemas must use `endpoint_id` directly.
- 522d75f: Remove the classic `Plugin.adapters` directory and `Plugin.injectAdapter()` service-locator helper. Live Endpoint discovery now belongs exclusively to the current generation's `AdapterIndex`.
- a7611b3: Remove the unmounted classic `ProcessAdapter`, `ProcessEndpoint`, and process stdin runtime helpers. Local interaction is owned by the Sandbox Adapter and CLI Host, so Core no longer exposes a second process-global transport path.
- 8823044: Remove the disconnected classic Rich Segment class hierarchy, mutable registry, renderer policies, optional-peer loaders, and adapter contract facade. `segment.html`, `segment.markdown`, `segment.qrcode`, and `segment.tts` now create canonical message segments directly; Plugin Runtime's generation-owned outbound normalization remains the sole rendering and media-negotiation path.
- 379439b: Remove the unmounted classic Core `ToolFeature` and `SkillFeature` registries and the unused Agent bridge that copied them into a mutable resource hub. Tool and Skill authority now comes only from generation-owned Feature projections consumed by Plugin Runtime `CapabilityIngress`; Core retains only the stateless IM access predicate used by the current path.
- 11c9352: Remove dead deprecated aliases from Core and Agent, including legacy Tool and outbound segment types, the old interactive segment helper, duplicate Session and Schedule names, obsolete log formatters, and the process-global Task Executor drain shim. Current APIs now expose one name and one ownership model for each behavior.
- 135ac91: Remove the unmounted classic Schedule, AgentPreset, and MessageFilter Feature registries. Plugin Runtime scheduling now has one owner-scoped authority through `scheduleHostToken`, Agent presets have one authority in the Agent Feature and Resource Hub, and message admission remains in the active middleware and guardrail pipeline.
- 140cf0f: Remove the legacy composed side-event mapping aliases in favor of structured `mapNoticeParts` and `mapRequestParts`. Delete unmounted Agent default hook, tool, and subagent modules that exposed no runtime behavior.
- 251e4d2: Remove the unused Plugin Runtime service tokens that referenced classic Core Feature registries. Runtime capabilities are exposed through their generation snapshot projections and owned resources instead of inert compatibility tokens.
- 203ad34: Remove process-global expression and proxy caches from Kernel evaluation. Every evaluation now compiles independently and owns its proxy identity map for the lifetime of one sandbox, so unrelated runtimes cannot share hidden evaluator state.
- e6c5113: Remove the unused Kernel PluginBase, mutable Feature registry, string-based dependency injection, and prototype extension registry. Plugin lifecycle now belongs solely to the generation-owned Plugin Runtime, while capability discovery and projection belong to Feature Kit.
- e0f6478: Remove plugin.yml build detection, package-name heuristics, and the unused Core PluginManifest type. Smart builds now recognize plugins through the canonical package.json zhin manifest and applications through an explicit zhin.js dependency.
- 5c3858e: Make `@zhin.js/im-contract` the explicit zero-dependency owner of transport identities, canonical segments, media guards, conversation facts, stores, and delivery contracts. Platform adapters now read media contracts from that foundation instead of reaching through Core.
- Updated dependencies [13f7301]
- Updated dependencies [a9e4a40]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [9110ab8]
- Updated dependencies [3d42fc9]
- Updated dependencies [eb3227a]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [b076eae]
- Updated dependencies [73a24b7]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [65d0391]
- Updated dependencies [5c3858e]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/command@1.1.1
  - @zhin.js/adapter@1.1.14
  - @zhin.js/middleware@1.1.1
  - @zhin.js/handler@1.1.1
  - @zhin.js/component@1.1.1
  - @zhin.js/schedule-feature@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/kernel@1.1.1
  - @zhin.js/im-contract@1.1.1
  - @zhin.js/permission@1.1.1
  - @zhin.js/database@1.1.1

## 1.1.36

### Patch Changes

- Updated dependencies [769e67f]
  - @zhin.js/adapter@1.1.13

## 1.1.35

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- Updated dependencies [1fc6270]
  - @zhin.js/adapter@1.1.12
  - @zhin.js/command@1.1.0
  - @zhin.js/component@1.1.0
  - @zhin.js/database@1.1.0
  - @zhin.js/handler@1.1.0
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/interaction@1.1.0
  - @zhin.js/kernel@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/middleware@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9
  - @zhin.js/schema@1.1.0

## 1.5.16

### Patch Changes

- Updated dependencies [f7ee28d]
  - @zhin.js/adapter@1.2.2

## 1.5.15

### Patch Changes

- ba7e17a: Prevent concurrent Workroom discussions from losing their Orchestrator handoff, route those handoffs before ordinary commands, resolve cross-Endpoint projection replies through their canonical message reference, respect the global AI trigger switch, and reject unknown canonical Console session keys when the durable inbox is available.
- 7108d0b: Resolve uniquely mentioned Workroom members to their active Assignment, isolate Orchestrator turns from ordinary room sessions and conversation tails, remove classic subagent delegation from Workroom capabilities, deliver replies through the canonical Orchestrator Endpoint, reject untrusted bot identity metadata, and recognize implicit default Endpoints during Catalog validation.
- Updated dependencies [a5ee497]
  - @zhin.js/database@1.0.81

## 1.5.14

### Patch Changes

- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- 12025ee: Project exact Endpoint control capabilities through the outbound Host and connect native typing, editable progress, ordered Agent/subagent/tool events, and transient Schedule completion states to IM activity feedback. Gate event ingress by the committed Runtime generation, pin Endpoint operations and retirement cleanup to that generation's IM snapshot, and guarantee terminal cleanup across public Agent error and cancellation paths.
- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [4e8117c]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/adapter@1.2.1
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/command@1.0.16
  - @zhin.js/component@1.0.13
  - @zhin.js/handler@1.0.4
  - @zhin.js/logger@1.0.77
  - @zhin.js/middleware@1.0.13
  - @zhin.js/permission@1.0.4
  - @zhin.js/database@1.0.80
  - @zhin.js/kernel@1.0.8

## 1.5.13

### Patch Changes

- f2c532f: Expose exact per-Endpoint message operations through one validated Adapter capability model, route Core control calls through declared active capabilities, and connect existing recall, edit, reaction, and typing implementations across platform adapters.
- Updated dependencies [f2c532f]
  - @zhin.js/adapter@1.2.0

## 1.5.12

### Patch Changes

- 5969c5b: Remove legacy compound-string message targets and Endpoint control probing. Endpoint control and outbound Host operations now carry structured `MessageRef` identities. Endpoint send has one exact result contract (a platform message id), which IM Runtime projects into `DeliveryReceipt.message`; arbitrary result guessing is removed.
- 5969c5b: Wire ICQQ login challenges (QR / slider / SMS / auth) through LoginAssist so pending tasks survive Console refresh; add login.list/submit/cancel RPC and TTY stdin consumer.
- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 5969c5b: Add SideEventGateway so adapters forward notice/request/system into HandlerIndex. HandlerContext now exposes only generation-safe capabilities and prompt ports; live Endpoint escape hatches are removed.
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
- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/adapter@1.1.11
  - @zhin.js/command@1.0.15
  - @zhin.js/handler@1.0.3
  - @zhin.js/interaction@1.0.1
  - @zhin.js/component@1.0.12
  - @zhin.js/middleware@1.0.12
  - @zhin.js/permission@1.0.3

## 1.5.11

### Patch Changes

- Updated dependencies [b9e6302]
  - @zhin.js/handler@1.0.2

## 1.5.10

### Patch Changes

- d3920e9: Extract the `handlers/` convention into a dedicated Feature package `@zhin.js/handler`, and mount it as a platform Stable Feature on `@zhin.js/core` (inherited by Roots via `platformFeatures` / `zhin runtime start`).

  Also add the `zhin.js/middleware` facade re-export so Stable Feature authoring is consistent with `zhin.js/command` / `adapter` / `component` / `handler`.

  `@zhin.js/feature-kit` is now kit-only: handler authoring, `HandlerIndex`, and the Feature provider entry are removed. Do not list `@zhin.js/feature-kit` in `zhin.features`.

  **Authoring:** apps and plugins that depend on `zhin.js` should import `definePlugin` from the main entry (`zhin.js`) and other `define*` from facade subpaths (`zhin.js/command`, `zhin.js/middleware`, `zhin.js/handler`, `zhin.js/adapter`, `zhin.js/component`) — do not separately install `@zhin.js/plugin-runtime` or the `@zhin.js/*` Feature implementation packages. Workspace plugins/examples/adapters were updated accordingly (imports + deps; child plugins keep `zhin.features` mounts and peer `zhin.js`). CLI `zhin new` / migrate cutover scaffolds follow the same rule.

  BREAKING CHANGE: `@zhin.js/feature-kit` no longer exports handler APIs and is no longer a `type: "feature"` package.

- Updated dependencies [d3920e9]
  - @zhin.js/handler@1.0.1
  - @zhin.js/adapter@1.1.10
  - @zhin.js/command@1.0.14
  - @zhin.js/component@1.0.11
  - @zhin.js/middleware@1.0.11

## 1.5.9

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10
  - @zhin.js/command@1.0.13
  - @zhin.js/adapter@1.1.9
  - @zhin.js/component@1.0.10
  - @zhin.js/middleware@1.0.10

## 1.5.8

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

- 953cfe1: Remove the obsolete Collaboration Scene/Cell domain after Agent coordination
  moved to the Orchestration Kernel. This deletes `/collab`, the initialization
  wizard, Scene identity and membership repositories, archived Cell pipeline
  state, seven Collaboration database tables, and their public exports.

  The top-level `collaboration` configuration key is no longer accepted and now
  fails schema validation. Agent startup is selected only by `ai` or `assistant`.

  Keep the optional Five-Agent workflow as an independent Agent module with
  `FiveAgentRole`, role binding, and role capability policy interfaces. It no
  longer depends on IM scenes, Bot membership, or text handback conventions.

  Remove `StructuredOutboundDetectInput.collaborationCell`; structured outbound
  selection is based only on tool, handoff, and Adapter capability requirements.

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

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/adapter@1.1.8
  - @zhin.js/command@1.0.12
  - @zhin.js/component@1.0.9
  - @zhin.js/middleware@1.0.9
  - @zhin.js/permission@1.0.2

## 1.5.7

### Patch Changes

- 36cb1ca: fix(core): 入站 Message 的 sender.roles 携带 master/trusted 框架角色

  ImRuntime 新增 `enrichSender` 选项，在构造 Message 前由组合根（start-command）注入，
  从 config 的 `ai.trigger.masters`/`ai.trigger.trusted` 及 endpoint 级 master/trusted 判定后
  将框架角色合并进 `sender.roles`。整个下游链路（命令分发、agent ingress）均可直接读取。

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
