# @zhin.js/runtime

## 1.3.0

### Minor Changes

- 9026329: 未命中的消息首词与已注册指令名 / 别名高度相似时（私聊、@机器人或带指令前缀；忽略大小写与 `-` / `_` / 空格，默认 1 次编辑且名称至少 5 个字符或 3 个汉字），经正常回复链直接回复「没有这个指令，你是不是想用：X、Y」，不再交给 AI 编造指令名（#1250）。只列出发送者有权使用的指令；根配置 `commandSuggestion: false` 关闭，`{ maxDistance, limit }` 调整。Agent 提示在有指令菜单时引导模型不确定就让用户发送菜单，而不是猜指令名。

  只有带指令前缀的消息才按首词命名空间匹配（`/rss foo` → `rss-list`）；私聊与 @机器人 但未带前缀时，只匹配与指令名本身相近、且简短像指令的消息（不含「是什么 / 怎么 / 吗 / 啥 / ？」等疑问词或问号，名称后只跟指令声明的参数），所以「rss 是什么」「process 太慢了」之类的问题仍交给 AI。

- e0b4e51: 账号（Endpoint）启动不再阻塞实例就绪（#1250）。实例提交 generation 后即就绪；每个账号最多等约 3 秒宽限期，其余在后台继续启动，失败的账号按退避自动重试（5 秒起翻倍，封顶 5 分钟，±20% 抖动，不限次数）。`Endpoint.start()` 合同不变，适配器无需改动。

  行为变化：

  1. 实例 ready 与 `/pub/ready` 返回 200 不再意味着账号在线；需要账号在线才算就绪时用 `http.readiness.endpoints`。网关 `gateway.readyTimeout` 不再覆盖账号登录时间。
  2. 账号 start 失败不再导致实例启动失败或热重载回滚：改坏账号配置的热重载**会提交**（以前会回滚、旧账号继续在线），旧账号下线，新账号进入 `failed` / `retrying` 并按策略处理。账号停止时清理失败只把该账号标为失败（`endpoint_cleanup_failed`，等待人工处理），不再作为整个 Root 的完整性失败。
  3. 宽限期内没完成登录的慢账号，热重载从“先上新再下旧”变为“先下旧再上新”；宽限期内完成的不受影响。
  4. `zhin start --once` 是启动检查：宽限期后最多再等 30 秒，直到每个账号的首次启动尝试有结果；有启用账号处于 `failed` 或 `retrying`（首次尝试已失败）时以非零码退出，`stderr` 以首个失败账号的脱敏报错开头并列出全部失败账号；仍在 `starting` 或等待交互式登录（`awaiting_assist`）的账号不算失败。
  5. 账号上线前向它发送仍立即失败（`endpoint_inactive`，`not_sent`）。
  6. 自动重试会产生周期性的 `endpoint_start_failed` 日志（错误类名、错误码、类别与脱敏后的原始报错 `reason`）；配置错误与交互式登录（`login.mode: interactive`，如 ICQQ）不自动重试，等 Console「重新登录」/「启动」，重新登录也会立即唤醒等待中的重试。

  新增：`AdapterEndpointPhase` 的 `failed` / `retrying`，Endpoint 行与 `Adapter.list()` 的 `startAttempt` / `startFailure` / `nextRetryAt`，`Adapter.retryStart()`；core Endpoint 列表把等待登录验证的启动中账号报告为 `awaiting_assist`；需鉴权的 `{api}/system/readiness` 详情新增不参与就绪判断的 `endpoints[]`；Console 协议 `ConsoleEndpointPhase` 新增 `retrying` / `awaiting_assist`，账号页显示「启动中 / 启动失败 / 等待重试」；TTY 启动摘要分 online / starting / failed 列出账号。账号 start 作为 Console 变更执行时，首次尝试失败的执行码由 `endpoint_execution_failed` 改为 `endpoint_start_failed`。

  `AdapterIndex.activate()`（Root generation 交接）按上述规则后台启动；`AdapterIndex.start()` 保留给工具与测试，仍等待每个账号的首次尝试，并以 `Endpoint.start()` 原样抛出的首个错误拒绝（随后停止全部账号，不留后台重试）。

- 7cc703a: 热重载重建范围按受影响的子树分别计算（#1250 `hmr-multi-change-full-rebuild`、`hmr-stale-cross-package-import`）：同一批里改了几个插件（入口、子树内的辅助模块、能力文件混在一起）时，只重建这些插件子树并替换子树外受影响的能力，其他插件 Scope、适配器投影与 Endpoint 原样保留（不重连、不重登）；适配器只在自身源码或配置变化时重建。Root 安装器可以用新的 `watchProjectFiles({ patterns, onChange })`（`RootResourceContext`）声明自己读取的项目文件，只改了这些文件（例如 `SOUL.md` / `AGENTS.md` / `TOOLS.md`、`ai.knowledge` 目录）时不再重建 Root，改为通知声明方重读（Agent Host 已声明，turn 读取最新 bootstrap；`hmr_reload | rebuilt: resource`），未声明的根目录文件仍整棵重建并记 `hmr_full_rebuild` 原因。根插件 tool 等通过包名引用挂载的本地插件模块时，被引用文件变化会让引用方一起重新加载（新代码，所有重载的引用方共享同一个新实例）；未变化的插件包保持原有的共享实例，引用方重载不会重复执行其顶层副作用；依赖索引只沿包名导入进入被监视的目录，不再遍历 workspace 链接的框架源码（启动不再变慢）；引用了普通 workspace 库等无法刷新的依赖方，在 `hmr_reload` 的 `unrefreshed_dependents` 和 warn `hmr_unrefreshed_dependents` 中列出。子树重载因拓扑变化退回整棵重建时也记 `hmr_full_rebuild` 原因；没有归属记录的文件（例如 Feature 包内的文件）仍整棵重建并说明原因；批次中其余部分重载失败时，已声明的项目文件仍会通知声明方。

### Patch Changes

- 5232fd8: IM 审批安全修订（#1250 安全审查）：管理员本人审批改为开关 `ai.agent.approval.adminSelfApprove`，**默认关闭**——关闭时这类回合与之前一样只能由主人批准（或说明无人能批），`execApprovalMode: ask` 默认仍只有主人能批；开启后管理员本人确认只限策略明确标为管理员可批的操作——声明 `tags: ['admin_approvable']`（`ADMIN_APPROVABLE_TOOL_TAG`）的工具（Host 的 `schedule_add` 已声明）与写 `session` 记忆；敏感文件 / 受保护路径（如 `.git/config`）、Shell 命令、写 `global` / `platform` 记忆、未声明的插件工具审批与自动审核 Agent 的升级审批都需要主人，管理员的确认渠道直接返回「需要主人」而不弹提示（`ApprovalRequestInput.requiresOwner` / `adminMayApprove`）。管理员审批人要求端点层或以上的 `admin`（`holdsEndpointAdmin`；会话层 admin、被降级的会话层 owner 不算），且只在管理员自己的私聊里；群聊 / 频道未配置主人时不再退回管理员自批。读过外部内容、合流或旁听回合里写发起人自己的 `user` 记忆也先请发起人确认意图（防记忆投毒）。审批提示的「风险」行与危险工具硬闸提示同样打码，新增识别 `FOO_TOKEN=…` / `export API_KEY=…`、`Authorization: token …`、`X-Api-Key: …`、`--password=…` / `--token …`、URL 中的密码、JWT、AWS / Google 密钥；执行、指纹与授权范围仍用原参数。审批端口按用途报告可用性（`ApprovalPort.intentAvailable`、`isApprovalPortAvailable(port, purpose)`），只能确认意图的端口对硬闸与普通审批直接报不可用。「审批策略已变更」说明只认框架写入的拒绝记录（`ToolResultMessage.deniedUnderPolicy`），工具输出里伪造的策略戳不再触发。
- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- 0d8da71: 热重载与文件监视（#1250）：`zhin status` 显示实例当前的 generation（网关按实例每次提交后发布的路由表更新，不再停留在启动时的 1）；文件变化事件合并 300 毫秒（`HmrCoordinator` 新选项 `watchDebounceMs`；持续写入时最迟 2 秒也会触发，`watchDebounceMaxWaitMs`），`sed -i`、编辑器原子保存、`git checkout` 等一次改动只触发一次重载，显式 `enqueue` 不受影响（并合并同一路径尚在等待的监视事件，不会重复重载）；被监视的 `package.json` 只有 `scripts`、`description` 等不影响运行时的字段变化时直接忽略（debug 日志 `manifest_change_ignored`），依赖、`pnpm.overrides` / `pnpm.packageExtensions` / `pnpm.peerDependencyRules`、`dependenciesMeta` / `peerDependenciesMeta`、`engines`、`zhin`、`exports` / `main` / `type` 等字段变化仍按原路径处理，已挂载子插件包的 `version` 变化也会重载（插件树记录 `packageVersion`，网关据此判断 schema 漂移与发布状态；根项目自身的 `version` 仍忽略），重载失败时字段比较基线回退，下次仍能识别同一改动，需要重启时先记 `instance_restart | reason: manifest_changed | file | fields`（其他重启原因同样有结构化记录）；`hmr_reload` 新增 `rebuilt`（实际重建范围 root / subtree / capability）与 `rebuilt_plugins`（重新 setup 的插件，含适配器），实际退化为整棵 Root 重建时另记 warn `hmr_full_rebuild` 说明原因。重载范围算法本身不变。
- 627fb5e: 插件市场元数据不再阻止实例启动（#1250 review）：实例加载包时，`zhin.metadata.category` 不在枚举内、`descriptionI18n` 无效、`displayNameI18n` / `descriptionI18n` 含 `zh-CN` / `en` 以外的语言键，只记一条结构化警告（`manifest_metadata_dropped`，带包名与字段）并丢弃该值；`displayNameI18n` 形状错误、空字符串和未知的 `metadata` 键仍然报错。`zhin plugin check` 与发布流程保持严格校验。`parsePackageJson` 新增可选参数 `{ metadata: 'strict' | 'lenient', onWarning }`（默认 strict），`NodePackageResolver.create` / `RootRuntime` / `RootHost` 新增 `onManifestWarning`。

  `zhin search` 识别文档推荐的 keywords `zhin.js`，以及 `zhinjs`、`zhin-plugin`（不区分大小写）和带 `zhin` 清单字段的搜索结果。

  会话选择器：没有 `endpoint.view` 时可以手动填写适配器、账号 ID（规范 endpoint ID，`\0` 表示分隔符）与会话 ID，并提示缺少的权限；没有 Provider 的 `ConversationLabel` / `useConversationDirectory` 共享同一对进行中的请求，并按连接缓存 10 秒。声明式页面动作带 `result` 时，未设置 `result.tone` 则沿用计算出的语气（如 `passed: false` 为 danger），并在内联结果中显示返回的 `message`（结果本身已渲染 `message` 时不重复）。

- 70ddaf4: 插件市场元数据（#1250 marketplace-metadata）：`package.json#zhin.metadata` 新增可选的 `descriptionI18n: { 'zh-CN'?, en? }`（本地化描述）与 `category`（`adapter`、`ai`、`admin`、`community`、`entertainment`、`game`、`information`、`moderation`、`service`、`utility` 之一），校验方式与 `displayNameI18n` 相同：只接受这两个语言键、值为非空字符串、分类必须在枚举内。这两个字段只能写在清单里，插件市场才能从发布的 `package.json` 读到。`@zhin.js/plugin-runtime` 导出 `PLUGIN_CATEGORIES`、`PLUGIN_CATEGORY_LABELS`、`informativeKeywords`、`packageAuthorName`、`readPluginMarketplaceMetadata` 等读取工具。

  市场读取侧：`/pub/marketplace/search` 带出 `displayNameI18n` / `descriptionI18n`，分类读声明的 `category`（旧索引的 `util` 等按别名映射），可选 `locale=zh-CN|en` 按语言解析显示名与描述，并按两种语言的名称与描述搜索；`/pub/marketplace/detail/*` 带出发布清单的显示名、描述翻译与分类。作者一律取 `author`（没有时取 `maintainers`），不再显示发布账号——此前 `plugins.json` 生成脚本优先读 `_npmUser`，CI 可信发布的包因此都显示为「GitHub Actions」。keywords 去掉 `zhin`、`zhin.js`、`bot` 等通用词后展示与参与搜索。`zhin search` / `zhin info` 同样显示中文描述、分类和维护者，`zhin info` 不再读不存在的 `zhin.displayName` / `zhin.category`。

  官方插件与适配器：显示名移到 `package.json#zhin.metadata`，补齐中英文描述、分类、3–6 个有信息量的 keywords，author 统一为 `{ name: "lc-cn", url: "https://github.com/zhinjs/zhin" }`（不再发布邮箱）；npm `description` 与英文描述一致。

- Updated dependencies [e6d7cc1]
- Updated dependencies [7cc703a]
- Updated dependencies [70ddaf4]
- Updated dependencies [b56cca9]
  - @zhin.js/plugin-runtime@1.3.0
  - @zhin.js/feature-kit@1.1.18

## 1.2.2

### Patch Changes

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

- ac72706: 登录辅助 v2 第一期（ADR 0058）：每个账号一条登录流程（`LoginAssist.beginFlow`、时间线、提交后自动「验证中」与「结果待确认」、错误码与 `next`），挑战描述符带分步引导、复制 / 链接 / 提示块（敏感块只在活动挑战上）、`parseLoginTicket()` 与托管验证码辅助页的共享函数；`defineAdapter({ login })` 能力声明与 Endpoint `login` 钩子；Console 新事件 `endpoint.login.flow` 与 RPC `login.flow.list` / `login.flow.get` / `login.relogin` / `login.refresh`，`login.submit` 支持 `{ action, values }` 与 `wait: true`；登录操作审计结果类别；终端按流程逐行显示进度、按编号选择操作；账号行填写 `pendingLogin` / `loginStep` / `login`；配置 `console.loginAssist.captchaHelperUrl`。旧 `waitForInput` / `login.list` / `login.submit` 行为不变。
- Updated dependencies [f74b4a5]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/feature-kit@1.1.17

## 1.2.1

### Patch Changes

- fa22d4b: 配置存放规则落地（ADR 0057 第 1 步）：声明放 `zhin.config.yml`，运行时状态放数据库，密钥放 `.env`。

  - 密钥字段统一由 `@zhin.js/runtime` 的 `isSecretConfigKey` / `isSecretConfigSchema` 判定：Schema 标注 `x-zhin-secret: true`（主机 Schema 的 `http.token`、`database.password`、`mcp.token`、`a2a.token` 等已标注，`Schema.string().secret()` 同时输出该标注，Ajv 将其登记为注解关键字），没有标注时按字段名兜底（`token`、`password`、`secret`、`apiKey`、`privateKey`、`*Token` 等）。网关的配置脱敏、聊天配置策略、Console 表单与配置说明共用这一判定。
  - 实例启动（`zhin start` 与 `--standalone`）发现密钥字段是字面值而不是 `${…}` 引用时打一条警告，只列路径不打印值，提示运行 `zhin doctor --fix`。
  - `zhin doctor` 报告明文密钥；`zhin doctor --fix` 把字面值写进 `.env`（`ZHIN_<路径大写下划线>`，相同值复用，名字被其他值占用时追加 `_2`），并把配置值换成 `${变量名}`；配置经配置文件事务写入。
  - `.env` 改为加锁原子写（临时文件 + fsync + rename），保留原文件权限，新文件为 `0600`；网关 Console、`zhin console init`、`zhin doctor` 与脚手架向导都使用同一个写入函数。YAML/JSON 配置的原子替换同样会 fsync。

- ab49bbe: 插件包可以省略 `plugin.ts`：`type: "plugin"` 的清单既不写 `zhin.entry` 也不写 `exports["./zhin"]` 时，清单记录为无入口，运行时（普通与隔离加载路径）按 `definePlugin({ name: <去掉 scope 的包名> })` 装配，约定目录照常从包根目录发现。包名去掉 scope 后不符合 `/^[a-z][a-z0-9-]*$/` 时启动报错并提示添加带显式 `name` 的 `plugin.ts`。Feature 包仍必须声明入口，已声明但不存在的入口仍然报错。`zhin plugin check`、`check:plugin` 与网关插件安装检查接受无入口插件；`zhin plugin check` 对存在 `plugin.ts` 却未声明入口的情况给出警告。`@zhin.js/testing` 的测试应用根仍需声明入口（用于挂载测试端点），缺失时给出明确错误。

  `package.json#zhin.features` 可以省略：省略时运行时按包根目录下存在的约定目录（`commands/` → `@zhin.js/command`、`tools/` → `@zhin.js/tool` 等，映射表 `CONVENTION_FEATURE_PACKAGES` 由 `@zhin.js/runtime` 统一导出）推断要挂载的 Feature 包；推断出的引用不带 `api` 范围，找不到时报与显式声明缺失相同的 `PackageResolutionError` 并写明是哪个目录推断出来的。写了 `features`（包括 `[]`）的插件不做推断，行为不变；隔离插件不推断；Root 继承的 Stable Features 优先。最小插件清单为 `"zhin": { "protocol": 1, "type": "plugin" }`。`zhin plugin check` 要求推断出的 Feature 已声明为依赖，`zhin create` 在省略 `features` 时不再写出 `features` 列表，网关卸载检查与仓库依赖检查同样计入推断出的 Feature。

## 1.2.0

### Minor Changes

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

- 4e8ba38: 网关与实例之间的 HTTP / WebSocket 桥接（ADR 0054 §2 / §3，B1.2）

  - host-http：`@zhin.js/host-http/bridge` 协议升到 2——路由表（`routes`、`ready.routes`：`revision`、`generation`、`apiBase`、HTTP `pattern`、WebSocket `path` 与 `auth: 'host' | 'protocol'`）、按信用额度背压的分块请求 / 响应体、WebSocket 帧与 `ws.drain`、随请求转发的主体、帧 / 头 / 流数量上限、双向取消。实例侧 `createBridgedHttpHost` 复用共享路由器（新增 `authentication: 'forwarded'`：网关认证，实例仍按 Console 权限表授权）；网关侧 `IpcInstanceTransport` 实现 `InstanceTransport`（`ready`、`routes()`、`fetch()`、`openWebSocket()`、`setAddresses()`），失败以 `InstanceTransportError` 报告（`instance-offline` / `timeout` / `instance-error` / `overloaded`）。
  - gateway：`InstanceSupervisor.transport` 在实例重启之间保持不变。
  - zhin.js：受监管时实例用 `BridgedHttpHost` 承载路由，不监听端口、不加载 `node:http` / `ws`；没有控制通道时拒绝启动（开发 / 测试用 `--standalone` 或 `runStartCommand({ standaloneHttp: true })`）。
  - runtime / cli：新增 `zhin runtime start --standalone`。

- f8bf684: - 网关运行时，`zhin config`、`zhin schedule`、`zhin send`、`zhin watch` 经本地控制套接字 `.zhin/gateway.sock`（新 RPC `gateway.http.request`）以本机所有者身份访问实例，Console 初始化后不再因 `http.token` 失效而 401；网关未运行时仍走 HTTP，401 时提示签发 API 令牌（`ZHIN_CONSOLE_TOKEN`）。
  - `zhin doctor --fix` 生成随机初始化令牌（32 字节），不再写入固定的 `zhin-local-token`；提示改为「初始化令牌只在创建首个所有者前有效」，并检查网关是否运行、Console 是否已初始化。
  - `zhin start --help` 的示例与实际行为一致：只有 `-f, --foreground`、`--once`、`--standalone` 在前台运行，生产示例写成 `zhin start --foreground --mode production --no-watch`；`-d, --daemon` 不再重复列出。`zhin status --help` 写明网关未运行时退出码为 3。
  - 新增配置 `gateway.readyTimeout`（整数秒，1–3600，默认 60）：实例启动、重启与依赖事务等待就绪的最长时间。
  - `zhin start --foreground`（含 `zhin runtime start`）在 stdin 是 TTY 时把终端输入交给实例，终端类适配器可以在网关下读到输入；后台网关仍不给实例 stdin。
  - `zhin migrate` 与插件迁移（package cutover / verify）以 `zhin start` 为准：`dev` 写成 `zhin start --foreground --watch source config`，`start` 写成 `zhin start --foreground --mode production --no-watch`，`daemon` 写成 `zhin start --mode production --no-watch`；已有的 `zhin start …` 与别名 `zhin runtime start …` 不再被改写。
- c2bbdcf: Console 终端（ADR 0051）：Host 配置新增顶层 `console.terminal`（`enabled`、`shell`、`cwd`、`idleTimeout`、`maxSessions`、白名单 `ssh` 目标），开启后 Console 可打开宿主 Shell（`node-pty`）或 SSH 会话（`ssh2`），两者都是 CLI 的可选依赖。只有持有 `ops.terminal` 的所有者能用，初始化令牌不可用；票据一次性、30 秒有效；会话开始与结束写入审计日志；改密码、禁用或删除用户、变更其角色绑定时立即结束该用户的终端会话。默认关闭，关闭时不注册任何路由，也不加载可选模块。`console.terminal` 列入自我变更禁改名单。
- fd22375: 修复功能分层配置（ADR 0050 / 0055）审查发现的问题：

  - 覆盖校验：值为 `null` 的键（显式清空）不再绕过字段白名单，下级层不能借此清掉仅全局字段，嵌套清空也必须指向 Schema 中存在的字段。
  - 环境变量引用：聊天自助在任何层级都拒绝写入 `${…}` / `env://`；Console 的 `feature.set-override` 只允许具备 `ops.env.write` 的用户写入，防止借 `feature.configure` 读取密钥。
  - 会话覆盖存储：数据库写入检查影响行数，0 行或并发插入同一键时重新加载并返回冲突；删除保留墓碑行，修订号单调递增（无 ABA）；Console 读取时节流重新加载以看到其他进程的写入；`feature.get` / `feature.conversations` 新增 `persistent`，非持久数据库在回复中提示重启后丢失。
  - Console：嵌套插件的开关沿祖先链计算锁定（409 `locked`）；会话键按各部分校验，不再限制总长 512；最近会话按事件 id 倒序扫描最近窗口并去重。
  - 推送门禁：管理员 RSS 任务按目标会话开关跳过并记录 `featureDisabled`；记账私信推送检查私聊会话开关；彩票推送目标先按 `AdapterIndex.resolve` 解析为账号再判断（`isEnabledFor` 新增 `{ endpoint: { adapter, endpointKey } }` 目标），无法解析时按原方式投递；活动反馈按事件携带的 `conversationRef`（Endpoint CapabilityId 与原始会话）判断。

- cc7a5f9: 常驻网关与 `zhin start` / `stop` / `restart` / `status` / `logs`（ADR 0054 §5 / §6，B1.6）

  - gateway：`runGateway` 移到 `@zhin.js/gateway/server` 的独立模块；实例崩溃、风暴保护进入 `crashed` 或经 RPC 停止时网关照常运行，只在 SIGINT / SIGTERM、`gateway.shutdown` 或 `--once` 时结束。实例输出总是写入 `.zhin/logs/instance.log`，前台运行时同时回显。新子路径 `@zhin.js/gateway/local`：本地控制套接字 `.zhin/gateway.sock`（Windows 为命名管道，仅当前用户可连接），清理残留套接字、拒绝第二个网关，JSON 行协议（主体 `local`，另有 `gateway.info` / `gateway.shutdown` 与依赖事务进度流），状态文件 `.zhin/gateway.json` 与 CLI 客户端。
  - console-protocol：`gateway.packages.uninstall` 新增 `removeDependency`。
  - cli：`zhin start` 默认后台运行，`--foreground` 前台运行；新增 `zhin stop`、`restart [--gateway]`、`status [--json]`（未运行时退出码 3）、`logs [-f] [-n]`、`update`；网关运行时 `install` / `uninstall` 经网关执行。`zhin runtime start` 保留为前台别名。
  - zhin.js：提示改为 `zhin start`；网关前台运行时实例按交互终端输出。
  - runtime / scaffold-wizard / create-zhin-app：脚本与服务模板（systemd、Docker、PM2）改用 `zhin start --foreground`，README 附 Console 链接。

- e0bc008: 管理网关审查修复：

  - `zhin migrate`：旧的 `"start": "zhin start"`（或 `--daemon`）会改写为前台的 `zhin start --foreground --mode production --no-watch`——`zhin start` 现在默认后台，容器 / PM2 / systemd 会立即退出；迁移校验要求 `start` 带 `--foreground` 或使用 `zhin runtime start`。新增的 `@zhin.js/gateway` 版本按项目 CLI 的发布线推导（CLI 锁在旧发布线时用 `~主.次.0`），`^0.0.0` 占位不再被说成「dependencies 已声明」。
  - 本地控制套接字：`gateway.http.request` 走与 HTTP 相同的路由表（网关自有路由可达，`http.base: /` 正常），只取路径与查询，拒绝含 `\` 的路径与带 body 的 GET，事件流返回「改用 HTTP」；设置了 `ZHIN_CONSOLE_TOKEN` 时由网关按该令牌认证并以其主体执行与审计，`http.token` 不再经套接字发送。大小上限按 JSON 编码后的 UTF-8 字节计（中文不再触发协议错误），超限提示改用 HTTP。Windows 命名管道每次启动带随机名，CLI 校验 `.zhin/gateway.json` 中密钥的握手 HMAC。网关把实际端点（含 `os.tmpdir()` 回退路径）通过 `ZHIN_GATEWAY_SOCKET` 告诉实例，Agent 文件工具与 `bash` 拒绝触及它。
  - 开放 Host：地址未知的请求不再算本机（进程内调用需显式 `inProcess`）；`http.host` 非回环且既无 `http.token` 也无所有者时，网关拒绝启动并提示设置 `HTTP_TOKEN` 或 `zhin console init`。
  - `zhin doctor`：`HTTP_TOKEN` 按行读取（空值不再吞掉下一行），`change-me`、`zhin-local-token` 等弱值告警并可 `--fix` 替换，写入后 `.env` 为 `0600`。
  - `zhin console init`：先校验所有者用户名与密码，再切换数据库、写 `.env`。
  - 前台网关只在自己是终端前台作业时把标准输入交给实例，实例退出 / 崩溃后恢复终端设置；登录辅助提示改为整行输出，不再卡在按行转发里。
  - `gateway.readyTimeout` 在每次启动、重启实例与每笔依赖事务前重新读取，修改后无需重启网关。
  - Console 客户端：依赖事务回滚（`ok: false`）时安装 / 卸载 / 更新 hook 设置 `error`；事务请求的超时随 `gateway.packages.progress` 事件续期，实例启动阶段放宽到最长就绪等待，仍超时则报「结果未知，请核对」。

- 3fcfc0e: 开发态热更在每次提交新一代后，把已退役的 `?zhin-generation=N` 模块从 Node ESM 加载缓存中移除，使旧模块实例及其导出状态可被 GC，长时间开发时内存不再随热更次数线性增长。依赖 Node 内部 `loadCache`（经进程内 inspector 读取），不可用时自动退回原行为；`ZHIN_HMR_EVICT=0` 可关闭。`NativeDevelopmentModuleRuntime` 新增 `evictRetiredModules` 选项与 `evictionStats`。
- 5cd9d3d: HTTP 路由契约改为 Web 标准 `Request` / `Response`（ADR 0054 §2，B1.0）

  - host-http-contract：路由处理函数签名改为 `(request, context) => Response`，`context` 提供 `url`、`params`、`principal`、`remoteAddress`；新增 `readBodyBytes` / `readTextBody` / `readJsonBody`（带大小上限，超限先读完再报 413）、`jsonResponse` / `emptyResponse`、带背压的 `createResponseStream`（SSE、大文件下载）与 `WsConnection`。契约不再引用 `node:http` / `ws`。
  - host-http：Node 服务器移到 `@zhin.js/host-http/node`（`createHttpHost`），负责 Node 请求与 `Request` / `Response` 的互转；认证结果经 `context.principal` 传给路由，删除旧的按请求取主体的辅助函数；未预期的异常只返回通用错误信息，细节写日志。
  - runtime、mcp、a2a、gateway、zhin.js、calendar 插件与各适配器的 Webhook / 反向 WebSocket 路由迁移到新契约，行为不变。

- 5cd9d3d: 实例监管改为 IPC 控制通道，删除退出码 75 重启路径（ADR 0054 §3，B1.1）

  - host-http：新增 `@zhin.js/host-http/bridge`，定义控制通道协议（`ready`、`restart-request`、`shutdown`，带协议版本）与实例侧 `openInstanceControlChannel`；只有网关启动的子进程（带 `ZHIN_RUNTIME_CHILD` 标记）才打开控制通道，测试框架或进程管理器建立的 IPC 通道不会被误当作网关。
  - gateway：`InstanceSupervisor` 取代 `NativeTypeScriptSupervisor`——advanced 序列化 IPC、`ready` 握手与版本校验、先优雅停止再 SIGTERM / SIGKILL、按请求重启、崩溃退避与重启风暴保护；`InstanceLogCollector` 采集实例日志（内存环形缓冲 + 按大小轮转的 `.zhin/logs/instance.log`）；`zhin runtime start` 经 `runSupervisedInstance` 启动。删除 `planRespawn`、`processRestartExitCode`、`ZHIN_SUPERVISOR_PID` 与孤儿看门狗（网关包尚未发布，删除不算破坏性变更）。
  - zhin.js：实例启动完成后发 `ready`，收到 `shutdown` 时停止，重启（Console、聊天、依赖变更、自我变更）改为向网关发 `restart-request`；网关断开时实例自行停止，不再残留进程；未受监管时的重启请求只停止实例、不强制退出进程（嵌入方可通过 `exit` 选项接管退出）。
  - cli / runtime / agent：相应更新启动参数、自我变更生效与文档说明。

- e0f857e: 隔离插件运行时新增 `startTimeoutMs`：`prepare`（启动 Worker / 进程并导入入口）默认使用 `requestTimeoutMs` 与 10 秒中的较大值，较短的单次调用超时不再让负载较高的主机在隔离实例启动阶段失败。
- 1e54b1e: 安全加固：实例侧数据库宿主（Console 数据库页、原始 SQL、模型定义与事务）拒绝访问网关的 `console_*` 表，独立模式改用仅根可用的 `gatewayTableHost()`；Agent 文件工具把 SQLite 数据库文件视为敏感文件。SSH 终端目标必须配置 `hostFingerprint`，只有显式 `insecureAcceptAnyHostKey: true` 才跳过校验并在 Console 标为不安全。新增 `http.trustProxy`（受信任代理时从 `X-Forwarded-For` / `Forwarded` 推导客户端地址，用于限速、审计、协议鉴权与桥接）；带转发头的请求不再算本机连接（未配 `access_token` 的反向 WebSocket、MCP / A2A 本机免鉴权一律拒绝）。
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
  - @zhin.js/plugin-runtime@1.2.0

## 1.1.21

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
  - @zhin.js/feature-kit@1.1.15

## 1.1.20

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- a1f1028: Sink runtime, HTTP, IM, database, inference, and agent host installers from `@zhin.js/cli` into their owning runtime packages (`@zhin.js/runtime`, `@zhin.js/host-http`, `@zhin.js/core/runtime`, `@zhin.js/agent/runtime`), extract the canonical `executeInboundTurnSpine` with `InboundTurnRecord` in `@zhin.js/core/runtime`, and unify `ZhinAgent.hostMailbox`, `AgentTurnIngressRoute`, and `EngagementJournal` onto a single Actor/Mailbox runtime spine.
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/feature-kit@1.1.14

## 1.1.19

### Patch Changes

- 6347b19: ADR 0048 H2: delete the sub-agent runtime, `spawn_task`, deferred workers, detached tasks, the standalone `AIService.createAgent` / `runAgent` / `createAgentSession` loop and the `ai.subagent.*` / `subagent_*` events. `ai.agent.subagentTurnMode`, `maxParallelSubagents`, `subagentAutoContinue`, `subagentDirectImDelivery`, `subagentTools`, `subagentTurnWaitMs`, `subagentExecApprovalMode`, `workerExecApprovalMode`, `workerBaseTools`, `deferredAutoContinue`, `deferredAutoContinueMaxDepth` and `ai.agents.<name>.permission.task` now fail startup with a migration hint; declare collaboration in `agents/<name>/agent.json` instead.
- 5ec4728: Align host-config schema coverage with ADR 0048 H3: `assistant.queue` is no longer a schema property (startup rejects the key; retries live inside `TimerScheduler`). Drop the coverage paths and null-retention fixtures that still walked `assistant.queue.maxConcurrency`.
- bf00459: ADR 0048 H3 PR-3 (closes #1179): due timers become `timer` Mail on the host Mailbox (lane `timer:<jobId>`). `TimerScheduler` + `createTimerMailDueHandler` replace `ScheduleJobEngine` / `JobWorker` / `job-scheduler` / `job-utils`. Kernel `ScheduleEngine` remains the clock; N retries / dead-letter stay a projection over `ScheduleExecutionQueue`. Event ingress triggers timer / event Mail. Eval Gap A `deliverTimerMailInbound` is real; harness-timer-\*×4 unskipped.

  **Breaking removals:** `ScheduleJobEngine`, `JobWorker`, and the `assistant.queue` config key. A config that still sets `assistant.queue` fails startup with a migration hint (retries are internal to `TimerScheduler`; Mailbox policy stays under `ai.agent.mailbox`).

- 6163abc: Complete ADR 0048 (Agent Harness H4 & H5): migrate multi-Bot Venue routing, floor control, and visibility projection (`visible | summary | backstage`) into `@zhin.js/core/venue`, add shared Engagement blackboard (`board_read` / `board_write`), `follow_up`, `collaboration.budget`, Engagement Journal persistence/compaction, `zhin trace <engagement>` collaboration graph, Console engagement routes & UI, and A2A Remote Mailbox transport (`A2AMailboxTransport`), and remove `@zhin.js/workroom` and legacy `five-agent` orchestration.
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

- Updated dependencies [fed2c27]
- Updated dependencies [72b5a12]
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/feature-kit@1.1.13

## 1.1.18

### Patch Changes

- 9e6d70d: Ambient engagement no longer drops a burst that lands inside `judgeIntervalMs`: it waits for the window to end on the same ticket (a newer message still supersedes it), re-checks cooldown, hourly cap and conversation state, then judges the latest messages. Previously such a burst was skipped with `judge_interval` and never re-judged unless someone spoke again.
- 4fe49b5: 支持配置按需生效：分离保存与有效版本，独立变更先应用，账号资料更新保留连接，模型按回合使用确定版本；Console 返回结构化应用结果。监听改为仅显式 --watch 启用，开发模板显式选择源码和配置监听。

  自变更消费配置应用回执，避免已处理配置被二次重载；持久化本次写入修订和应用结果，未知结果或修订冲突时停止自动续作并保留现场，恢复不会覆盖未经本次变更确认的配置。

- 0315ba0: 用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

  新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。

- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
- Updated dependencies [0315ba0]
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/feature-kit@1.1.12

## 1.1.17

### Patch Changes

- Updated dependencies [976886c]
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/feature-kit@1.1.11

## 1.1.16

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

- 6749002: Keep interactive runtime turns and their synchronous children running without fixed iteration or total wall-clock caps. Share configured token quotas across the live turn, retain cancellation and authorization, compact child context independently, and report periodic progress without additional model calls or blocking final delivery. Scheduled, unattended, independent background and legacy API budgets remain unchanged.

  Stabilize prompt prefixes by keeping conversation identity in the session-stable system tail and fresh scene state after the current message. Shorten and escape the host-context boundary, preserve permission-filtered tool disclosure, and omit fixed iteration ceilings from continuous-run traces.

  Project repeated inspections of the same private image only once per model request, preserving resource access checks, transient lifetime, and the existing inspection limit.

- fc33495: master 私聊审批改为先问人：`masterShell: isolated` 不再把审批强制成 `auto`，新增 `ai.agent.masterShellApprovalMode`（默认 `ask`，可选 `auto` / `inherit` 沿用 `execApprovalMode`）；master 私聊中自动审核拒绝会转问 master；群管冷却不再作用于私聊；拒绝提示与安全提示词要求在 master 私聊里请求批准而不是放弃。
- 2c3610a: Add owner-scoped personal AI Sessions and a closed model policy hierarchy. Compile legacy providers and bindings into immutable, revision-leased connection/model/preset invocations while keeping Agent tool authority separate.

  Provide authenticated personal model management, encrypted Host-private credentials, public HTTPS transport with DNS pinning and same-origin redirects, and persistent per-Session model selection. Deployment tasks and summaries retain deployment model authority. Preserve legacy history and configured perception fallback chains. Keep every chat turn on its selected model, including legacy configuration, while retaining same-model retries.

  Extend trusted Host generation leases to resolve Root-private resources without publishing them in snapshots or child Plugin Scopes.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [2c3610a]
  - @zhin.js/feature-kit@1.1.10
  - @zhin.js/plugin-runtime@1.1.18

## 1.1.15

### Patch Changes

- f0e1df7: Group merge window (ADR 0038 slice A): with `ai.agent.inboundQueue.merge.enabled`, plain-text mentions from several group members within a short window (`quietMs` 1500 / `maxWaitMs` 6000, up to `maxSenders` 5) are answered by one turn instead of one reply each. Off by default until merged turns narrow permissions per sender. The master, private chats, commands, stop words and messages with media, quotes or forwards keep their own turns. New audit codes `merge_window_joined` / `merge_window_flushed` (plus the other ADR 0038 codes reserved for later slices).
- d9672ec: ADR 0038 切片 B2：合并回合里有副作用的工具调用按 `onBehalfOf` 指向的发送者复核（缺省按权限最低者），不通过写 `merge_on_behalf_denied`；合并回合最多 1 张新审批卡；新增 `ai.agent.toolHardGate.maxPendingPerScene`（默认 3），每群待审卡超限 fail closed（`hard_gate_scene_pending_cap`）；群聊合流 `inboundQueue.merge.enabled` 默认改为开启。
- 24a2b71: Danmaku mode (ADR 0038 slice E1): adapters can declare the `liveDanmaku` capability. In their conversations every danmaku is a candidate; the Agent collects them in one window (`ai.agent.inboundQueue.live`: `windowMs` 10000, at least `minIntervalMs` 15000 after the previous danmaku reply, newest 100 kept) and replies once — `mode: pick-one` (default) picks one danmaku and `@`s its viewer, `summary` answers the window as a whole. Danmaku turns run as an anonymous viewer with only tools that declare the new `readOnly: true` flag (native file reads, web search / fetch, knowledge and memory search are marked), no skills, sub-agents, MCP or shell, and never an approval card. Replies are audited as `danmaku_window_picked` with the candidate count and the viewers picked.
- 119e9e6: ADR 0043 §2/§3: the history sent to the model is bounded by a token budget (`ai.context.historyTokens`: group 8000, ordinary private 12000, master private 24000, a number for all scenes or per-scene overrides, `0` = off; `ai.context.maxRecentMessages` stays as a message-count upper bound). The budget is measured after projection, the window starts on a turn boundary, and it only moves — in one block leaving 25% headroom — when the budget is exceeded, so the prompt-cache prefix stays stable. Tool results of finished turns (and very long call arguments) reach the model as their first 200 characters plus `…(已省略 N 字)`; the current turn and stored history are unchanged.
- f2bbab5: Stop the bot from reacting with an emoji on every turn. The structured-reply instruction now says reactions are occasional (`""` is the default), and the host paces reactions per session: at most one per `ai.agent.reactions.cooldownMs` (default 10 min) and only with `probability` (default 0.35; 0 disables). Paced-out reactions are not sent, count as handled, and are audited as `{ reaction: true, applied: false, paced: true }`. Memory only, bounded to 1024 sessions.
- ab2263a: Gate writes to the host's own configuration with the dangerous-tool hard gate (#1030 P0). A file-tool call that writes `zhin.config.*`, `.env*`, `package.json`, lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `assistant.profile.yml`, `node_modules/` or `.git/`, and a `bash` command that writes one of them or changes dependencies, is now a dangerous `self` call: it needs a fresh human approval every time, and bypass, the auto reviewer, owner exemption and remembered approvals never grant it.
- b223a51: Record redacted model inputs per request for local conversation traces, with reported usage kept separate from context estimates. Preserve trusted conversation and source-message identity, expose details through full-scope read-only Console APIs, and enforce bounded trace retention. Request-body recording is enabled by default and can be disabled with `ai.agent.recordRequestBodies: false`.

## 1.1.14

### Patch Changes

- 5be6f3a: Add optional public R2 publishing for generated and outbound inline images, plus approval-gated workspace image uploads. Keep image bytes out of tool results and subsequent context when storage is enabled.

  Keep MCP image originals in a scoped local store with seven-day retention and bounded capacity. Expose on-demand inspection through `get_local_assets`, projecting images only into the next model request and sharing perception limits with authorized child turns.

- 658a5fb: Console access is now per token. Entries in `http.tokens` can set `permissions` and `roles`. The Console filters navigation and page lists (`/entries`, `/console/api/pages`, `/console/api/topology`, page shells and the `pages:list` RPC) by the caller's token. Plugin `status` RPC is open to a non-admin token that holds the bound page's requirements. Full-scope tokens, and Hosts with no tokens configured, still see everything. Page lists are no longer evaluated with empty access, so pages that declare `requiredPermissions` are now visible to the users allowed to see them.
- 144a17b: Console 令牌新增 `scope: user`（与 `demo` 等价，表示普通用户）。普通用户现在可以执行插件 Console 动作，前提是动作自己声明了 `requiredPermissions` 或 `requiredRoles`，并且令牌全部满足；没有声明要求的动作仍然只给管理员。用户仍然就是 `zhin.config.yml` 里的 `http.tokens` 条目。
- ff87195: 决策审计 Console 回放（ADR 0036 切片 C）：

  - Host 新增只读查询 `plugin.root.decisions`（倒序列表，按平台 / 会话 / kind / outcome / 时间过滤，`nextBefore` 翻页）、`plugin.root.decision-turn`（按 `turn_id` 展开时间线）、`plugin.root.decisions-export`（时间窗导出 JSON，字段与表结构一致，`nextSince` 分页），都需要 `decisions:read`；入口在「机器人状态」页。
  - `DecisionEventLog` 增加 `query` / `turn` / `prune` 读取与保留期清理；新增配置 `ai.audit.retentionDays`（默认 14 天），启动时与之后每小时清理过期行，并为 `ts`、`turn_id` 建索引（SQLite / MySQL / PostgreSQL）。
  - 不含控制面开关（切片 D）与危险工具硬闸（切片 E）。

- a3b636d: 危险工具硬闸 IM 审批通道（G6，#1013）：`ai.agent.toolHardGate.imApproval`，默认关闭。

  - 配置：`enabled`、`approverIds`（扁平列表或 `platform → userIds`）、`delivery: dm | approver_group`、`approverGroupId`（审批群模式必填，且不能是业务会话）。
  - 新审批卡片经触发调用的 Endpoint 私聊投递给 allowlist 审批人（或发到专用审批群），内容含工具、类别、会话、脱敏参数摘要、卡片 id、过期时间；投递失败不重试，卡片照常留给 Console、超时拒绝。
  - 审批人私聊 `/approve <id>` / `/deny <id>` 结算同一个 `ToolApprovalQueue`，与 Console 先到先得；群 / 频道消息与触发会话一律不能结算；仍是 humanOnly、一次一批，不提供本会话 / 永久授权，`bypass` 与审核 Agent 不能放行。
  - 审计：`tool_approval` 结算记录 `payload.channel`（`console` / `im_dm` / `im_approver_group` / `turn_prompt`），IM 操作者记 `actor_id = im:<platform>:<userId>`；Console 审批卡片 RPC 返回 `channel`。

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- 69f9ef6: Scene awareness (#996): high-priority social events (bot muted/unmuted, join request, member joined/left, group notice updated, bot poked) now wake one short Agent turn on their own after a 3–5 s coalesce window (at most one wake per scene every 15 s), without waiting for the next human message. Low-priority events (reactions, card/title/remark changes, person-to-person pokes) never wake alone. Every turn carries the recent scene events as a short ephemeral `[Scene events]` block (≤5 lines / ≤200 chars) that is never stored in `agent_messages`. When the bot cannot speak, the wake only updates the session profile and skips the model, same as the session-profile speak gate. Configure with `ai.trigger.sceneEvents` (`conversations` defaults to `ai.trigger.ambient.conversations`).
- 17d1301: 新增危险工具硬闸（ADR 0036 切片 E，fail-closed）：

  - 工具可以声明 `risk: 'dangerous' | 'safe'` 和 `riskCategory: 'member' | 'publish' | 'funds' | 'identity'`。宿主内置一份危险工具清单，`ai.toolHardGate.dangerousTools` 只能把工具调高为危险，插件声明 `safe` 不能调低。
  - 危险工具执行前必须拿到一次全新的人工审批（`humanOnly`），`execApprovalMode: bypass`、自动审核、主人自动放行和已记住的授权都不能越过。拒绝、超时（默认 5 分钟）、无人可批都按拒绝处理，本轮不再重试同一工具或同一类别。
  - 资金类（`funds`）默认禁用；打开 `ai.toolHardGate.allowFunds` 后仍需审批。
  - 无人值守的轮次会排进审批队列，Console 通过 `plugin.root.tool-approvals` 查看、`plugin.root.resolve-tool-approval` 批准或拒绝（权限 `tool_approvals:read` / `tool_approvals:resolve`），批准后下一次同参数调用只放行一次。
  - 结果写进 `ai_decision_events`：`tool_hard_gate`（allow / deny）、`tool_approval`（defer / allow / deny），safe / 只读工具放行但仍写 `tool_call`（allow）；新增码 `tool_approval_requested`、`tool_approval_approved`、`tool_funds_disabled`、`tool_hard_gate_latched`、`tool_safe_allowed`（追加在码表末尾）。

- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/feature-kit@1.1.9

## 1.1.13

### Patch Changes

- 0dd657d: Let the structured-decision provider decide group ambient engagement. New `ai.decisions.ambient` policy (`off` / `shadow` / `active`, plus `timeoutMs` and `minConfidence`): in `active` mode the DecisionProvider (for example TypeSafe Jev) answers one binary `engage` / `stay_quiet` choice over the same recent messages the chat-model judge sees, and the `ai.trigger.ambient.judge` list takes over when it fails, times out or answers invalidly; in `shadow` mode the judge list still decides and the decision is logged as `ambient_decision_shadow`. Quiet time, cooldown, hourly caps, conversation window, judge interval, `ambient.minConfidence` and ambient shadow mode are unchanged, and addressed turns still skip the ambient judge. Without `ai.decisions.ambient` nothing changes.

## 1.1.12

### Patch Changes

- 9e21404: Ambient engagement no longer goes silent mid-conversation. After the bot speaks, the group is in a conversation with it for `conversationWindowMs` (default 3 minutes): members replying to it are answered whenever the judge agrees, without the interjection cooldown or hourly cap (a 30-per-hour safety ceiling remains). `cooldownMs` and `maxPerHour` now limit only unprompted interjections, and the judge is told when the bot is in a conversation and which lines are its own.
- de39053: Spare the ambient judge's quota: `judge` accepts a list of models tried in order when one fails or is rate limited (a failed one is passed over for a minute), an idle group is judged at most once per `judgeIntervalMs` (default 30 s), and chat lines sent to the judge are trimmed to 200 characters.
- bf0fa9f: Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
- 6da2bad: 新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

- Updated dependencies [6da2bad]
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/feature-kit@1.1.8

## 1.1.11

### Patch Changes

- 974fa85: Add ambient group engagement (`ai.trigger.ambient`): for a group message nobody addressed, wait for the burst to settle, apply a per-group cooldown and hourly cap, and let a judge model decide whether the bot would naturally chime in. Engaged turns tell the Agent nobody called it, so it can still return no messages. Mentions, quotes and DMs are unchanged and always reach the Agent. Off unless groups are listed; `mode: shadow` logs judgments without replying.

## 1.1.10

### Patch Changes

- 1a11207: HMR no longer reloads on editor temp, swap, lock and backup files (`.!<digits>!*`, `*.swp`/`*.swo`/`*.swx`, `4913`, `*~`, `.#*`, `*.tmp`, JetBrains `*___jb_tmp___`/`*___jb_old___`); matching uses the file name only (#857).

  Plugin tools can opt into the resident tool set with `defineAgentTool({ alwaysLoaded: true })`. The default stays deferred (`discover` / `load_tool`), at most 8 declared tools are resident per turn, `alwaysLoadedMode: replace` ignores the flag, and pinned tools now stay resident when a turn rebuilds its tool list after `load_tool` (#857).

- 8302701: Make the plugin config source conflict actionable. When a trusted plugin declares both `definePlugin({ config })` and a root `schema.json`, startup still stops (Zhin never picks one), and the error now names the entry file and the `schema.json` path and explains which file to delete for each choice. `zhin new` templates keep `schema.json` as their only config source and say so in `plugin.ts` and the README.
- de5b2a1: Plugin instances accept a framework-owned `disabledCommands` list (like `commandNamespace`). Listed commands, given by their local path without namespace or parameters (`fanyi`, `netease login`; a parent path covers its subcommands), are left out of routing, so an application can drop the few commands that overlap with another plugin instead of prefixing every command of the plugin.
- 29d0be9: Recognise `package.json#exports["./zhin"]` (conditions `zhin` → `import` → `default`) as the runtime entry when `zhin.entry` is omitted. `zhin.entry` stays fully supported and wins when both are declared.
- Updated dependencies [d3563d9]
  - @zhin.js/feature-kit@1.1.7

## 1.1.9

### Patch Changes

- 2b4d6dc: 为已保存的插件配置提供只读字段来源与当前代一致性解释。复用同一次文件/运行代观察，仅返回有界 metadata；敏感字段、环境引用和不能证明的来源保持隐藏或未知。配置解释要求完整权限，不开放给 demo，也不执行应用或发送操作。
- 9816c18: 将应用插件装配改为 configVersion: 2：主配置 plugins 映射实例名到包，disable_plugins 控制启停，业务配置使用顶层同名块。package.json 继续保留 features、entry、engine 等包契约，并支持静态 displayName/icon。

  这是配置格式的破坏性更新：旧配置不能继续运行，请先停止 Bot，运行 `zhin migrate instances` 预览，再使用 `--apply` 转换；提供备份与中断继续/回滚，无法无损转换的嵌套、optional 和别名碰撞需人工迁移。Runtime、Console、CLI 与创建向导统一使用新声明。

  保留框架顶层 `menuKeyword` / `menuStyle`，通过当前 generation 的 Root 配置视图供 Command Feature 消费；严格校验和配置修改不会丢失菜单设置，子实例配置保持隔离。

- 8550f17: 补齐 Host 配置字段定义与未配置区块入口，完整投影对象、字典、联合、元组和本地引用，避免 Console 丢字段或整份退回源码。原始 Runtime Schema 继续负责校验。日历、提醒、复读和短链接发布静态配置定义，禁用时也可安全配置，无需执行插件代码。
- Updated dependencies [064b06d]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/feature-kit@1.1.6
  - @zhin.js/plugin-runtime@1.1.15

## 1.1.8

### Patch Changes

- dd7f25f: Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。

## 1.1.7

### Patch Changes

- a64716a: IM 回合的出网权限改为独立开关 `ai.agent.network`（`enabled`、`allowedDomains`），默认关闭；未设置 `enabled` 时仍兼容 `execPreset: network`。没有出网权限的回合不再向模型提供 `web_fetch` / `web_search`，并在提示词里写明真正的开启方式；拒绝信息也带上同样的修复说明，模型不再编造开关位置。
- 0c35b96: `zhin doctor` 的端口占用提示不再建议 `kill -9`，改为正常停止或 SIGTERM；缺少 `@zhin.js/tool` 时报错直接给出 `pnpm add @zhin.js/tool`；脚手架生成的 `.gitignore` 加入 `.zhin/`。
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [75e26a6]
- Updated dependencies [fdc2148]
  - @zhin.js/feature-kit@1.1.5
  - @zhin.js/plugin-runtime@1.1.14

## 1.1.6

### Patch Changes

- bf52b40: fix(agent): 本轮策略无法执行 Shell 时不再向模型提供 bash（工具列表与目录同时过滤，load_tool 也无法再加载），万一触发会返回明确、不可重试的错误。新增 `ai.agent.masterShell`（默认 `off`）：设为 `isolated` 时，仅 IM 私聊中的 master 可在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、白名单外命令需审批），宿主无 Docker 时直接失败、不降级到宿主机。
- fc75499: feat(agent): injection guard, outbound leak check and usage quotas (#727). Once external content (tool results, web pages, files, sub-agent reports, background group events) has entered a turn, shell commands, messages to other conversations, config changes and scheduled tasks always go through the ApprovalPort, with the source chain on the approval card; unattended turns deny them (`ai.agent.injectionGuard.confirmHighRisk`, default on). Replies, progress updates and outbound tool messages now mask verbatim system-prompt lines, secrets and other sessions' memory before delivery (`ai.agent.injectionGuard.outboundCheck`, default on). New `ai.agent.usageQuota` adds per-user / per-group token quotas and a per-group rate limit, all off by default, owner exempt.
- 7d2263c: Progress-aware tool-call budget (`ai.agent.toolBudget`): `maxIterations` becomes a soft budget extended while the turn makes progress (not when looping or failing), with hard step/wall-clock/token caps, opt-out automatic in-turn continuation (default: master private chat), throttled natural-language progress updates (default: private chats), and the exploration budget resetting on the same progress signal. Sub-agents use the same budget with a lower hard cap and no continuation.
- 7d2263c: Add opt-in in-turn sub-agents (`ai.agent.subagentTurnMode: sync`) on the plugin-runtime turn path. Sub-agents inherit the parent turn policy, never wider (no bash unless the parent can run it); approvals go to the parent conversation and requester. DeferredWorkerRunner now offers no bash unless given a frozen turn policy snapshot.
- a62acca: Ordinary IM turns now have a clear policy for messages that arrive while a turn is running (#725). A sender's follow-up replaces their own unanswered turn and is answered together with the earlier text, or merges into their queued turn. Other members' messages always queue and never interrupt or merge into someone else's turn. The initiator or master can stop a turn with `取消` / `cancel`. Queues are bounded by the new `ai.agent.inboundQueue.maxQueuedTurns` (default 5) and `ttlMs`, and queue waits and merges are recorded on the TurnTrace.
- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- 8e26cf1: 配置面收敛（#735）：弃用运行时未读取的 `ai.agent.maxSkills`、`policyDenialStopAfter`、`deferredToolMaxResults`、`taskExecApprovalMode`（启动告警，`zhin config check --fix` 可移除），新增《默认行为规范》权威文档与开关清单门禁。
- 4778587: 补齐 Console 安装配置闭环所需的精确配置路径、端点身份、平台就绪与验证计划失效语义，并保存历史消息的方向及实际投递诊断。

  修复真实 ICQQ 入站目标保存了插件 owner 而非平台标识、导致提醒投递被身份校验拒绝的问题；无关插件配置变更保留原有适配器连接。

  保证候选事件在当前代快照发布后准入，并避免安装过程中依赖文件变动提前中断插件管理操作。

  明确 Adapter/MCP 客户端创建仅提供所属 owner 的配置与资源，跨 Feature 查询由当前 operation 上下文负责；入站诊断记录接收时刻，避免慢指令的回复在历史中先于指令。

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- Updated dependencies [386150d]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/feature-kit@1.1.4

## 1.1.5

### Patch Changes

- b36452a: Bind optional decision providers to the held runtime generation. Add explicit off, shadow and active policies for progressive capability selection, scoped search reranking and automatic approval judgments, preserving deterministic permissions and human approval memory. Validate consumer configuration and expose redacted decision diagnostics.
- Updated dependencies [badcc1f]
  - @zhin.js/feature-kit@1.1.3
  - @zhin.js/plugin-runtime@1.1.12

## 1.1.4

### Patch Changes

- b9b3953: Expose the immutable Host configuration schema to Console and use the project's root schema for its plugin configuration form. Prefer available Chinese field descriptions and enforce numeric bounds and integer constraints during Console validation.
- b9b3953: Validate persisted Workroom Endpoint bindings against the exact projected candidate generation, including adapters authored by the project root. Defer file-backed Endpoint validation until candidate activation. Resolve Console Endpoint package aliases consistently with discovery and reject ambiguous aliases instead of selecting an account.

  Resolve Workroom human ingress from the canonical Endpoint capability identity and the operation Endpoint projection so root-local adapters use the same Catalog address as Console discovery. Unknown or duplicate canonical identities cannot select another account.

- b9b3953: 修复框架生命周期与消息处理的竞态：HMR 停止等待异步 watcher 清理，并在清理失败时仍等待在途 reload；命令前缀通过端点能力所属插件读取配置，前导空白不再丢失结构化参数；工具在异步策略检查后再次检查取消信号；文件缓存遇到超限替换时删除旧内容并保持字节计数一致。
- b9b3953: Normalize source ownership, module dependencies and reload notifications to physical paths so projects opened through symlinks reload correctly. Preserve matching after files or capability directories are removed by resolving the nearest existing parent.

## 1.1.3

### Patch Changes

- f12e39a: Track each loaded Feature entry's transitive local imports so edits to imported helper files reload only the affected capabilities, including helpers outside the entry directory, while refreshing the complete ESM import closure. Cache clean dependency graphs, resolve package imports with ESM conditions, handle `.mts` and `.cts` entries consistently, keep CommonJS require closures on the process-restart boundary, and discard removed-entry mappings only after a generation commits.

## 1.1.2

### Patch Changes

- 7a65d32: Load server TSX features through the active process loader or the CLI's scoped fallback loader, preserve explicit loaders across supervised restarts, and scaffold the JSX compiler settings advertised by the feature conventions.
- Updated dependencies [36c2eb9]
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/feature-kit@1.1.2

## 1.1.1

### Patch Changes

- 13f7301: Model owner-scoped database and schedule hosts as concrete classes over a shared abstract resource-host base. Construct the classes directly and remove the anonymous-object host factories.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 3d42fc9: Replace the YAML-only configuration adapter with the format-neutral `@zhin.js/config-file` module. YAML and JSON Root configurations now share one transactional file lifecycle with revision checks, atomic commit, rollback, and generation handoff; JSON is no longer loaded as a non-transactional startup snapshot. Configuration document ports and canonical immutable patch semantics now live in the foundational Plugin Runtime contract, so persistence adapters do not depend on schema composition and generation implementations.
- 44cf8cb: Rename the misleading Runtime `compatibility` module to `package-contract` and replace `PackageCompatibilityError` with `PackageContractError`. Engine and Feature API semver checks are current manifest invariants, not a legacy compatibility layer; no deprecated alias is retained.
- 2dbbc15: Classify watched Root configuration changes by their actual Host and Plugin projections, reload only affected Plugin subtrees, and request a process restart for Host configuration changes. Reload project dotenv layers as Runtime inputs so environment references are re-expanded without mutating global process state.
- 698f16f: Replace ambiguous command approval modes with `ask`, `auto`, and `bypass`, add a fail-closed review Agent, and scope remembered human decisions to the current invocation, sender, or conversation.
- 2fd8017: Make root `AGENTS.md` the main Agent contract and `agents/<name>/agent.json` plus `system.md`, `boundaries.md`, and `conventions.md` the only named sub-agent authoring shape. Standardize Agent and Skill private Tools, Skills, and Hooks as nested named directories, enforce access predicates and governed Tool activation, and keep supporting-file changes on Agent Slot hot reloads.
- cf83528: Apply the same database-table and schedule-job namespace rules to every plugin owner, including the root plugin. Remove the legacy process-host unwrapping APIs and require composition roots to provide the explicit root host tokens.
- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- df9f76b: Make Endpoint configuration persistence asynchronous and route it through the canonical transactional Root configuration port. Endpoint management now supports both YAML and JSON, materializes a missing Root config safely, serializes concurrent mutations, restores `.env` when the config commit fails, and restarts the development process after environment-file changes.
- Updated dependencies [13f7301]
- Updated dependencies [ef92a6d]
- Updated dependencies [8740059]
- Updated dependencies [3d42fc9]
- Updated dependencies [2dbbc15]
- Updated dependencies [31b42a8]
- Updated dependencies [65d0391]
- Updated dependencies [2fd8017]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/feature-kit@1.1.1

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/feature-kit@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 1.0.19

### Patch Changes

- f7ee28d: Add snapshot-scoped readiness probes and `zhin doctor --live` for required database, endpoint slots and Agent bindings. Load optional Agent and Workroom dependencies on demand so IM-only projects can start without the AI stack, while preserving Agent command help.

## 1.0.18

### Patch Changes

- fcbff21: Add durable Console plugin lifecycle controls and support secure multi-listener HTTP, HTTPS, and WebSocket hosts.

## 1.0.17

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.

## 1.0.16

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.

## 1.0.15

### Patch Changes

- 45d4f24: Fix direct ICQQ password configuration, keep Plugin-local JSON Schema references and UI annotations valid during runtime config composition, and make activity feedback rollback safe before generation activation.

## 1.0.14

### Patch Changes

- 2719580: Publish source-aligned configuration enums for Agent execution policies and the complete activity feedback Schema, including lifecycle phases, Schedule aliases, conversation scenes, presentation types, defaults, dynamic override paths, and localized field descriptions.
- c92286c: Make the Host configuration Schema a machine-readable Runtime contract so validation, generated configuration reference pages, and Console configuration projection share one source of truth.
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/feature-kit@1.0.13

## 1.0.13

### Patch Changes

- 67ef8c4: Publish each generation as one committed snapshot-and-state record so Runtime ownership and model sidecars cannot lag behind commit observers. `GenerationCommitEvent` now exposes `previous` and `current` committed records through their `snapshot` and `state` fields.

  Make HMR shutdown close admission and await the active reload, stop accepting generation work after a process restart is required, and isolate post-commit observer failures from the committed reload outcome.

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

- Updated dependencies [67ef8c4]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/feature-kit@1.0.12

## 1.0.12

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/feature-kit@1.0.11

## 1.0.11

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/feature-kit@1.0.10

## 1.0.10

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

- Updated dependencies [63253bb]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/feature-kit@1.0.9

## 1.0.9

### Patch Changes

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- Updated dependencies [c106ecc]
- Updated dependencies [daffd4c]
- Updated dependencies [e40b048]
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

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 43485a9: 架构对齐修复（platformFeatures 继承落地）：

  - `zhin.js` 主包 `zhin.plugins` 清空：host-router/host-api 是 legacy 插件包（`usePlugin` 入口），经 graph 加载会崩溃；新 Runtime 的 Console 由 cli 装配，门面保持纯 re-export。
  - `@zhin.js/runtime` package-resolver：`declaredDependency` 接受 `peerDependencies`（optional peer 是合法声明，未安装时由 `optional` 引用容错）。
  - `@zhin.js/cli` PackageCutover 检查器适配继承形态：依赖 zhin.js/core 时 manifest `features` 可省略 command/component/middleware（platformFeatures 继承），不再误报 blocked。
  - 文档：新增 `docs/architecture/package-topology.md`（包结构依赖图与各层 zhin 字段配置指南）。

- 8c7d03d: `zhin.plugins[].package` 支持 `./` 相对路径：子插件除 npm 包依赖外，可引用 monorepo 本地插件目录（相对声明方包根，禁止 `..` 越界，可嵌套挂本地子插件），无需发布 npm、无需写入 dependencies；workspace 扫描器不再拒绝 `plugins/<x>/plugins/` 嵌套目录。配合已有的「插件即 Root」能力，任意插件 + 一个 `zhin.config.yml` 即可独立启动。
- fa66c4c: Add transactional setup-time Feature registration through `PluginSetupContext.addFeature`, with
  typed shortcuts for Adapter, Command, Component, Middleware, Agent, Skill, Tool, and MCP Features.
  Setup definitions now share provider validation, projections, conflicts, ownership, and generation
  lifecycle with convention-discovered capability files. Feature providers can declare their own
  shortcut through `authoring.setupMethod`.
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
