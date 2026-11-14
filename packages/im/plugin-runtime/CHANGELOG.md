# @zhin.js/plugin-runtime

## 1.3.0

### Minor Changes

- 7cc703a: 热重载重建范围按受影响的子树分别计算（#1250 `hmr-multi-change-full-rebuild`、`hmr-stale-cross-package-import`）：同一批里改了几个插件（入口、子树内的辅助模块、能力文件混在一起）时，只重建这些插件子树并替换子树外受影响的能力，其他插件 Scope、适配器投影与 Endpoint 原样保留（不重连、不重登）；适配器只在自身源码或配置变化时重建。Root 安装器可以用新的 `watchProjectFiles({ patterns, onChange })`（`RootResourceContext`）声明自己读取的项目文件，只改了这些文件（例如 `SOUL.md` / `AGENTS.md` / `TOOLS.md`、`ai.knowledge` 目录）时不再重建 Root，改为通知声明方重读（Agent Host 已声明，turn 读取最新 bootstrap；`hmr_reload | rebuilt: resource`），未声明的根目录文件仍整棵重建并记 `hmr_full_rebuild` 原因。根插件 tool 等通过包名引用挂载的本地插件模块时，被引用文件变化会让引用方一起重新加载（新代码，所有重载的引用方共享同一个新实例）；未变化的插件包保持原有的共享实例，引用方重载不会重复执行其顶层副作用；依赖索引只沿包名导入进入被监视的目录，不再遍历 workspace 链接的框架源码（启动不再变慢）；引用了普通 workspace 库等无法刷新的依赖方，在 `hmr_reload` 的 `unrefreshed_dependents` 和 warn `hmr_unrefreshed_dependents` 中列出。子树重载因拓扑变化退回整棵重建时也记 `hmr_full_rebuild` 原因；没有归属记录的文件（例如 Feature 包内的文件）仍整棵重建并说明原因；批次中其余部分重载失败时，已声明的项目文件仍会通知声明方。
- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

- b56cca9: 定时任务（#1250）：`ScheduleJobRegistration` / `defineSchedule()` 新增可选 `title`、`titleI18n`、`kind`（`plugin-internal` 默认 / `user-task`）；实例 Schedule Host 记录每个任务最近一次实际执行的开始 / 结束时间与成功 / 失败（`lastRun`）。`schedule:list` / `cron:list` 的内存任务行新增可选 `kind`、`title`（按请求 `locale` 解析）、`titleI18n`、`displayName`、`lastExecutedAt`、`lastFinishedAt`、`lastDurationMs`、`lastStatus`、`lastError`，持久任务行新增 `kind: 'user-task'`。官方插件的内部轮询任务补中文标题。

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

## 1.2.1

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

- a86bdc7: 功能覆盖迁入数据库（ADR 0057 §2）：

  - 适配器 / 账号 / 会话三级功能覆盖统一存在项目数据库表 `feature_overrides`（`level` 列为 `adapter` / `endpoint` / `conversation`，主键由 `(plugin, level, key)` 生成）；旧表 `feature_conversation_overrides` 的行首次加载时复制过来，旧表保留只读。全局默认值仍是配置文件里的插件块，全局开关仍是 `disable_plugins`。
  - `configFor` / `isEnabledFor`、分发门禁与 Console `feature.*` 从数据库读取适配器 / 账号级覆盖，合并顺序与锁定规则不变；Console 与聊天「功能 设置 / 开启 / 关闭」的适配器 / 账号级写入改写数据库，立即生效、不再改写配置文件。新增 `readStoredFeatureOverrides`、`validateStoredFeatureOverride`。
  - 首次启动自动迁移：把配置文件里各插件块的 `overrides` 导入数据库，成功后备份原文件到 `.zhin/backups/` 并原子删除这些块，记录写入 `.zhin/migrations/feature-overrides.json`；失败时配置文件不变、下次启动重试。迁移完成后配置文件再出现 `overrides` 会在启动与配置更新时被拒绝。
  - MongoDB / Redis / memory 方言下拒绝覆盖写入（503 `feature-overrides-unpersisted`），会话级也不再只存内存。
  - `feature.*` 请求与响应形状不变；适配器 / 账号级的 `revision` 改为数据库行的修订号，仍兼容旧版 Console 传入的当前配置修订号。

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

## 1.2.0

### Minor Changes

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

- fd22375: 修复功能分层配置（ADR 0050 / 0055）审查发现的问题：

  - 覆盖校验：值为 `null` 的键（显式清空）不再绕过字段白名单，下级层不能借此清掉仅全局字段，嵌套清空也必须指向 Schema 中存在的字段。
  - 环境变量引用：聊天自助在任何层级都拒绝写入 `${…}` / `env://`；Console 的 `feature.set-override` 只允许具备 `ops.env.write` 的用户写入，防止借 `feature.configure` 读取密钥。
  - 会话覆盖存储：数据库写入检查影响行数，0 行或并发插入同一键时重新加载并返回冲突；删除保留墓碑行，修订号单调递增（无 ABA）；Console 读取时节流重新加载以看到其他进程的写入；`feature.get` / `feature.conversations` 新增 `persistent`，非持久数据库在回复中提示重启后丢失。
  - Console：嵌套插件的开关沿祖先链计算锁定（409 `locked`）；会话键按各部分校验，不再限制总长 512；最近会话按事件 id 倒序扫描最近窗口并去重。
  - 推送门禁：管理员 RSS 任务按目标会话开关跳过并记录 `featureDisabled`；记账私信推送检查私聊会话开关；彩票推送目标先按 `AdapterIndex.resolve` 解析为账号再判断（`isEnabledFor` 新增 `{ endpoint: { adapter, endpointKey } }` 目标），无法解析时按原方式投递；活动反馈按事件携带的 `conversationRef`（Endpoint CapabilityId 与原始会话）判断。

- 5cd9d3d: 插件权限按级别授予内置角色，插件 Console RPC 按方法鉴权（ADR 0049 修订）

  - console-protocol：插件权限（`<plugin>:<action>`）分为 read / operate / manage 三级，可在 `definePluginConsoleRpc({ permissions })` 声明，未声明时按后缀推断；新增目录权限 `plugin.perms.read|operate|manage`：viewer 得到 read，operator 得到 read + operate，admin 与 owner 得到全部。
  - gateway / host-http：自定义角色与 API 令牌可以写入插件权限；`iam.roles.list` 返回各角色实际生效的插件权限与当前运行时的插件权限目录（`pluginPermissions`）；`/auth/me` 按已加载插件展开级别授予。
  - zhin.js：已登录用户与 API 令牌调用 `plugin.<id>.<method>` 时，按方法自身、所属页面或目录兜底权限逐一检查（此前只检查 `feature.view` / `feature.configure`，operator 可以审批 `ops:approve` 操作）；门禁放行但无插件分发器应答的请求一律拒绝并记审计。
  - adapter：账号类方法的授权目标与处理函数选择账号的方式一致（`consoleAccountTarget`，先看 `data.instanceId`），`id` / `instanceId` 不一致或放在 `data` 之外时拒绝，避免按一个账号授权、却操作另一个账号；适配器 / 账号作用域的绑定可满足目录与插件权限。
  - plugin-runtime：`definePluginConsoleRpc` 支持声明权限级别。
  - rss / reminder / ledger / calendar / qrcode / short-url：补充权限级别声明（写操作为 operate 级）。

## 1.1.23

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

## 1.1.22

### Patch Changes

- a1f1028: Sink runtime, HTTP, IM, database, inference, and agent host installers from `@zhin.js/cli` into their owning runtime packages (`@zhin.js/runtime`, `@zhin.js/host-http`, `@zhin.js/core/runtime`, `@zhin.js/agent/runtime`), extract the canonical `executeInboundTurnSpine` with `InboundTurnRecord` in `@zhin.js/core/runtime`, and unify `ZhinAgent.hostMailbox`, `AgentTurnIngressRoute`, and `EngagementJournal` onto a single Actor/Mailbox runtime spine.
- 5419b88: Add generation-scoped `definePluginStore` (`PluginStore`), `Scope.get()`, declarative `PluginSetupCapabilities` return in `definePlugin()`, and `JsonSerializable<T>` typing on `PluginStateStore` to eliminate `as never` casts on TypeScript interfaces.

## 1.1.21

### Patch Changes

- fed2c27: Upgrade Console Host, Plugin Pages compiler/DX, and `/sandbox` workbench:

  - Populate React 19, `react-dom/client`, and `react-router-dom` named exports and standalone ESM fallback in `@zhin.js/pagemanager`.
  - Re-export `definePage` from `@zhin.js/page`, forward all `PageMetadata` fields (`group`, `order`, `parent`, `fullWidth`, `titleI18n`), and inject `{ pluginId, owner, localName, route, title }` props into page components.
  - Add `definePluginConsoleRpc.withConfig<TConfig>()` and `@zhin.js/client` `createDeclarativePage` helper.
  - Upgrade local Console shell (`page-renderer.ts`), live `log:entry` SSE broadcasts, and `/sandbox` simulated sender identity/role switching and rich segment rendering.

## 1.1.20

### Patch Changes

- 299863a: ADR 0044 C3: runtime consumers read capabilities instead of platform names. Scene facts (group info, member profile) are queried where the profile declares `scene.groupInfo` / `scene.memberProfile`; activity feedback (reaction, typing, status message, refresh interval, quote-only delivery) follows `feedback`, `actions.reaction` and `delivery.proactive` and the per-platform table is gone; large inline media is spooled only where `delivery.spool` is declared; the sandbox ingress and its console shell follow a new additive `runtime.sandbox` capability. `defineAgentTool` and Skill frontmatter accept `requiresCapabilities` (for example `actions.mute`), evaluated against the per-turn `TurnCapabilities`, so moderation tools disappear when the Bot is not an administrator and return when it is; the icqq/qq keyword boost in tool selection is removed and the icqq group-admin tools are tagged. The `icqq` command-line special case in the exec policy is now a generic `registerSensitiveExecCommand` rule registered by the icqq plugin. `EndpointCapabilities` gains a serializable per-kind `kinds` view. Adapters without a profile keep their previous behaviour (their derived profile also reads the management ports they implement).
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

## 1.1.19

### Patch Changes

- 976886c: Preserve confirmed progressive reply content, routing and delivery evidence across cancellation, rollover and closing failures without replaying published text. Keep error dispositions and actual message references, and abort the owning provider request when its functional text consumer fails.

  Enable native Sandbox Markdown through the real Core projection so Console updates retain formatting in one message. Preserve instance-level streaming opt-outs, recall tombstones and multi-page synchronization. The first safe content is immediate; later updates retain the configured pacing, including large valid intervals.

  Keep Slack and Lark Markdown streaming within the current physical message. When continuation formatting cannot be verified, stop and retain confirmed content instead of replaying or silently changing it to plain text. Plain-text continuations retain their original reply route.

  Use rebuildable revision metadata and indexes in the existing conversation event table for bounded SQL history reads. Original event JSON and retention remain unchanged; older writers and models keep their compatible read path. Supported adapter streaming remains enabled by default, with complete-message fallback for disabled settings or outbound middleware without incremental: true.

## 1.1.18

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

- 2c3610a: Add owner-scoped personal AI Sessions and a closed model policy hierarchy. Compile legacy providers and bindings into immutable, revision-leased connection/model/preset invocations while keeping Agent tool authority separate.

  Provide authenticated personal model management, encrypted Host-private credentials, public HTTPS transport with DNS pinning and same-origin redirects, and persistent per-Session model selection. Deployment tasks and summaries retain deployment model authority. Preserve legacy history and configured perception fallback chains. Keep every chat turn on its selected model, including legacy configuration, while retaining same-model retries.

  Extend trusted Host generation leases to resolve Root-private resources without publishing them in snapshots or child Plugin Scopes.

## 1.1.17

### Patch Changes

- 0fc0219: Config patches now guard every object write and delete against `__proto__`, `constructor` and `prototype` segments, and only walk own properties, so inherited members such as `toString` are treated as missing keys instead of existing values.
- 560c549: Console 页面现在可以读到群聊插话和技能助手的真实状态：`plugin.root.ambient`（需要 `ambient:read`）和 `plugin.root.skills`（需要 `skills:read`）。只返回最近 24 小时的结果统计，不含聊天内容、提示词或判断理由。插件 RPC 新增 `queries`，可以注册多个只读查询。
- 144a17b: Console 令牌新增 `scope: user`（与 `demo` 等价，表示普通用户）。普通用户现在可以执行插件 Console 动作，前提是动作自己声明了 `requiredPermissions` 或 `requiredRoles`，并且令牌全部满足；没有声明要求的动作仍然只给管理员。用户仍然就是 `zhin.config.yml` 里的 `http.tokens` 条目。
- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- e7b72a4: 群管冷却与 `ops:approve` 审批权限（ADR 0037 第 1 期切片 E，§3）。

  - 会话运营配置新增 `ops.cooldownMs`（实例默认 60 秒 + 会话覆盖，`0` 关闭）；同一 `platform + scene_id + 工具名` 在冷却期内只能发起一张硬闸审批卡。冷却记录为进程内，重启清空。
  - 冷却判定在控制面之后、生成新审批卡之前：命中不入队、不弹卡，本回合同类危险工具 latch，模型收到"冷却中、勿重试/换工具"说明。冷却表自身出错时不拦（冷却是节流不是授权）。
  - 审计新增 kind `ops_cooldown` 与码 `ops_cooldown_passed` / `ops_cooldown_hit`；命中同时写一条 `tool_hard_gate` 拒绝，回放串成一条链。
  - Console 新权限点 `ops:approve`：结算硬闸审批卡（与旧的 `tool_approvals:resolve` 任一即可）、读审批卡（与 `tool_approvals:read` 任一即可），以及公告 approve / reject / resend（不再接受只有 `control:write` 的令牌）。
  - `PluginConsoleRpcMethod` 新增可选 `anyOfPermissions`：持有其中任一权限即满足，对动作算作方法自身的要求。

- b8e594e: Plugins can register Console status and limited actions with `definePluginConsoleRpc` and `pluginConsoleRpcToken`. Pages call them as `plugin.<pluginId>.status` and `plugin.<pluginId>.<action>` through the existing Console request, using `pluginRpc()` from `@zhin.js/client`. Access follows the bound page's `requiredPermissions` and `requiredRoles`. Actions need the full-scope token, and the demo token can read status only when the plugin opts in. Input, output and run time are bounded, and raw errors never reach the page.
- 66b6404: 让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

  显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。

## 1.1.16

### Patch Changes

- 6da2bad: 新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。

## 1.1.15

### Patch Changes

- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- 064b06d: 提供只读 SnapshotLease.retirementSignal，在运行代退休时及时结束交互等待，同时保留旧操作的 lease 排空语义。
  问答在发送提示前建立精确会话与发送者约束，发送异常撤销等待；原生回答使用每题独立的短 callback token，避免旧按钮回答新问题。
- 7edd04c: 提供插件自有的管理员任务端口，统一完整投递目标、持久版本与幂等操作回执，并参与运行代准入；与聊天用户任务保持独立。

## 1.1.14

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

## 1.1.13

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

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

## 1.1.12

### Patch Changes

- badcc1f: Unify lazy JSX and HTML delivery across commands, inbound middleware and registered components. Remove the former JSX/template component runtimes, respect declared adapter HTML policies, and preserve author/generation ownership for automatic and explicit replies.

  Add the optional @zhin.js/components library with composable JSXRenderable display props, shared themes, symmetric spacing and local style/text overrides. Include tables, lists, Markdown with highlighted code blocks, and display-only checkbox, radio, switch and button states; provide a reusable preview gallery. Update scaffolds, examples and public authoring documentation together.

  Add optional official Tailwind static-utility compilation to inline styles. Consolidate raster rendering on @pixel.js/shotium, remove the Satori image toolkit, and align raster format contracts with actual PNG/JPEG/WebP results.

  Reject cascade-dependent Tailwind values including unset, track the installed Tailwind version in the bundled theme provenance, and preserve both repository and upstream MIT attribution. Keep optional gallery dependency failures visible and document asynchronous Tailwind initialization.

## 1.1.11

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

## 1.1.10

### Patch Changes

- 13f7301: Model owner-scoped database and schedule hosts as concrete classes over a shared abstract resource-host base. Construct the classes directly and remove the anonymous-object host factories.
- ef92a6d: Encapsulate generation admission ownership, activation state, and lifecycle listeners in each `GenerationAdmissionGate` instance while preserving atomic snapshot publication.
- 3d42fc9: Replace the YAML-only configuration adapter with the format-neutral `@zhin.js/config-file` module. YAML and JSON Root configurations now share one transactional file lifecycle with revision checks, atomic commit, rollback, and generation handoff; JSON is no longer loaded as a non-transactional startup snapshot. Configuration document ports and canonical immutable patch semantics now live in the foundational Plugin Runtime contract, so persistence adapters do not depend on schema composition and generation implementations.
- 2dbbc15: Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
- 31b42a8: Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

  RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.

- 65d0391: Make the instance-keyed `zhin.config.*#plugins` map a shared Plugin Runtime contract. Runtime startup helpers, Console configuration, onboarding, setup, install/uninstall, dependency diagnosis, and scaffolding now reject legacy package-name arrays instead of ignoring or promoting them; only the explicit migration pipeline reads that old shape. Remove the legacy `normalizePluginsMap` authoring API and dead create-project configuration reader, then add a repository gate that prevents compatibility branches from returning to normal configuration paths.
- cf83528: Apply the same database-table and schedule-job namespace rules to every plugin owner, including the root plugin. Remove the legacy process-host unwrapping APIs and require composition roots to provide the explicit root host tokens.
- df9f76b: Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
- 0724ddd: Define one Root configuration file contract across Runtime, CLI, Console, and scaffolding. Root projects now accept the documented YAML and JSON filenames, reject multiple configuration authorities, preserve JSON when edited through Console, and no longer expose TOML or TypeScript formats that Runtime cannot load.

## 1.1.9

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

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
