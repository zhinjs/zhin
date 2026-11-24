# @zhin.js/gateway

## 1.9.0

### Minor Changes

- aadbab4: #1250 第 94 批：生产实例的常驻内存。

  API 变化：**`officialPluginCatalog()` 改为异步（不兼容）**；新增 `NativeDevelopmentModuleRuntime` 选项 `dependencyTracking` 与 `ModuleRuntime` / `NativeDevelopmentModuleRuntime` 的 `prepareInvalidation()`。版本级别暂按 patch，是否升 minor 待所有者决定。

  - `--no-watch` 不再分析依赖（prod-runs-dependency-index）：`NativeDevelopmentModuleRuntime` 新增选项 `dependencyTracking: 'eager' | 'lazy'`（开 `watch` 时默认 `eager`，否则 `lazy`）。`lazy` 时加载模块不做导入分析，也不加载 `es-module-lexer`（它的 WebAssembly 内存涨上去就不回落）和依赖索引；第一次显式重载（Agent 自改代码经 `RootHost.reloadSources()`）时才按已提交的入口分析一次，此后随加载保持更新；之后每次重载前还会补分析尚未进图的已提交入口（例如在依赖索引就绪前开始、之后才提交的加载），分析失败的入口会以 Node 进程警告报出（类型 `ZhinModuleRuntimeWarning`、代码 `ZHIN_DEPENDENCY_ANALYSIS_FAILED`，消息含入口路径与错误），在仍加载时让其它可被导入的文件（Markdown、YAML 除外；JSON 可经 `with { type: 'json' }` 导入，仍在保守范围内）的重载保守地要求重启，并在下次重载时重试；依赖索引加载失败不缓存，下次重载重试。`?zhin-generation=` 的版本号照旧记录，显式重载仍能换代。新增公开 API：`ModuleRuntime` 可选方法 `prepareInvalidation()`（HMR 协调器在每个重载事务的依赖查询前等待它）、`NativeDevelopmentModuleRuntime.prepareInvalidation()` 与选项 `dependencyTracking`；`@zhin.js/pagemanager` 的 `ClientBuildModuleRuntime` 与 `@zhin.js/testing` 的测试模块运行时转发该方法，并补上此前漏转发的 `staleDependents()` 与 `updateRevisionableRoots()`（真实实例经 `ClientBuildModuleRuntime` 包装模块运行时，漏转发时跨包重载会静默失效：导入已挂载工作区插件包的入口重载后仍拿到旧实例）。依赖图建立前，`affectedSources()` 只返回文件本身，`requiresProcessRestart()` 对辅助模块保守地要求重启。
  - 实例不再加载脚手架向导（instance-still-loads-cli-bits）：网关里实例也会导入的模块（`@zhin.js/gateway/iam` 的 Console 初始化服务、`@zhin.js/gateway/plugin-management` 的插件事务与官方插件候选）改为首次用到时才动态加载 `@zhin.js/scaffold-wizard`。**不兼容：`officialPluginCatalog()` 改为异步**，返回 `Promise`，调用方需要 `await`。打开 Console 后，插件检查、官方插件候选或 Console 初始化第一次用到脚手架向导时才加载它，此后驻留到进程退出；首次用到才加载是设计本意。`puppeteer-core` 不是本仓库任何包的依赖（`@zhin.js/html-renderer` 用 `@pixel.js/shotium`），实例里的它来自项目里的第三方插件。新增测试检查 `zhin.js/instance` 的静态导入图里没有 `@zhin.js/scaffold-wizard`、`@zhin.js/cli`、`puppeteer-core`、`inquirer`、`typescript` 和 `es-module-lexer`。
  - 文档（tsx-loader-for-one-jsx-file）：命令编写页写明项目里的 `.tsx` 文件会让实例常驻 tsx 和 esbuild 子进程（约 16MB），以及不用 JSX 的 `.ts` 写法；生产部署页说明 `--no-watch` 的实例不分析依赖。tsx 加载器本来就只在第一次加载 `.tsx` 失败后才注册，没有 `.tsx` 的项目不受影响。

- 466d5b9: #1250 第 97 批：已并入、改名或停更的 `@zhin.js` 包与已删除的子路径（retired-package-not-flagged），以及 `zhin migrate` 的 pnpm 设置。

  - `@zhin.js/gateway/project` 新增公开导出：常量 `RETIRED_ZHIN_PACKAGES`、`REMOVED_ZHIN_SUBPATHS`、`RETIRED_PACKAGES_DOCS_URL`，函数 `findRetiredZhinPackage(name)`、`findRemovedZhinSubpath(specifier)`、`findRetiredDependencies(manifest)`、`findRetiredImports(source)`，类型 `RetiredZhinPackage`、`RetiredPackageImport`、`RemovedZhinSubpath`、`RetiredDependency`、`RetiredImportUse`。
  - 清单按仓库历史覆盖 registry 上已不在工作区的 28 个 `@zhin.js` 包：并入（`@zhin.js/config-yaml`、`@zhin.js/config-file`、`@zhin.js/isolate` 并入 `@zhin.js/runtime`，`@zhin.js/interaction` 并入 `@zhin.js/im-contract/interaction`，`@zhin.js/ai-provider` 并入 `@zhin.js/ai/provider`，`@zhin.js/console-types` 并入 `@zhin.js/contract`）、改名（`@zhin.js/plugin-test-kit` → `@zhin.js/testing`，`@zhin.js/adapter-process` → `@zhin.js/adapter-sandbox`，`@zhin.js/game-shared` → `@zhin.js/game-kit`，`@zhin.js/console-core` → `@zhin.js/pagemanager`，`@zhin.js/plugin-github-notify` → `@zhin.js/adapter-github`）、删除并由其他包接手（`@zhin.js/plugin-voice` → `@zhin.js/speech`，`@zhin.js/plugin-html-renderer`、`@zhin.js/satori` → `@zhin.js/html-renderer`，`@zhin.js/sensitive-filter` → `@zhin.js/plugin-content-moderation`）、删除且由 `zhin start` 装配取代（`@zhin.js/console`、`@zhin.js/console-app`、`@zhin.js/http`、`@zhin.js/http-host`、`@zhin.js/host-api`、`@zhin.js/host-router`、`@zhin.js/workroom`），历史里找不到接手者的（`@zhin.js/dependency`、`@zhin.js/devteam`、`@zhin.js/hmr`、`@zhin.js/queue-runtime`、`@zhin.js/storage-port`、`@zhin.js/types`）统一标为「已停更，无直接替代」，只提示删除依赖。`@zhin.js/config-yaml` 条目写明 `YamlConfigDocumentError` 改名为 `ConfigFileDocumentError`、两个错误类改为继承它。已删除的子路径 `@zhin.js/agent/tools` 指向 `@zhin.js/tool`（`defineAgentTool`）。文档新增「升级：已并入或停更的包」。
  - `findRetiredImports` 线性扫描源码：跳过行注释与块注释，整体读取字符串字面量，所以注释和其他字符串里的写法不算；表达式起始处（运算符、`(`、`,`、`=`、`return` 等之后）的 `/` 按正则字面量整体跳过（含字符类与转义），其中的反引号或 `/*` 不再吞掉后面几行的 import；JSX 文本里的引号与反引号仍按代码读取（已知局限）。停更包只导出包根时，带子路径的 import 只给操作、不给替代路径。
  - 源码扫描另外跳过 `build`、`out`；`lib` 在所在包的 `main` / `module` / `exports` 指向其中的 `.js` 且没有 `src` 时照常扫描；最多读 5000 个源文件、访问 20000 个目录条目，达到上限时 doctor 与 migrate 提示「仅扫描了前 N 个源文件」。migrate 的这一步出错时与 doctor 一样只给警告，迁移继续。
  - `zhin doctor` 新增「已停更的 Zhin 包」：根目录或 pnpm 工作区成员的 `package.json` 直接依赖清单中的包时给出警告，写明改用什么、删除这个依赖；源码 import 已删除的子路径时同样警告并列出文件与行号。
  - 「Zhin 包单实例」报重复时，先沿依赖链指出是根项目或工作区成员的哪个直接依赖拖进了旧版本（如 `@zhin.js/config-yaml@1.1.0 → @zhin.js/runtime@1.1.0 → @zhin.js/plugin-runtime@1.1.9`），这份旧版本同时被工作区成员直接依赖时也照样指出；该依赖已停更时直接给出替代改法，同一个停更包拖进多份旧版本时只给一条，`pnpm.overrides` 只作为最后一条建议。
  - `zhin migrate` 不再升级清单中的包，新增「已停更的 Zhin 包」一步，列出声明它们的 `package.json` 与项目源码中要改写的 import（文件与行号，含已删除的子路径）；不自动改写源码、不删除依赖。
  - （行为变化）`zhin migrate`（含 `--include-pinned`）只在冷却期生效时才写 `minimumReleaseAgeExclude`：项目把 `minimumReleaseAge` 设为大于 0，或未设置但项目可能用 pnpm 11+。pnpm 版本只看 `packageManager`：没有固定 pnpm 时，即使本机是 pnpm 10 也按可能是 pnpm 11 处理（部署或 CI 可能用 pnpm 11），只有 `pnpm-workspace.yaml` 的 `minimumReleaseAge: 0` 能让它不写。pnpm 11+ 只读 `pnpm-workspace.yaml` 的设置（不读 `package.json#pnpm`，`.npmrc` 只读认证与 registry 类设置）；`packageManager` 固定 pnpm 10 及更早时还读项目 `.npmrc`（`minimum-release-age`）与 `package.json#pnpm`。`zhin doctor` / migrate 解释版本未装上的原因时按同样规则读取。
  - （行为变化）`packageManager` 固定 pnpm 10 及更早、且项目有 pnpm 会读的 `onlyBuiltDependencies` 列表时，网关原生依赖 `node-pty`、`ssh2`、`cpu-features` 一律只写进该列表，不再另写 `allowBuilds`；其余情况（固定 pnpm 11，或没有固定 pnpm）照写 `allowBuilds`（pnpm 11 只读 `allowBuilds`，旧版 pnpm 忽略该键）。本机 `pnpm --version` 不参与这一判断：本机是 pnpm 10、部署或 CI 是 pnpm 11 时，不写就不会构建这三个包。

### Patch Changes

- Updated dependencies [8fb5872]
- Updated dependencies [1bbed63]
- Updated dependencies [99947de]
- Updated dependencies [aadbab4]
- Updated dependencies [c6edbc1]
  - @zhin.js/host-http@1.8.1
  - @zhin.js/console-protocol@1.10.0
  - @zhin.js/database@1.2.3
  - @zhin.js/scaffold-wizard@1.4.6
  - @zhin.js/runtime@1.8.0

## 1.8.0

### Minor Changes

- 64612cf: 会话列表与审批卡片显示来自哪个聊天（zhinjs/zhin#1250 第 63 批）。全部是新增的可选字段，已有字段含义不变，不新增权限。

  - `@zhin.js/agent`：trace 会话摘要（`TurnTraceArchive.sessions()`，Console `GET /api/agent/trace-archive/sessions`，权限仍是 `agent.view`）新增 `origin`（最近一个记录了来源的回合的来源，与回合 `origin` 同形状）、可读名 `platform`、`scope_kind`、`scene_label`、`display_name`（如 `sandbox · 私聊 Developer`、`定时任务 每日早报`，与用量统计 `bySession[].displayName` 同格式）与 `conversations`（一个会话跨多段聊天时每段的 `{ origin, turns, last_started_at }` 加同样的可读名字段，最近的在前，最多 10 段，超出时给 `conversations_total`；只有 IM 会话、定时任务与内部来源分段，A2A / MCP / HTTP 回合同一会话只算一段）；旧 trace 没有来源时这些字段不出现。trace 的 `origin.conversation` 现在记录会话名 `name`（最长 128 个码点）；平台给的名字（群名、发起人显示名）在记录与生成可读名时清理控制字符、U+2028/2029 与双向控制符（转义为 `\uXXXX`）并按码点截断，新增导出 `sanitizeOriginText()`。工具审批队列的卡片（`ToolApprovalEntry`）新增 `turnOrigin` 与 `turnOriginLabel`。`@zhin.js/agent/trace` 新增导出 `turnOriginLabelOf()`、`turnOriginDisplayName()`、`turnOriginKey()`、`withScheduleJobLabel()`、`summarizeTraceSessions()`、`sessionLabelFields()`、`withSessionScheduleLabels()`、`TURN_TRACE_SESSION_CONVERSATION_LIMIT` 与类型 `TurnOriginLabel`、`TurnTraceSessionConversation`、`TurnTraceSessionLabelFields`。
  - `zhin.js`：Console `plugin.root.tool-approvals` 的卡片（`ToolApprovalCard`）新增 `origin`（与 trace `origin` 同形状）与可读名 `platform`、`scopeKind`、`sceneLabel`、`displayName`（卡片的 IM `origin` 只保留 `platform`、`endpoint`、`scope`、`sceneId` 与 `conversation: { kind, id, name? }`，新增导出类型 `ToolApprovalCardOrigin`）；trace 会话摘要里的定时任务会话、用量统计 `bySession` 里的 `schedule:<id>` 会话在实例还认得该任务时用任务的 `label` 命名（之前显示 `sched_<id>`）。
  - `@zhin.js/gateway`：用量统计新增可选 resolver `resolveScheduleJob`（导出类型 `UsageScheduleJobResolver`），定时任务会话的 `sceneLabel` / `displayName` 用任务名；会话名清理控制字符与双向控制符（新增导出 `sanitizeSessionText()`、`formatSessionDisplayName()`），缺 `platform` 时取会话的适配器，空白的 `scope` / `sceneId` 退回 `conversation.kind` / `conversation.id`。
  - `@zhin.js/cli`：`zhin trace --sessions` 每行显示 `平台 · 私聊/群 名称（短会话键）`（与 `zhin usage report` 同格式，输出前转义控制字符），跨多段聊天的会话在下面缩进列出每段聊天；没有记录来源的旧 trace 仍显示完整会话键。

- 58ce469: #1250 第 80 批：小型去重，统一多轨实现。

  - **重试、退避与可中断等待**：`@zhin.js/plugin-runtime` 新增 `sleep(ms, signal?)`（中止时清理计时器并以 `signal.reason` 拒绝）、`parseRetryAfterMs()`（解析秒数与 HTTP 日期：接受小数秒、`.5`、`5.` 与前导 `+`；负数、`1e3`、`0x10` 等非法值返回 `undefined`，AI 路径遇到这类值退回普通退避）和 `computeBackoffDelay()`（指数退避，默认等量抖动，可选对称抖动比例），插件经 `zhin.js` 导入。AI Provider 重试、OAuth 刷新冷却、适配器启动重试、地震与网络工具插件的 HTTP 重试、B 站直播 / QQ 扫码 / Telegram 轮询 / 微信 iLink 的等待全部改用它们；`@zhin.js/kernel` 删除不支持中止的 `sleep`，`@zhin.js/ai` 不再导出 `computeBackoffDelay` / `parseRetryAfterMs`，地震、网络工具和微信 iLink 插件不再导出各自的副本。
  - **HTML 转义**：`@zhin.js/plugin-runtime` 新增 `escapeHtml()`（转义 `& < > " '`），AI 输出、Console 页面外壳、`segment.escape`、链接海报和日历回调页改用它；`@zhin.js/pagemanager` 不再导出自己的 `escapeHtml`。`@zhin.js/jsx` 因只依赖 IM 契约保留同一实现，由契约测试锁定一致。
  - **`MarkdownView`**：`@zhin.js/components` 的 `Markdown` 组件改名为 `MarkdownView`（`MarkdownProps` → `MarkdownViewProps`，主题组件名同步），与 `zhin.js/jsx` 输出 Markdown 消息段的 `Markdown` 标签区分，不保留旧名。
  - **会话键**：`@zhin.js/console-protocol` 新增四段会话键 `parseConversationSessionKey()` / `formatConversationSessionKey()` / `isHashedSessionKey()`，网关用量统计（`parseSessionKey` 改名为 `sessionAddressOf`；endpoint 段为空的会话键照常解析，三段键只给出 platform）、实例的聊天记录与收件箱校验、沙盒页面都改用它。功能会话键在 plugin-runtime 与 console-protocol 中各保留一份（两者都是零依赖契约），由契约测试锁定语法、转义与错误文案一致。
  - **聊天角色导出格式**：`@zhin.js/console-protocol` 新增 `CHAT_ROLES_EXPORT_FORMAT`、`CHAT_ROLES_EXPORT_VERSION`、`CHAT_ROLES_BACKUP_DIRECTORY_SEGMENTS`、`chatRolesBackupFileName()` 与 `isConsoleChatRolesExport()`，`zhin chat-roles export|import` 与实例的导出、导入和迁移前备份共用；实例导入现在与 CLI 一样要求四个列表都存在。

### Patch Changes

- 7f39b10: feat!: 出站模板占位符重组为分组字段，并按发送账号渲染命令前缀、菜单与命令写法（#1250 第 70 批）

  **不兼容变更**：`TemplateContext` 字段重组，旧的顶层占位符 `${adapter}`、`${endpoint}`、`${endpointId}`、`${kind}`、`${conversationId}`、`${content}`、`${segments…}`、`${messageId}`、`${timestamp}`、`${mentioned}` 不再展开，会原样发出。所有占位符都至少两段，不再和配置加载时的环境变量引用（单个名字的 `${NAME}`）冲突。

  - `@zhin.js/plugin-runtime`：`TemplateContext` 改为分组——`bot`（`adapter`、`endpoint`、`endpointId`、新增的 `prefix` 与 `menu`，新增导出类型 `TemplateBot`）、`conversation`（`kind`、`id`）、`sender`（`id`、`name`、`roles`）、`message`（`content`、`segments`、`id`、`timestamp`、`mentioned`）与新增的 `command`（发出消息的插件自己的命令在该账号下的写法，`${command.checkin}`、`${command.group.kick}`，命令名里的 `-` 写成 `_`，新增导出类型 `TemplateCommandPaths`）。由事件触发、没有入站消息的发送，由发送方插件经 `incoming.sender` 传入事件主体。
  - `@zhin.js/core`：出站渲染按新结构填值；`${bot.menu}` / `${command.*}` 按这次发送的语言（`SendRequest.locale`，`$reply` 带入站消息的语言）取菜单关键词，没有时用项目语言，与入站 `message.commandMenu` / `formatCommand` 一致；`menuKeyword: false` 时 `${bot.menu}` 原样保留并按代告警一次（`reason=menu_disabled`）；`bot.prefix` / `bot.menu` 用与入站命令派发同一个 MessageDispatcher（同一个前缀解析器，含 `ImRuntime` 的 `commandPrefix` 覆盖）计算，只有文本含 `${` 时才计算，`${command.*}` 只在文本写了它时才列命令。模板仍是白名单路径替换、单次扫描；`command` 数据冻结、只有数据属性、不含其他插件的命令。
  - `@zhin.js/plugin-group-suite`：**不兼容变更**——入群欢迎语与问答回答改用出站模板占位符，旧的 `{name}`、`{id}`、`{sender}`、`{sender.id}`、`{time}`、`{date}` 不再展开，会原样发出。欢迎语写 `${sender.name}` / `${sender.id}`（新成员作为数据传入，昵称里的占位符不会被展开）、`${bot.menu}`、`${bot.prefix}`、`${command.*}`；问答回答另可写 `${now.time}`、`${now.date}`（由插件按提问者语言填写），正则捕获组 `$1`–`$9` 作为不受信任内容发送，不会被当成模板。账号配置了命令前缀而欢迎语直接写「帮助」「菜单」「help」「menu」时，在该账号第一条群消息时打一条 warn（只对本插件实际负责欢迎的群：在 `welcomeConversations` 内、且未由 Agent 会话欢迎接管）。欢迎语与已存问答里的旧占位符（`{name}`、`{sender.id}`、`{time}`、单段 `${menu}` 等）首次用到时按账号与文本各告警一次并给出新写法，只告警，不兼容、不迁移。
    - 回显用户数据的命令回复不再把数据当模板展开：teach / teach-regex 的确认、teach-list、forget、keyword-add / keyword-list / keyword-remove、积分与消息排行、mypoints、mystats 里引用的问题、回答、关键词、昵称与正则错误信息作为不受信任分段发送，按存储原样显示（此前教 `你好|你好 ${sender.name}` 的确认会显示「你好 Admin」）；只有插件自己的文案是模板。
    - **公开导出的返回类型变化**：`tryTeachReply` 由 `Promise<string | null>` 变为 `Promise<SendContent | null>`；`teachAdd`、`teachList`、`teachForget`、`myPoints`、`pointsRank`、`statsRankText`、`myStatsText` 由 `Promise<string>` 变为 `Promise<SendContent>`（引用用户数据时是含不受信任分段的数组）。直接调用这些函数的代码需按 `SendContent` 处理，或交给 `$reply` / 出站链发送。
  - `@zhin.js/agent`：Agent 会话入群欢迎（ADR 0037）的 `{nickname}` / `{group}` / `{rules_url}` 填入的值作为数据（`WelcomePart` 文本段新增可选 `literal: true`，发送时为不受信任分段），昵称里的 `${bot.menu}` 等不再被展开；运营者写的其余文本仍是出站模板。
  - `@zhin.js/testing`：`PluginTestKit` 与 `zhin start` 一样安装出站模板 Host（测试自己提供时不覆盖）。
  - `@zhin.js/gateway`：群欢迎用途页的提示改为新占位符写法。

- 49f9042: 统一显示语言类型、语言解析与列表分隔（zhinjs/zhin#1250 第 77 批）。

  - 新增：`@zhin.js/plugin-runtime` 导出 `formatList(locale, items, { separator? })`（`list` 默认 `、` / `, `，`comma` 为 `，` / `, `，`semicolon` 为 `；` / `; `；只拼接，英文不加 `and`），经 `zhin.js` 主入口与 `zhin.js/i18n` 再导出；`queryLocale()` 严格解析 `?locale=`；`projectLocale()` 从 `@zhin.js/core/runtime` 移入（core 不再导出）。
  - 命令的语言回退改走与消息相同的项目语言（先取 generation 投影的项目语言，再取根配置 `locale`）；之前命令只读根配置。消息自带的语言不合法时回退项目语言，而不是固定的 `zh-CN`。
  - Console 接口：`/conversations/workspaces/commands`、`/conversations/outcomes`、`/entries`、`/console/api/pages`、Console 首页与插件市场搜索的 `?locale=` 之前把非法值当作中文（或忽略），现在与任务、权限说明接口一样严格：不支持或重复的值返回 400（`invalid_locale`）。缺省行为不变。400 响应由 `@zhin.js/host-http` 新增导出的 `invalidLocaleResponse()` 统一给出（实例路由与插件市场共用，错误文案中英文一致：`locale 只能是 zh-CN 或 en（locale must be zh-CN or en）`；插件市场之前只有英文）。页面标题按 `titleI18n[locale]` 精确取值：`titleI18n` 的键只能是 `zh-CN` / `en`，不再按 `zh` / `en-US` 等前缀或其他键猜测。
  - 删除别名类型（不留兼容）：`@zhin.js/client` 的 `PluginUiLocale`（改为再导出 `@zhin.js/console-protocol` 新增的 `ConsoleLocale`），`@zhin.js/console-contract` 的 `PageKeywordLocale` 与 `DeclarativeUiLocale`（合并为本包零依赖的 `ConsoleLocale`），`@zhin.js/page` 对这两个类型的再导出；内部别名 `PlatformGuidanceLocale`、`CreateLocale`、`SandboxLocale`、`AdapterConsoleLocale` 一并删除。其余内联的 `'zh-CN' | 'en'` 改用 `Locale` / `ConsoleLocale`。
  - 语言判定改用 `resolveLocale()`：Agent 未执行工具提示与协作补充文案不再按 `en` 前缀猜测（`en-US` 之类的值回退中文；实际传入的都是已解析的语言）；系统提示的平台说明在缺少语言时改为中文（之前英文）；重启回执、消息结局文案、create-zhin、ICQQ 辅助脚本、成语接龙动作词同样改用统一解析。成语接龙的开局动作词（`chainStartAction`）之前把任何不以 `zh` 开头的值（如 `en-US`、`fr`）当作英文、给出 `pinyin` / `char`；现在只有 `en` 给出英文，其余不支持的值与缺省一样回退中文的「同音」/「同字」（`zh-CN` 与 `en` 不变）。B 站与掘金 Console RPC 删除各自的 `localeOf`。
  - 列表分隔统一用 `formatList`，输出不变：命令建议、回复兜底的工具列表、工具审批卡、群规豁免、账号命令字段、Console 提醒、地震订阅地区与数据源告警、游戏大厅、轮盘、文字冒险、猜词选项、内容审核动作、网络工具与 RSS 任务详情。`@zhin.js/command` 与 Agent 文案表中的分隔符条目（`suggestionSeparator`、`toolSeparator`、`listSeparator`、`detailSeparator`、猜词 `separator`）删除。

  `@zhin.js/console-ui`：仅补充 `ConsoleUiLocale` 与 `resolveConsoleUiLocale` 的说明注释（本地声明的理由、为何对浏览器语言标签保持宽松），行为不变。

- a05eb73: #1250 第 78 批：拒绝文案与「是不是全局主人」判定各收成一处。

  - `@zhin.js/permission`：拒绝文案的唯一来源。新增导出 `describeCommandDenial(permit, locale, options)`（命令被 `permit` 拒绝时的回复）、`describeGlobalOwnerRequired(locale, { privateChat, bindCommand, commandPrefix })`（需要全局聊天主人的能力：说明需要全局 owner 以及去哪里授予——Console「聊天角色」页，授予前先私聊发送「绑定 <码>」把聊天身份绑定到 Console 账号；还没有全局 owner 时私聊发送「认领 <码>」）、`describeConversationManagerDenial(locale)`（`canManageConversation` 的标准拒绝）与类型 `PermitDenialOptions`；`describeDeniedPermit` 新增第三个参数。`bind` 是普通命令：调用方给出 `bindCommand`（如 `CommandContext.formatCommand('bind')`）或实际命令前缀 `commandPrefix` 时，文案写出带前缀的「!!绑定 <码>」，都没有时注明「配置了命令前缀时带上前缀」（英文同步，并补「to a Console account」）。（不兼容）`describeDeniedPermit` 一律返回完整句子（如「此功能需要 zhin 角色。……」/ "This needs a zhin role. …"，原为「它需要 zhin 角色……」/ "it needs a zhin role…" 这样的句子片段），它也是 `CommandDispatchResult.denial.reason` 与命令反馈渲染器拿到的 `reason`；只有 `describeCommandDenial` 在前面拼上「没有权限执行此指令。」/「无法执行此指令。」（原为「没有权限执行此指令：……」「无法执行此指令：……」）。zhin 角色条件的拒绝不再点名缺的角色（原「需要你在本会话拥有 zhin 角色 {value}」），`owner@global` 改为全局 owner 说明。
  - `@zhin.js/command`：再导出 `describeConversationManagerDenial`（`zhin.js/command` 同样可用）。
  - `@zhin.js/core`：命令拒绝回复改用 `describeCommandDenial`（全局 owner 说明里的「绑定」带上本条消息实际的命令前缀）；`private()` 不满足时回复「此指令只能在私聊中使用，请私聊机器人发送。」（原为通用的「没有权限执行此指令。」）；消息结局 `permission_denied` 的发送者文案与命令拒绝同源（「没有权限执行此指令。」）；按钮 `permit` 不满足的回复改为「你不能使用这个按钮。<原因>」（原因是完整句子）。`usageSubjectFromMessage` 的 `owner` 改用 `isOwner()` 判定（行为不变）。（不兼容）删除 `MessageSender.isMaster` / `isTrusted`（无写入点；角色只读 `sender.chatRole`，判全局主人用 `isOwner()`）。
  - `@zhin.js/agent`：（不兼容）`RuntimeSenderRoles`、`TurnIntentSenderRoles`、`RuntimeManagementSenderRoles` 的 `{ isMaster, isTrusted }` 改为 `{ hostRole?: 'owner' | 'admin' | 'trusted' }`（宿主信任角色：`owner` 只给全局 owner，低层 owner 记为 `admin`）；删除 `ownerApprovalMessages.denied`、`managementMessages.denied`。主人命令 `approve …` 的拒绝改用全局 owner 共享说明（「绑定」带本账号命令前缀）；管理命令对无角色者回复共享的 `describeCommandDenial('trusted')`；`reset` 的拒绝也以这句开头（原「仅聊天角色 owner / admin / trusted 可用」），后面保留改发 /clear 的引导。主人判定统一走 `isOwner` / `hasChatRole`。
  - `zhin.js`：`config` 命令的 permit 改为 `owner@global` + `private()`（与命令内部 `senderIsGlobalOwner` 同一身份集合）：群里不是全局 owner 的人发送时不回复（结局 `permission_denied`），私聊里得到全局 owner 说明，全局 owner 在群里发得到「请私聊」提示。执行时授权器拒绝时回复与 permit 拒绝同一段文案（不再是「仅可在私聊中使用」变体），并像 `restart` 一样记 `permission_denied`（原因 `not-global-owner`）、群里静默。`restart` 与 `config` 的拒绝都改用全局 owner 共享说明，「绑定」带上实际命令前缀。「是否已有全局 owner」只剩一处判定（实例内部 `hasGlobalOwner`）。
  - `@zhin.js/console-protocol`：新增导出 `isGlobalOwnerGrant(grant)`、`hasGlobalOwnerGrant(grants)`；`@zhin.js/host-http`、`@zhin.js/gateway` 判 Console 全局所有者改用它们（行为不变）。
  - `@zhin.js/plugin-bilibili`、`@zhin.js/plugin-earthquake`：（不兼容）删除未被引用的 `SUBSCRIPTION_PERMISSION_DENIED_MESSAGE` 与 i18n 的 `denied` 键；群里无权订阅时改回复标准拒绝 `describeConversationManagerDenial()`。
  - `@zhin.js/adapter-icqq`：`icqq login` 的操作者判定改用 `@zhin.js/core` 的 `isOwner()`（行为不变）。

- ee51324: 统一 `${VAR}` / `env://` 环境变量引用的识别（#1250 第 79 批）：所有识别、提取与「缺少环境变量」检查都改用 `@zhin.js/plugin-runtime` 里与展开器共用同一解析器的函数，规则与展开完全一致。

  - `@zhin.js/plugin-runtime` 新增 `parseEnvironmentReference()`（整段引用，含 `:-` / `:=` 默认值）、`isWholeEnvironmentReference()`、`environmentReferencesIn()`（提取所有引用及是否带默认值）、`parseEnvUri()`（`env://NAME`）、`isEnvironmentVariableName()`、`findUnsetEnvironmentReferences()` 与 `createEnvironmentLookup()`。
  - 「缺少环境变量」只有一个实现：实例启动警告与网关配置校验的 `missingEnv` 都调用 `findUnsetEnvironmentReferences()`；带默认值的引用（`${VAR:-…}` / `${VAR:=…}`，即使默认值为空）不再被报缺失。
  - `@zhin.js/host-http` 删除导出 `ENVIRONMENT_REFERENCE_PATTERN`，改用 `isWholeEnvironmentReference()`。
  - 密钥字段识别（`isConfigEnvironmentReference`）只把展开器会替换的引用或合法的 `env://NAME` 当作引用：`p${ss`、`${1KEY}`、`env://bad-name` 这类文字现在按字面值密钥处理（启动警告、`zhin doctor --fix`、Console 写入 `.env`）。
  - 网关：密钥字段原本是 `${HTTP_TOKEN:-默认值}` 时，写入新值会原地更新该字段自己的变量（不再另起 `_2`），配置改为 `${HTTP_TOKEN}`；数据库初始化向导里整段带默认值的引用按引用保留，不再写入 `.env`。
  - AI：`${VAR:-默认值}` 凭据表达式的默认值与展开一致，可以包含 `{`；旧配置迁移只把整段 `${VAR}` / `env://VAR` 转成 `env://` 账号来源（写错的 `${…` 仍然拦下，不当作字面密钥）。
  - 适配器 Console：环境变量字段只在值为不带默认值的整段 `${VAR}` 时显示原文，带默认值时按密钥遮蔽（默认值可能就是密钥）。
  - 适配器账号导入（`zhin.config.yml` → 持久化账号）：含 `${` 的值仍一律作为引用存入 `secretRefs`（与旧版一致，按密钥遮蔽、不进入保存的配置），即使它不是合法引用。启动时，旧版本已存储的不合法引用（如没有闭合的 `${QQ_SECRET`，或本身含 `${` 的真实令牌）按原文作为字面值使用，并记一条警告（只含账号 ID，不含值）提示改正后重新导入；过去这类值同样按原文生效，升级后账号照常启动。
  - 网关 `.env` 视图：`isReference` 只标记不带默认值的整段 `${NAME}`（与协议说明一致）；Console 配置遮蔽只遮蔽解析器认可的引用，其他含 `${` 的文字在普通字段按原文显示，密钥字段仍遮蔽。
  - 脚手架数据库校验、`@zhin.js/plugin-code-runner` 与 `@zhin.js/plugin-calendar` 的「未展开占位符」判断改用同一解析器（插件经 `zhin.js` 主入口拿到 `isWholeEnvironmentReference()`）：`${1KEY}` 这类文字现在按真实值处理，`${VAR:-}` 仍视为未配置。
  - 实例：`readConfiguredEndpointKeys()` 新增可选的环境查找参数，实例传入自己的 EnvStore，未生效配置里的端点 ID 能读到 `.env` 里的变量（过去只读进程环境）；`resolveAiConfig()`、Speech 与协议 Host 的配置读取不再对已展开的配置做第二次只读进程环境的展开（过去会把 `.env` 值里的 `${…}` 文字再展开一次）；`http` 配置改为与网关 / CLI 相同，从未展开的配置文档只展开一次（过去 `${B:-${C}}` 在 `B` 未设置时会被二次展开成 `C` 的值）。实例内部删除了从未被读取的 `secureCredentialProvider` 选项。

- Updated dependencies [63d7fd9]
- Updated dependencies [7f39b10]
- Updated dependencies [49f9042]
- Updated dependencies [a05eb73]
- Updated dependencies [ee51324]
- Updated dependencies [58ce469]
- Updated dependencies [74eb13a]
  - @zhin.js/scaffold-wizard@1.4.5
  - @zhin.js/plugin-runtime@1.5.0
  - @zhin.js/console-protocol@1.9.0
  - @zhin.js/host-http@1.8.0
  - @zhin.js/runtime@1.7.2

## 1.7.0

### Minor Changes

- c922f64: Console 用量统计 `plugin.root.usage-stats` 补维度字段（#1250 第 58 批，Token 用量页重新设计第 3 步的后端部分）。全部是新增的可选字段，已有字段含义不变，权限仍是 `control:read`，不返回提示词或消息内容。

  - 返回顶层新增 `schemaVersion`（当前为 2），Console 可按它降级。
  - `byModel[]` 新增 `driverLabel`（服务所用驱动的显示名）与 `profileId` / `profileName`（这一行的调用都落在同一个模型 Profile 上时），两个服务同名时可以区分。
  - 新增 `byAgent[]`（主助手 / 子 Agent / 未记录）与 `byPurpose[]`（`chat`、`agent`、`summary`、`ambient`、`perception` 等，带可读 `label`），数据来自每个（子）回合 trace 的 `model_selection`；没有记录模型选择的旧 trace 归入「未记录」（`@unrecorded`）。
  - `bySession[]` 新增结构化会话名字段 `scopeKind`（`group` / `private` / `channel` / `schedule` / `internal` / `http` / `a2a` / `mcp`）、`sceneLabel`（不含类型词的群名 / 用户名等）与 `shortKey`（与 `zhin usage report` 同规则的短键），Console 可按界面语言拼名、重名时追加短键；`displayName` 不变。
  - `bySession[]` 新增 `endpoint` 与 `accountLabel`（账号现在的名称）；顶层新增 `sessionsTotal` 与 `othersTotals`（前 50 个之外的会话合计）。
  - 请求参数新增可选 `compare: 'previous'`：返回 `previous: { since, until, truncated, totals }`，即紧挨在前、等长的上一周期的汇总（不含明细）；上一周期按毫秒长度平移（不按日历），`session` 过滤同样作用于它；当前区间与上一周期各自最多 31 天（总扫描最多 62 天），只算上一周期的 totals，上一周期被截短时标 `truncated: true`。`compare` 写别的值返回 `invalid_input`。
  - `@zhin.js/gateway/usage` 新增导出：常量 `USAGE_STATS_SCHEMA_VERSION`、`USAGE_MAIN_AGENT_KEY`、`USAGE_UNRECORDED_KEY`，函数 `usagePurposeLabel()`、`sessionPartsOf()`，类型 `UsageSessionParts`、`UsageAgentRow`、`UsagePurposeRow`、`UsageStatsPreviousWindow`、`UsageResolvedService`、`UsageProfileResolver`、`UsageAccountResolver`；`UsageStatsQuery` 新增可选 `previous`，`UsageStatsOptions` 新增可选 `resolveProfile` / `resolveAccount`，`UsageProviderResolver` 的返回值可带 `driverLabel`，`UsageStats` 新增上述字段。
  - `zhin.js` 实例：`createProviderDisplayIndex()` 新增可选参数 `{ driverLabel }`，`ProviderServiceDisplay` 新增可选 `driverId` / `driverLabel`，服务既无名称又无驱动时省略 `label`（不再把 `services:<id>` 当名称，显示名只剩模型名）；`AssistantStatus` 新增 `bindUsageEndpoints()`；`UsageStatsService` 新增可选 `profileResolver` / `accountResolver`；新增 `previousUsageWindow()` 与类型 `UsageEndpointSource`。

- 19eeb90: 网关新增只读版本检查 RPC `gateway.version.check`（zhinjs/console#64 version-update），供 Console 显示当前版本与「有新版本」提示。

  - 报告 `zhin.js`、`@zhin.js/gateway`、`@zhin.js/console-*` 与已安装的 `@zhin.js/*` 插件（`package.json#zhin.type: "plugin"`）：每行 `name` / `range` / `installed` / `latest` / `wanted`（声明范围内的最高版本）/ `latestInRange` / `updateAvailable` / `needsMigrate`，外加 `gateway`（运行中的网关版本）、`checkedAt`、`registryReachable`、`truncated`、`incomplete`（到截止时间还有包没查，这些行 `latest: null`，与 `registryReachable: false` 区分）。核心行固定按 `zhin.js` → `@zhin.js/gateway` → `@zhin.js/console-*` 排列。插件超过 64 个时 `truncated` 为 true，`zhin.js`、`@zhin.js/gateway` 与 `@zhin.js/console-*` 仍留在报告里。网关不是项目直接依赖时也单列一行（`range: null`）。
  - 权限 `status.view`（与实例状态相同），已登记到 `GATEWAY_RPC_PERMISSIONS` / `CONSOLE_RPC_PERMISSIONS`。由网关自己回答，实例停止时也可用。
  - 在项目根目录执行 `npm view <包> dist-tags versions --json`，沿用项目的 npm 配置（`.npmrc`、镜像）；结果在内存缓存约 6 小时，失败的查询 10 分钟后重试，单次超时 5 秒，整次查询（含第一次探测）不超过约 8 秒（留在 Console 默认 10 秒请求超时之内）：每次查询的超时取单次超时与剩余时间中较短的一个，截止前一直可以开始新查询；到点就返回已经查到的结果，来不及查的为 `latest: null` 并标 `incomplete`。因截止被缩短而失败的查询不记作 registry 失败、不进失败缓存。先探测一个包，registry 不可达时其余包不再逐个等超时。离线、超时都得到 `latest: null` 与 `registryReachable: false`，从不报错；没有新增配置开关。
  - 只报告不升级：超出声明范围的新版本标为 `needsMigrate`，Console 只提示 `npx zhin migrate --dry-run`（新导出常量 `GATEWAY_VERSION_MIGRATE_COMMAND`），框架升级仍只走 `zhin migrate`（ADR 0062）。
  - `@zhin.js/console-protocol` 新增 `GATEWAY_VERSION_RPC`、类型 `GatewayVersionReport` / `GatewayVersionPackage`。`@zhin.js/gateway` 新增公开导出 `GatewayVersionChecker`、`classifyPackageVersion()`、`isVersionCheckedPackage()`、`parseNpmViewVersions()`、`npmViewRegistryFetcher`（/packages），`GatewayPackageService` 新增 `inventory()`（不做授权的依赖清单，供已自行授权的网关服务使用）；网关新增依赖 `semver`。
  - 文档：Console「运维」页（中英文）补充「版本」说明，CLI 文档的 `migrate` 小节加锚点 `#migrate`。

### Patch Changes

- 23eb6ef: 前几批审查遗留的低危项（#1250 第 56 批）。

  - **移除工具预执行**（ADR 0067 遗留）：`preExecutable` 工具原先在模型调用前被执行，输出作为「Pre-fetched data」注入提示词，不经工具运行时、不记来源。Plugin Runtime 路径本就不保留这个标记，只有旧的 `ZhinAgent.process` / `processTurn` / `processStream` 能走到，而这条路径没有来源门禁，因此直接删除该机制：回合不再注入预取数据；`@zhin.js/agent/tool` 的 `planToolRun()` 与 `ToolRunPlan` 已弃用、不再起作用（不执行任何工具，总是返回空的预执行结果），下一个 minor 删除；`AgentTool.preExecutable`（`@zhin.js/ai`）、`Tool.preExecutable` 与 `SceneManagementMethodSpec.preExecutable`（`@zhin.js/core`）保留为 `@deprecated`、不再起作用，成员列表 / 场景信息工具不再标记它。`ai.agent.preExecTimeout` 改为已弃用键（启动告警、`zhin config check` 报告、`--fix` 删除），从 `@zhin.js/runtime` 的配置 schema 与默认配置中移除。
  - `TriggerTimeoutError` 合并为一个类：`@zhin.js/agent/runtime` 重新导出 `@zhin.js/agent/turn` 的实现，工具运行时把入站超时正确认作 harness 错误。构造函数以超时毫秒数为主（`new TriggerTimeoutError(60000)`），旧的 `(sessionKey, timeoutMs)` 写法仍可用（已弃用），消息统一为「AI 处理超时（Nms）」。
  - 网络请求被重定向到不允许的地址，或重定向那一跳出现其他网络错误（DNS 解析失败、TLS 证书主机名不符等）时，错误原因改为固定文案，不再带出重定向目标的主机名或解析出的地址（原因只写 debug 日志）；首个 URL 的错误原因不变。
  - `zhin update` 的 pnpm overrides 同步（`@zhin.js/gateway`，`zhin update --dry-run` 的 `@zhin.js/cli` 同步一致）：`pnpm-workspace.yaml` 中值为 YAML 块标量（`>-` / `|`）、带锚点且被别名引用、或本身是别名的 Zhin 条目，一律列为「需要手动修改」并给出文件行号，不再自动剪下（块标量原先会多剪下一条，锚点剪掉后别名悬空）。
  - 协作：有协作的根回合在流式回复的每次中间更新和收尾时都过滤 `[[no_reply]]` 标记（含大小写、反引号变体；生成中结尾可能成为标记的残片先暂缓发出，只暂缓最后一个已删标记之后新增的内容；只剩空白的段在生成中也先暂缓，前导空白加纯标记的回答不再发出空白消息），已发内容不被改写，不会因前缀变化被平台流拒绝；actor 回合结束和根回合结束后迟到的委派读取不再登记，结果邮件立即照常处理，不再空等 120 秒。

- Updated dependencies [dff78e6]
- Updated dependencies [23eb6ef]
- Updated dependencies [19eeb90]
  - @zhin.js/host-http@1.7.1
  - @zhin.js/runtime@1.7.1
  - @zhin.js/console-protocol@1.8.0
  - @zhin.js/scaffold-wizard@1.4.4

## 1.6.2

### Patch Changes

- e234015: `zhin update` 同步 pnpm overrides 里 Zhin 包的版本锁（`update-overrides-not-synced`）。原来带 `pnpm.overrides` 锁住 Zhin 包的项目执行 `zhin update` 后，要么什么都没升级（override 把版本留在旧值），要么 `zhin update zhin.js@x.y.z` 装上新版 zhin.js、其依赖却被旧锁固定，`zhin doctor` 的「Zhin 包单实例」检查失败。现在更新涉及 Zhin 包（不带包名，或指定了 `zhin.js` / `@zhin.js/*`）时，网关在包管理器运行前去掉能同步的 Zhin 条目（`package.json#pnpm.overrides` 与 `pnpm-workspace.yaml#overrides`，按包名的键和单级 `>` 选择器），运行后按已安装版本写回（保留 `1.2.3` / `^` / `~` 写法与条目顺序）并重新安装一次；非 Zhin 条目与 `link:` 等本地接线不动，无法自动同步的写法打印要手改的文件、行号和键。改动在事务快照里，失败时一起回滚。`zhin update --dry-run` 按「Zhin 包」「其他依赖」分组（Zhin 包在前），并单独列出 overrides 会怎么改。

  只在用 pnpm 安装的项目里同步（npm / yarn / bun 不读 pnpm overrides）。写回后的重装带 `--no-frozen-lockfile`，`CI=true` 时 pnpm 不再以 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` 拒绝（npm / yarn / bun 没有这个参数，子进程里去掉 `CI`）。`zhin update @zhin.js/x@版本` 而 override 会把它钉回 zhin.js 依赖的版本时，直接失败并回滚，提示改为升级 zhin.js 或要手改的文件与行；重装后还会核对请求的包实际装上的版本，不符同样失败回滚。`pnpm-workspace.yaml` 按文本原位改写，引号、注释、flow 序列与无关条目的格式保持不变，只有版本号变化。手改提示的行号定位到 `pnpm.overrides` 里的条目。`--dry-run` 对会被同步的 override 按写回后的值显示最终版本，单包升级会冲突时提前说明。

- Updated dependencies [c7f6285]
- Updated dependencies [2f49a9c]
  - @zhin.js/host-http@1.7.0
  - @zhin.js/console-protocol@1.7.0
  - @zhin.js/runtime@1.7.0
  - @zhin.js/scaffold-wizard@1.4.3

## 1.6.1

### Patch Changes

- 5cfb5d7: 「旁听」用途和决策「旁听参与判断」合成一项「插话判断」`purposes.ambient`，旧配置自动迁移（ADR 0066 P1，行为变更）。

  - 新的配置形状 `purposes.ambient: { profile, fallbacks, compare, minConfidence, mode, timeoutMs }`：主判断与备用链可以混排语言模型和决策模型（判断器按 Profile 的模型类型分派），`compare` 是只记录的对照模型，`minConfidence`（默认 0.7）是唯一的门槛，`mode: shadow` 是唯一的「只记录不插话」，`timeoutMs` 是决策模型成员的单次超时。字符串写法 `ambient: <profile>` 仍然有效；写入总是整项替换，`null` 清除。没写 `profile` 时继承部署聊天的主项和备用链（此时不能单独写 `fallbacks`）。只允许这 6 个键，Profile 必须存在、属于 Host、不能是图像模型，链内不能重复、不能包含 `profile`，`compare` 不能在链内；错误带路径（如 `purposes.ambient.fallbacks[1]`）。
  - **行为变化**：旧配置在 Host 加载模型配置时自动迁移一次（一个 CAS 事务，同时写迁移记录，`before` 保存迁移前完整的 `purposes`）。原来决策「启用」并单独配置了旁听语言模型的部署，该语言模型成为第一个备用：决策模型超时、网络错误、5xx、回答无效或配额用完时由它接手插话（以前直接不插话）。门槛取原来两道门槛中较大的值，插话不会因此变多。决策「仅评估」迁移为对照模型，主判断与插话行为不变；决策「关闭」的 Profile 不迁移。`zhin.config.yml` 的 `ai.trigger.ambient.minConfidence` / `mode` 在迁移时读入一次，之后不再生效（每个 generation 启动时警告一次）。迁移失败时不写数据库，本次按同一张表在内存里转换后运行，记 `ambient_judge_migration_failed`，下次加载重试。
  - **降级前必须先回退**：新增 `zhin ai purposes revert ambient-judge`（只能经本机网关执行），在 `purposes.ambient` 自迁移后没被修改时恢复迁移前的旧写法；旧版本读不了含 `purposes.ambient` 的模型配置。回退后当前版本仍按旧写法换算运行，不会自动再迁移。
  - `DecisionEngagementJudge` 不再设内部门槛（`DecisionEngagementJudgeOptions` 新增 `timeoutMs` / `mode`，`policy` 废弃），`AmbientEngagement` 只按 `purposes.ambient` 的门槛判一次，语言模型与决策模型都是 `engage && confidence ≥ minConfidence` 才插话。`DecisionPurpose` / `DECISION_TASKS` 去掉 `ambient`（决策用途剩五类）。
  - 废弃期（本 minor 和下一个 minor）：导入 `purposes.decisions.ambient` 时按迁移表合并进 `purposes.ambient`，导入结果带警告（`warnings`，路径 `purposes.decisions.ambient`）；导出只写新形状。自我变更和聊天里的 `config set` 不能再写 `ai.trigger.ambient.minConfidence` / `mode`。
  - 新增 `GET {base}/agent/inference/ambient-judge`（生效的插话判断与迁移记录，Host 管理员）、`POST …/ambient-judge/migration/noticed`、`POST …/cli/purposes/revert-ambient-judge`（本机 CLI）。
  - `@zhin.js/runtime`：配置 schema 中两键的描述改为「已废弃」。

- 000bec6: `zhin packages status` 读取运行中实例的当前 generation，不再一律报「待重启」；trace 的 `tool_result` 记模型实际拿到的大小（#1250 第 39 批）。

  - `plugin-status-always-pending-restart`：CLI 不带 `--live` 时只检查本地文件，没有运行中实例的 snapshot，`published` 永远是 `false`、`restartRequired` 永远是 `true`，于是整套服务刚重启完所有插件也显示 `pending-restart`。现在 `zhin packages status` / `verification-plan` / `apply` / `verify` 省略 `--live` 时经本项目网关的本地套接字转给受监管的实例（与 Console 相同的 `plugin:*` RPC），由持有当前 snapshot 的实例计算状态与 generation；`apply` / `verify` 的 `--live` 因此变为可选，没有连上实例时直接拒绝且不执行任何操作。
  - 拿不到 snapshot 时（网关未运行、实例没有应答、实例尚未上报 generation），声明且启用的插件 `status` 为新的 `unknown`，`restartRequired: false`，并在新增的可选字段 `statusReason`（`PluginManagementState`，`@zhin.js/host-http`）说明原因（「没有连上运行中的实例……」「实例尚未上报 generation……」，CLI 离线时再附上网关未运行等具体原因），不再说 `pending-restart`。`install` / `declare` / 启用停用与 `apply` 判断「这次改动是否需要重启」时，对 `unknown` 仍按需要启动处理，行为不变。
  - `verification-plan-empty-unexplained`（同一原因）：经网关读取时计划来自运行中的实例，输出标明「经本项目网关读取运行中的实例」，给出的 `zhin packages verify` 命令不再需要 `--live`；离线时额外说明没有连上实例的原因。
  - `trace-tool-result-size-pre-strip`：trace 中工具调用的 `result_size` 与时间线 `tool_result` 改为模型实际收到的字符数（拆出媒体、省略内嵌二进制、追加提示之后），与工具原始输出大小不同时另记 `raw_result_size`（时间线写成 `… 240 chars (raw 11559 chars)`，`formatTurnTrace` 写成「240 字符（工具原始输出 11559 字符）」）。

- Updated dependencies [49a1136]
- Updated dependencies [5cfb5d7]
- Updated dependencies [8c0d262]
- Updated dependencies [c2cc4ba]
- Updated dependencies [000bec6]
- Updated dependencies [a8377d4]
- Updated dependencies [4760a96]
  - @zhin.js/runtime@1.6.1
  - @zhin.js/scaffold-wizard@1.4.2
  - @zhin.js/plugin-runtime@1.4.1
  - @zhin.js/host-http@1.6.1
  - @zhin.js/console-protocol@1.6.1

## 1.6.0

### Minor Changes

- d216b84: CLI 与聊天身份（zhinjs/zhin#1250 第 22 批）：

  - `ai.personalPrincipals`（ADR 0060 P3）：首次导入时因键不是 `user:<id>` 而跳过（`not-a-user`）的条目不再算作已迁移。在首次导入后 30 天内改正键，`adapterId` 与 `subjectId` 相同的条目在下次启动按首次导入处理，不进入「等待 Console 确认」；每个身份只能改正一次，首次导入之后被确认、忽略或导入过的身份不再适用，改键时新加的身份、首次导入之后才出现的无效键仍需确认，持有授予的人仍不会被自动链接，改正导入写审计并重新显示在「需要你处理」里。首次导入之后新增、适配器当时未加载的条目，加载后也改为等待确认（此前会被自动链接；1.4.0 记录里晚于首次导入的这类条目同样）。1.4.0 写下的记录里已在等待确认或已被忽略的条目保持原状。
  - 键无效时，实例警告说明改正后会怎样；网关在实例启动后把建议的键写进网关自己的日志（前台运行时的终端、后台运行时的 `.zhin/logs/gateway.log`；不写进 Console 可读的实例日志，实例日志只提示运行 `zhin console user list`）：键正好是某个用户名时给出该用户的 `user:<id>`，只有一个所有者时给出「当前唯一的所有者是 …，可改为 `user:<id>`」。不接受用户名作键：用户删除后同名可被别人重新注册。`@zhin.js/gateway/iam` 新增 `personalPrincipalKeyHints()`、`personalPrincipalKeysOf()`。
  - `zhin console user list` 显示用户 id，新增 `--json`（`{ users: [{ id, username, displayName, disabled, roles }] }`）；状态改为「启用 / 已禁用」并加表头。
  - 导入日志带账号：同一 openid 挂在同一适配器的两个账号上时写成 `qq:<openid>（账号 <endpoint id>）`。
  - `zhin agent info` 按来源统计：项目根目录的约定目录（`tools/`、`skills/`、`agents/*/tools` …）、本地插件（`plugins/`）与已安装的插件（`node_modules` 中带 `package.json#zhin` 清单的包，不再计入没有清单的包），报告新增 `source` 与 `bySource`；帮助为中英双语，输出按项目 `locale`（新增 `--locale`）显示中文或英文。`@zhin.js/agent` 的 `formatAgentSurfaceInfoReport()` 新增可选参数 `locale`，新增导出类型 `AgentSurfaceSource`、`AgentSurfaceCounts`。
  - CLI 日期时间统一为本地时区的 `2026-11-15 00:15:56`（24 小时制），中英文相同：`zhin trace -l` / `--sessions` / 回合详情、`zhin schedule list`（下次运行与 `at`）、`zhin watch`（`at` 此前显示的是 UTC 时间）、`zhin doctor` 的「上次运行」、`zhin search` / `info` 的日期，以及 `zhin usage report` 的日期。`@zhin.js/plugin-runtime` 新增 `formatDateTime()` 与 `FormatDateTimeOptions`。
  - `zhin trace -l` 的会话列显示与 `zhin usage report` 相同的可读名称加短键（如 `sandbox · 私聊 Developer（personal-session:ab12cd34）`）；`--json` 保留完整 `session_key` 并加上 `session_display_name`。`@zhin.js/agent/trace` 的 `formatTurnTraceList()` 新增可选参数 `{ sessionLabel }`（类型 `FormatTurnTraceListOptions`）；`@zhin.js/gateway/usage` 新增 `shortSessionKey()`、`sessionLabelOf()`。

- a7f3a7c: MCP 状态口径与安装预览（zhinjs/zhin#1250 第 28 批）：

  - `mcp-status-not-loaded-contradicts-agent`（根因）：Plugin Runtime 下 `ai.mcpServers` 的服务作为本代（generation）的 MCP 特性运行，在代激活时连接；Agent 的内省却只读自己的 `resourceHub.mcps` 注册表，而这些服务从不进入该表，于是 Console「运行时能力 → MCP 服务」、`zhin status` 都把已连接的 github 显示成「未加载」（`not_loaded`），「需要你处理」也报「未连接」。现在由 `HostMcpStatusBoard` 记录每个配置服务客户端的实际连接结果（跨代保留：被沿用的代仍算已连接，候选代连接失败不影响旧代），内省按它报告：已连接（含工具数）/ 连接失败（附分类原因）/ 尚未连接（`idle`，显示为「待连接」：配置的服务在代激活时就连接，这是激活前的短暂状态）。发布新的一代时清掉已从配置删除的服务的失败记录，删掉再加回来不会显示旧原因。
  - 「需要你处理」只列连接失败的 MCP 服务并附失败原因，标题改为「MCP 服务 … 连接失败」；尚未连接、未加载的服务只在 MCP 页显示。`zhin status` 中 `idle` 显示为「待连接」。
  - 启动日志 `ready | … | mcp:` 改为与状态一致的写法（如 `github(待连接)`；日志写出时客户端尚未连接），连接结果另记 `mcp_connected`（工具数）/ `mcp_connect_failed`（分类与原因）。
  - 新增 MCP 连接测试：`POST {base}/introspection/mcp/test`（body `{ name }`，权限 `agent.configure`，已登记到 `CONSOLE_HTTP_PERMISSIONS`）用一次性客户端连接、列工具后断开，不改变 Agent 自己的连接与行状态；未配置的名字返回 404，同一服务测试进行中返回 409，Agent 未运行返回 503；全局最多同时 2 个测试，同一服务每次测试后冷却 5 秒，超出返回 429 并带 `Retry-After`；每次测试写入 Console 审计日志（`mcp.test`：操作者、服务名、结果与失败分类，不含失败消息）。注意：对 `stdio` 服务，测试会在 Agent 已有进程之外再启动一个同名命令，独占资源（锁文件、固定端口）的服务测试时可能冲突。新增导出：`@zhin.js/console-protocol` 的 `CONSOLE_MCP_TEST_PATH` / `ConsoleMcpConnectTestResult`；`@zhin.js/host-http` 的 `ConsoleAgentIntrospection.testMcp()`（Agent 不可用时返回 `'agent-unavailable'`）与 `ConsoleRestPagesOptions.mcpTestMaxConcurrent` / `mcpTestCooldownMs`；`@zhin.js/agent/runtime` 的 `HostMcpStatusBoard`（`probe()`）及相关类型，`AgentHostIntrospectionPort.testMcpServer()`。
  - `install-dry-run-dumps-whole-config`：`zhin install … --dry-run` 的配置预览改为 unified diff，只含改动的行和上下 3 行，由真正写入时（逐键补丁、保留注释与顺序）会产生的文本计算，不再重新序列化打印整份配置（此前注释几乎全部丢失，看起来像安装会抹掉注释）。
  - 安装插件时跟随项目的精确版本写法：项目 `dependencies` / `devDependencies` / `optionalDependencies` 里的 `zhin.js` / `@zhin.js/*` 注册表依赖全部是不带 `^` / `~` 等范围的精确版本（`=1.5.0` 也算精确）（`workspace:`、`link:`、`file:`、`catalog:`、`npm:` 别名、git / 路径来源与 `latest` 这类标签不参与判断；至少要有一条注册表依赖）时，`pnpm add` 加 `--save-exact`（npm `--save-exact`，yarn / bun `--exact`）。只对 npm 注册表包生效，请求本身写了范围（如 `foo@^1.2.0`）时按原样安装、不加；`--dry-run` 显示的命令同样带上。`@zhin.js/gateway/plugin-management` 新增 `projectPinsExactZhinVersions()`、`isRegistryPackageRequest()`、`installSavesExact()`。
  - 预览的 diff 也显示行尾差异：文件末尾无换行输出 `\ No newline at end of file`；只有行尾不同的单行标出 ` (CRLF)` / ` (LF)`；整个文件换了行尾时在文件头后用一行 `# line endings: CRLF -> LF` 说明。

### Patch Changes

- 81d5fda: 技能与知识库的可发现性（#1250 第 27 批）：

  - `skill-catalog-drops-triggers`：系统提示的 `## Available skills` 目录不再每条只留描述第一句的前 40 个字符。每条保留第一句、`Use when …` 句、`Triggers:` 触发词和 SKILL.md frontmatter 的 `keywords`（格式 `- name: 说明 | Use when … | Triggers: …`；单个触发词 / 关键词超过 32 字符丢弃）；截断改为整个目录共用约 4000 字符预算（单条最多 320 字符），超出时先截说明，再截 `Use when`，触发词最后截。toolSearch 编排层的技能目录（`skillsSummaryXML` / 技能注册表）用同一格式和预算，XML 里可选的 `<keywords>` 也会列出。脚手架的 `github` 技能此前在目录里只剩 `Prepare GitHub issues, pull requests,…`，「帮我写一个 PR 描述」现在能在目录里对上 `PR 描述`。
  - 公开技能的 `keywords` 命中当前消息时，在本条消息的运行时尾部加一句「建议加载技能 X」（`## Suggested skill`），只是提示，不自动激活：按关键词自动激活仍只用于 Agent 私有技能，因为公开技能是第三方说明，激活会注入正文并解锁它的工具。缓存前缀不变。为防关键词堆砌，只看每个技能前 12 个关键词、按命中的最长一个计分，忽略单字、不足 3 个字符的英文词、常见寒暄与虚词。新增 `suggestPublicSkillsForIntent()`，`buildCapabilityContext()` 新增可选参数 `intent`。
  - `knowledge-search-not-advertised`：配置了 `ai.knowledge.baseDir`、且本回合的 `knowledge_search` 对所有发送者都可用（没有权限或机器人角色限制）时，系统提示附一段知识库索引（`## Knowledge base`：文件名与一、二级标题，约 1500 字符以内，先舍二级标题再舍文件），并写明关于本机器人、本项目的问题先查知识库。索引排在稳定段末尾、scene 之前（知识库变化只让它之后的缓存失效），段上限 2000 字符；只放标题和路径，去掉 Markdown 与尖括号、逐项截断，放在 `<knowledge_index>` 里标注为数据；与检索共用缓存，目录文件变化时失效。上下文预算新增 `knowledge_index` 段（`zhin trace` 显示为「知识库索引」，网关用量统计计入固定段）。`KnowledgeIndex` 新增可选 `outline()`。
  - `knowledge_search` 的工具描述与 `query` 参数说明改写；不带空格的中文问题按字的二元组部分匹配，计分前去掉「怎么、可以、这个、一下、知道、我想……」等虚词，不会靠虚词命中无关文档。标题抽取按 CommonMark 处理围栏（闭合围栏后面只能有空白）。
  - 知识库目录视为 owner 可信内容：与 `skills/` 一样列入受保护目录，Agent 的文件写入工具写到这里每次都要真人批准。
  - 脚手架模板（`create-zhin-app`）：技能的中文触发词同时写进 `keywords`，`skill-creator` 说明了目录保留哪些部分。

- cbe2c3f: CLI 与插件作者流程（zhinjs/zhin#1250 第 32 批）：

  - `zhin packages status <插件>` 不再把框架字段 `commandNamespace`、`disabledCommands`（以及 `overrides`）报成「不支持的字段」（`missing-config`）：网关校验插件配置时和 Runtime 使用同一份带框架字段的 schema，`additionalProperties: false` 的插件也能写这些字段；Console 保存、安装 / 启用前的配置检查同样生效。`@zhin.js/runtime` 新增 `withFrameworkPluginConfigFields()`。
  - `zhin preview`：组件的渲染上下文有了 `use()` / `has()`（此前报 `context.use is not a function`）。组件可以用新的可选字段 `previewServices: [{ token, value }]` 为插件服务提供预览替身；没有替身的 token 会报「预览环境没有提供 <token>，可在组件的 previewServices 里给一个替身」。实例运行时始终使用真实服务。`@zhin.js/component` 新增类型 `ComponentPreviewService`。
  - 新增 `zhin ai account list [--json]`：列出 Host 模型账号的 id、名称、服务、引用的环境变量名（不含值）与状态。模型服务管理接口的每个错误码都有中文说明；Host 管理员传入不存在的账号 id 时返回 `account-not-found`，把服务 id 当账号 id 传入时返回 `account-id-is-service`（HTTP 404，此前为笼统的 403 `forbidden`）。
  - `zhin watch` 按进程分别显示内存：instance（`/system/status` 的同一次采样）与 gateway（经本机网关套接字读取 `gateway.instance.status`，与 Console 首页「进程与资源」同源），每个数字都标明所属进程；同一次采样中 rss 小于 heapUsed 时给出说明（部分堆内存被系统压缩或换出）。
  - `zhin schedule list`：多行内容逐行缩进，超过 2 行截断并提示用新增的 `--json` 查看完整内容。日期时间在 `LANG=en_US` 等任何系统区域下都是 `YYYY-MM-DD HH:mm:ss`（第 22 批的 `formatDateTime()`，本批补了在美国区域与其他时区下运行的测试）。
  - `zhin new --help` 说明非交互环境（CI、脚本、无 TTY）必须给出 `--type`；普通插件模板的示例子命令改为 `commands/<name>/echo/[text]`（`<name> echo <文本>`），不再是平级的 `commands/<name>-echo/[text]`。

- Updated dependencies [d216b84]
- Updated dependencies [2386370]
- Updated dependencies [a7f3a7c]
- Updated dependencies [f145963]
- Updated dependencies [19526a6]
- Updated dependencies [cbe2c3f]
- Updated dependencies [f1affdd]
  - @zhin.js/plugin-runtime@1.4.0
  - @zhin.js/console-protocol@1.6.0
  - @zhin.js/host-http@1.6.0
  - @zhin.js/scaffold-wizard@1.4.1
  - @zhin.js/runtime@1.6.0

## 1.5.0

### Minor Changes

- efa87bf: 用量统计计入「声称查过但本轮没有调用工具」（#1270）：`totals.claimsWithoutToolCall`、`byModel[].claimsWithoutToolCall`，以及 `totals.unexecutedToolNotices`；新增 `lookupClaimsOf()`，供 `zhin usage report` 复用。
- fd3800c: #1250 第 19a 批：`zhin console init` / Console 初始化向导选择与当前一致的数据库（例如默认 SQLite 下 `--database sqlite`）时不再写 `database:` 块、不再提示「切换数据库不会迁移旧库数据」、不再重启实例：`ConsoleSetupService.applyDatabase()` 返回 `changed: false`（新增 `SetupDatabaseApplyResult` 类型）。前台网关（`pnpm dev`）在 Console 未初始化时向交互终端打印带 `#token=` 的初始化链接（新增导出 `consoleSetupLink()`），令牌不写入日志文件。
- 0e6a82f: 普通插件启停热生效，不再重启实例（zhinjs/zhin#1250 `toggle-plugin-restarts-instance`，ADR 0054 修订 2026-11-15）：实例运行时 `zhin enable` / `zhin disable` 与 Console 全局开关先写 `disable_plugins`，再经控制通道 `plugins.apply` 让实例按该修订换代（退役或装配该插件实例的全部能力），实例不重启、适配器不重新登录。插件声明 `package.json#zhin.toggle: "restart"`、含原生模块、实例启动后依赖有变化、实例不支持或热应用失败时，自动回退为停止 → 启动实例（启动失败照旧恢复配置并启动原实例），结果的 `plugin.apply` / `restartReason` / `restartDetail` 与新阶段 `apply-hot` 说明生效方式和原因；Console RPC 的 `restartRequired` 只在实例确实重启时为 true；CLI 输出「已热生效，实例未重启」或重启原因。

### Patch Changes

- e7cf228: `zhin update`（网关依赖事务）在 pnpm 工作区（`pnpm-workspace.yaml` 列出了 `packages`）里以 `pnpm update -r` 运行，工作区里的本地插件随根目录一起升级（zhinjs/zhin#1250）。
- Updated dependencies [efa87bf]
- Updated dependencies [816c3f3]
- Updated dependencies [d21754f]
- Updated dependencies [92e6c1e]
- Updated dependencies [0e6a82f]
- Updated dependencies [fd3800c]
  - @zhin.js/console-protocol@1.5.0
  - @zhin.js/logger@1.3.0
  - @zhin.js/host-http@1.5.0
  - @zhin.js/runtime@1.5.0
  - @zhin.js/scaffold-wizard@1.4.0
  - @zhin.js/database@1.2.2

## 1.4.0

### Minor Changes

- 8bf8dfa: #1250 第 10 批（试用反馈、关键修复与 AI 账号）的公开 API 新增按 minor 发布：Console 协议的功能未启用状态、功能矩阵分类与传输状态文字；Host 端口校验与 owner 判定导出；网关项目标识与插件候选；Agent 运行时的连接测试与 Host 环境变量引用授权；模型请求首响应时限；`zhin ai` 命令与 `--allow-unverified-host`；日志单行转义导出；Host 根配置新增 `firstResponseTimeoutMs`，icqq 新增 `logLevel` 配置（按 commandSuggestion 先例为 minor）。

### Patch Changes

- 39db402: AI 账号与 Host 环境变量（#1250）：Console 账号可以引用 Host 环境变量（账号来源 `env://NAME`，或在设置密钥中填写 `${NAME}` / `${NAME:-}`），规则为：仅全局 owner（owner 本就能读写 `.env`），且变量名以 `_API_KEY` 结尾（避免把无关机密发往任意地址）；服务地址不限，自定义中转地址可用（其他 Console 用户与不合规的变量名返回明确中文原因 `reason`）；新增本机命令 `zhin ai account add / rename-env / test`（只经网关控制套接字，写审计，不回显值）及对应实例路由 `POST {base}/agent/inference/cli/account/add`、`/cli/account/rename-env`；新增 `POST /agent/inference/probe` 与 `/account/test` 连通性探测（带 tools 的最小请求，成功时激活凭据）。账号状态新增 `environment`（`env://` 账号无凭据时的环境变量就绪情况）与 `lastCall`（本进程最近一次真实调用结果）。`@zhin.js/host-http` 导出 `isLocalSocketPrincipal`、`isGlobalOwnerPrincipal`、`LOCAL_SOCKET_USER_ID`、`LOCAL_SOCKET_CREDENTIAL_ID`。
- 603b892: #1250 安全复核修复：配置补丁把敏感字段的值移入 `.env` 需要 `ops.env.write`，否则以 `env-write-required` 拒绝（聊天自助与 Agent 自改同样拒绝），且只更新字段自己的规范变量、绝不覆盖字段仅仅引用的其他变量；CLI 的 `/pub/health` 项目核对在探测失败时按"未验证"处理（默认拒绝，`--allow-unverified-host` 时警告后继续），本机判定覆盖 `0.0.0.0`、`::ffff:127.x`、`*.localhost` 与本机网卡地址，`hostFetch` 不再以明文 HTTP 向非回环地址发送令牌；模型连接测试（`/probe`、`/account/test`）按账号限流（每分钟 6 次，超出返回 429 与 `retryAfterMs`）。
- 760e9f5: 聊天身份的「人」模型（ADR 0060 P2）：

  - 角色授予属于「人」：新实例表 `chat_principals`、`chat_identities`（一个平台身份至多属于一个人）、`chat_principal_console_links`（Console 用户与人一对一，缓存 Console 显示名）。全局授予对一个人的全部平台身份生效；低于全局的授予只对该作用范围所属适配器上的身份生效。
  - `chat_roles` 原地新增 `principal_id` 列：首次启动为已有授予的身份各建一个人并回填（幂等），迁移前全部授予导出到 `.zhin/backups/chat-roles-<时间>.json`；过渡期双写 `adapter` / `user_id` 并保持原行 id，降级到旧版本角色不变（回滚见升级指南）。
  - 入站消息新增 Runtime 写入的只读 `sender.chatPrincipal`，适配器或插件自带的同名字段被丢弃；`ChatRoleReader.principalOf` / `holders` 返回真实的人，`subscribe` 新增 `merge` / `split` 变化，`factsOf` 返回 `chatPrincipal`。
  - 新 Console RPC：`chat-principals.list|get|merge|split|rename|link-console|unlink-console|export|import`、`chat-identities.recent|me|bind-code.create`，全部登记到权限表；新权限 `self.chat-identity`（所有内置角色默认带）。归并 / 拆分持有全局角色的人、链接 Console 用户、导出导入需要全局 `iam.manage`。`chat-roles.*` 条目新增 `grantedByName`（授予者显示名的规范字段：已链接的人名优先）与 `principalId`；1.3.0 已发布的 `grantedByDisplayName` 保留并标记为 deprecated，取值始终与 `grantedByName` 相同。
  - 聊天侧新增 `绑定 <码>`（`bind <code>`）：只接受私聊，群聊中发送的正确码立即作废，模拟适配器不接受；审计 `chat-identities.bind`、`chat-principals.merge|split|rename|link-console|unlink-console`。
  - 最近发言时间与显示名缓存保留 90 天（供选择器，不参与鉴权）。
  - CLI：`zhin chat-roles export [文件]` / `zhin chat-roles import <文件>`（经运行中实例；导入只新增或提升）。结果（含跳过的条目）写到 stdout，错误写到 stderr。
  - 网关：Console 用户被删除或禁用时若实例不在线，在实例重新就绪后补发通知，实例据此删除该用户的链接。

- 73475bd: 聊天身份安全复核（ADR 0060）：链接一个人等于拿到这个人的全局授予，因此凡是建立或扩大链接的路径，只要目标人持有角色，就必须由全局 `iam.manage` 持有者完成。

  - **绑定码**：
    - Console 用户未链接、而身份所属的人持有角色时，非全局 `iam.manage` 生成的码不再建立链接（`needs-admin`）。
    - 机器人回复写明码来自哪个 Console 账号。
    - 码在兑换时复核创建者当前的全局 `iam.manage`；网关发出任何 `principal-revoked` 时作废该用户未用的码。网关在自定义角色的权限被修改或角色被删除时，也会通知持有该角色的用户。
  - **`chat-identities.simulated.ensure`**：调用者链接的人持有全局角色时需要全局 `iam.manage`，否则拒绝（403）。
  - **`ai.personalPrincipals`**：永不自动链接到持有角色的人；首次导入之后新增或修改的条目进入「需要你处理」，经 `chat-roles.imports.resolve` 导入或忽略。`chat-roles.imports.list` 新增 `personalPending`。
  - **认领码**：
    - 日志只记哈希前缀，码只由 `zhin status` 给出。
    - 同一发送者 10 分钟内最多计 2 次错误，之后拒绝且不计数，不能反复让码轮换。
  - **归并**：任一方带 Console 链接时需要全局 `iam.manage`。
  - **非全局管理者**：看不到链接、暗示链接的 `linkMethod`、指向 Console 用户的 `createdBy` 与从链接得出的授予者名。
  - **`chat-principals.import`**：导入的授予记为导入者授予，忽略文件里的 `grantedBy`。
  - **Sandbox 发言复核**：「以我的聊天身份发言」时，若链接的人持有全局角色而 Console 用户没有全局 `iam.manage`，按模拟身份（无角色）发送，回显 `asMeUnavailable: 'needs-global-iam'`；`ChatRoleReader.consoleSpeaker` 新增可选参数 `{ canManageGlobal }`。
  - **`ai.personalPrincipals` 首次导入**：没有任何条目的项目也记录首次导入，之后加入的条目等待确认；对待确认链接的「导入」「忽略」「确认已读」均写入审计。

- 5c7f9c5: CLI 不再落到别的项目的网关上（#1250，安全）：

  - `zhin config get/set/unset/list`、`zhin send`、`zhin schedule …`、`zhin watch` 在本项目网关未运行时直接报「本项目的网关未运行（zhin start 启动；`zhin config` 还可加 `--offline`）」，不再按配置的 `http.port` 去请求 `127.0.0.1` 并带上 `ZHIN_CONSOLE_TOKEN` / `HTTP_TOKEN`——那个端口上可能是另一个正在运行的项目，原先可能改到它的配置。`zhin console init` 判断「Host 是否运行」也只看本项目网关。
  - 确需连接其他地址时显式 `--host <url>`（`zhin send`、`zhin schedule`、`zhin watch` 新增该选项；`zhin config --host`、`zhin packages … --live` 原有）。本机地址会先读对方 `GET /pub/health` 的新字段 `project.id`（`GatewayHealth.project`，项目根路径的哈希，`@zhin.js/gateway/project` 的 `projectIdentity()`），与当前项目不一致就拒绝，不发送请求和令牌；没有报告项目标识的旧版网关或 `--standalone` 实例默认同样拒绝（只发出 `/pub/health` 探测，不发送令牌，非零退出），提示升级并用 `zhin start` 启动；确认目标无误时可加新选项 `--allow-unverified-host`（`zhin config`、`zhin send`、`zhin schedule`、`zhin watch`、`zhin packages … --live` 均支持）改为警告后继续。非本机地址仍不核对。

- e2b04b7: `zhin enable` / `zhin disable`（以及 Console 的插件开关）找不到插件实例时，不再把用户输入拼成 `zhin install <输入>`（#1250）：例如 `zhin enable reminder` 原先提示 `zhin install reminder`，而 npm 上的 `reminder` 是无关的第三方包。现在只从官方目录（目录中的适配器、用途入口的插件）和项目里已安装的 `@zhin.js/*` 包中找名称相近的候选（如 `@zhin.js/plugin-reminder`）；没有候选时只说「找不到插件实例 X（配置中没有声明）」。
- 9d3f50b: 依赖事务回滚后不再让机器人停在 `stopped`（#1250）：

  - 回滚时即使恢复文件或重新安装依赖失败，只要实例原来在运行就仍尝试拉起；拉起失败单独记入新字段 `restartError`（`GatewayPackageTransactionResult`），`rollbackError` 只描述恢复文件 / 重新安装依赖。
  - pnpm 11 在依赖已安装完成、只是跳过了未放行的构建脚本时以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。网关（以及没有网关时的 `zhin install`）在确认依赖已就位（`node_modules/.modules.yaml` 存在且 `add` 的包都在）后不再把它当成安装失败，而是在结果里给出 `ignoredBuilds` 并提示用 `allowBuilds` 放行后 `pnpm rebuild`。
  - CLI 打印事务时，包管理器的原文逐行加 `│` 前缀放在对应步骤下，与「· 步骤」行分开；回滚失败时分别说明回滚错误与实例是否已重新启动。

- 11ef8ce: `zhin config set|unset` 与 Console 配置补丁的错误说明（#1250）：未知顶层键提示「没有这个配置项」并列出相近的配置项，插件声明键说明去 Console「插件」页或配置文件修改（不再出现 `gateway.plugins.declare` 等 RPC 名）；数组下标越界或该写下标处写了键名时返回 `invalid` 和中文原因（当前长度、如何追加），不再抛出英文的 `Config path … out of bounds`。CLI 只在退出码 6（结果未知）或全局 `--debug` 时在 stderr 打印 `requestId` / `expectedRevision`；校验错误的路径按 `a.b.c` 显示。
- 817b2bf: `http.port` 校验与默认端口（#1250）：

  - `http.port` / `http.listeners[].port` 只接受 1–65535 的整数，或展开后为该范围整数的 `${VAR}` 引用（`0` 保留原含义：由系统分配空闲端口，供测试与嵌入使用）。Host 配置 Schema 收紧（`integer` + `minimum`/`maximum` + 只允许整串 `${VAR}` 的 `pattern`），`zhin config set`、Console 保存与 `plugin:validate-config` 一致拒绝并给出中文原因（如「字段 port 只接受数值或 ${VAR} 形式的环境变量引用」「字段 port 不能大于 65535」）；`zhin config check` 报 `http.port_invalid` 错误（含引用展开后的值）。
  - 启动时非法端口直接报错退出，不再悄悄监听默认端口；`${PORT}` 展开得到的数字字符串现在会被正确使用（此前被忽略而回退到默认端口）。
  - **未配置 `http.port` 时的默认端口从 8086 改为 8068**，与脚手架写入、文档和 Console 链接一致（8086 常被 InfluxDB 等占用）。已在配置中写了端口的项目不受影响；依赖旧默认值的项目请显式写 `http.port: 8086`。
  - `zhin doctor` 按启动方式解析端口（展开 `.env` 中的 `${VAR}`），检查真实生效的端口；无法解析或非法时报错并给出 `zhin config set http.port 8068 --offline`，不再悄悄检查 8086。
  - 配置里的端口已损坏且网关未运行时，CLI 配置命令给出离线修复提示，而不是 `Invalid URL`；网关运行时经本地 socket 照常工作。
  - `@zhin.js/host-http` 新增导出 `DEFAULT_HTTP_PORT`、`parseHttpPort`、`describeInvalidPortValue`、`InvalidHttpPortError`、`ENVIRONMENT_REFERENCE_PATTERN`。

- 9cd764a: 敏感配置不再以明文写进配置文件（#1250）：经 `config:patch-project` / `config:patch` / `config:set`（`zhin config set` 与 Console 保存共用的 Host 写入路径）写入 Schema 标为敏感的字段（`x-zhin-secret`、`writeOnly`、`format: password`、`x-zhin-config.secret`，以及 token / 密码类键名）时，值写入项目 `.env`，配置里保留或改为 `${VAR}` 引用：沿用该字段原来引用的变量名，原来不是引用时按路径生成规范名（`http.token` → `HTTP_TOKEN`，重名加 `_2`）；`.env.<环境>` 已定义该变量时写到那里；配置写入失败时 `.env` 恢复原样。保存结果新增 `envSecrets: [{ path, variable }]`（只有变量名，从不含值）；补丁请求新增可选 `secretStorage: 'env' | 'plain'`（`ConsoleConfigPatchRequest`），`zhin config set --plain` 以明文写入并打印警告。
- Updated dependencies [39db402]
- Updated dependencies [8bf8dfa]
- Updated dependencies [603b892]
- Updated dependencies [bc31cd3]
- Updated dependencies [760e9f5]
- Updated dependencies [5d90159]
- Updated dependencies [73475bd]
- Updated dependencies [5c7f9c5]
- Updated dependencies [9d3f50b]
- Updated dependencies [35e5d89]
- Updated dependencies [48fdf0d]
- Updated dependencies [ea480f8]
- Updated dependencies [00ca418]
- Updated dependencies [e690123]
- Updated dependencies [817b2bf]
- Updated dependencies [6616d07]
- Updated dependencies [9cd764a]
- Updated dependencies [b2ed753]
  - @zhin.js/host-http@1.4.0
  - @zhin.js/console-protocol@1.4.0
  - @zhin.js/scaffold-wizard@1.3.0
  - @zhin.js/logger@1.2.0
  - @zhin.js/runtime@1.4.0
  - @zhin.js/database@1.2.1

## 1.3.0

### Minor Changes

- 0e998fd: Agent 性能与 trace 改进（#1250）：

  - 按需加载的工具在会话内只增不减：常驻工具按名称排在最前，已加载工具按首次加载顺序追加；本回合策略较窄、看不到的已加载工具仍保留在会话快照里，下一回合原样回到列表，相邻请求的 `tools` 前缀不变。超出 `maxLoadedPerSession` 时按最早加载淘汰并写日志（`touchToolInSnapshot` / `touchToolsInSnapshot` 新增可选 `onEvict`）。
  - 子 Agent（`ask` / `follow_up`）回合里工具产出的图片、音频、视频、文件作为结构化附件随回复交回提问方，并入提问方的回复经正常出站链发送，不再依赖子 Agent 正文复述 URL。只收工具产出的媒体（子 Agent 正文里的链接不算），并先用子 Agent 自己收窄后的权限判定每个附件（本地路径须通过它的文件权限）。
  - `zhin trace` 记录子 Agent 的模型调用与用量（之前显示 0 次），父回合汇总写成「合计（自身 N，子 agent M）」，新增 `subagent_usage` 字段；`ai.usage` 与用量记录同样计入且不重复计。
  - 同一次模型请求在时间线、`requests`、`model_calls` 与 `ai.usage` 里记录同一个 provider（实际解析出的服务 ID），`zhin trace` 显示服务名。
  - 每次模型调用记录请求前缀哈希（system + 工具定义，`prefix_hash`）；某服务长期没有缓存命中而相邻请求前缀相同时，Console 用量统计（`promptCacheHints`）、`zhin usage report` 与 `zhin doctor` 提示「该服务可能不支持或未透传 prompt 缓存」并给出前缀相同的比例。

- 1d1746e: Console「需要你处理」：新增只读 RPC `attention.list`（`status.view`），把待登录、离线账号、插件异常 / 配置无效、项目插件依赖未满足（整个项目一条，不再按插件重复）、配置文件无法读取（只给出项目内相对文件名、行列与错误类别，不回显解析器原文）/ 改动未生效 / 明文密钥、待审批工具调用、未连接的 MCP 服务和错误日志汇总成带深链的条目，按调用者权限逐条过滤，标题按请求的 `locale` 本地化。账号以 `endpoint.list` 行的 `adapter` + `name` 标识（与 Console 作用域路由、账号级角色绑定一致；`endpoint.list` 的账号级过滤同步改用该键。过渡期内按 canonical id 写的旧账号级绑定——`<endpoint.adapter>/<id>` 或 `<adapter>/<id>`——仍匹配同一账号，`attention.list` 同样认这两种键，不会扩大到其他账号）。插件、配置、MCP 与日志的原始读取在请求间共享（并发合并，15 秒或项目文件 / 运行代变化即失效），权限过滤仍逐个调用者进行；账号与登录任务实时读取。每个来源要么完整给出，要么列入 `unavailable`。协议导出 `ATTENTION_RPC`、`ConsoleAttentionItem` 与稳定、无碰撞的条目标识 `attentionItemId`（`<kind>:<字段>=<值>…`）；网关配置存储新增 `readLiteralSecrets()`，插件管理新增 `checkDependencies()` 与 `inspect(…, { dependencies: 'skip' })`。
- 71aa159: Console environment variables are masked by default (#1250). `env:get` now returns `{ format: 'masked', variables: [{ key, masked, hasValue, isReference? }], lines, content }` — first 2 and last 2 characters of values of at least 16 characters, everything else masked, for every key; no value, value length or line length — and never the file as written. The variables are exactly the ones dotenv reads (an unterminated quote no longer swallows the following lines); whatever follows `=` or `:` in a comment is masked. New `env:reveal { filename, key }` returns one variable as written (exactly the text dotenv reads as its value); it needs `ops.env.write` and `ops.env.read` (new `CONSOLE_RPC_ALSO_REQUIRES`; a missing second permission is audited with `detail.reason`) and is audited with the file and key name, never the value. `env:save { filename, changes }` writes only the submitted keys, keeps every other line byte for byte, refuses mask placeholders and quoted values with anything but spaces or `# comment` after the closing quote, and is refused (nothing written) when dotenv would read any unsubmitted key differently afterwards; the whole-file form must declare `mode: 'replace'` and is refused when it holds mask placeholders.

  **Breaking for older Consoles:** an older Console's environment page saves the whole file without `mode: 'replace'` (or saves back the masked text), so its env save now fails — upgrade the Console together with the Host.

- ccab2c1: Console Host 侧诊断数据修正（#1250），新字段均为可选、旧客户端不受影响：

  - `endpoint.friends` / `groups` / `channels` / `group_members`：适配器不提供该读取时不再返回 `{ error }`，而是空列表加 `status: 'unsupported'`、`capability`、`message`（协议类型 `ConsoleEndpointCapabilityUnsupported` / `ConsoleEndpointListReply`，判定函数 `isConsoleEndpointCapabilityUnsupported`）。
  - `endpoint.send_message` 失败时在 `data` 中带出 `{ code, reason, status, retryable? }`（`ConsoleSendFailure`；`reason` 为 `no_live_client` / `endpoint_offline` / `endpoint_not_found` / `target_not_found` / `policy_rejected` / `platform_rejected` / `unsupported` / `invalid_content` / `delivery_unknown` / `failed`），`error` 改为对应中文原因；Core 失败回执的消息带上失败码（`Outbound delivery failed (<code>).`）。
  - MCP 客户端记录最近一次连接失败（`auth` / `network` / `timeout` / `config` / `process_exit` / `sdk_missing` / `unknown` + 脱敏短消息 + 退出码），写入 warn 日志（`op=mcp_connect_failed`），并经 Agent introspection 与 `GET /api/introspection/mcp` 返回 `status`（`connected` / `failed` / `idle` / `not_loaded`）与 `lastError`。
  - 进程资源：`GET /api/system/status` 新增 `process`（`role: 'instance'`，与 `memory` 同一次采样）；`gateway.instance.status` 新增 `gateway`（`role: 'gateway'`，网关进程自身）。协议类型 `ConsoleProcessSample`。
  - `gateway.packages.list` 每个已安装依赖带 `kind`（`plugin` / `feature` / `library`，取自 `package.json#zhin.type`），Console 只应把 `plugin` 当插件。
  - `chat-roles.*` 条目新增 `grantedByDisplayName`：调用者本人授予的记录显示其显示名，聊天内授予、配置迁移、初始化令牌给出可读标签；其他 Console 账号不解析（实例不读取网关账号库）。

- b00725c: Console 未知 RPC 不再当作安全拒绝（zhinjs/zhin#1250）：Host 既没有处理器、也不在权限表里的 RPC 类型回 `404 { code: 'unknown_rpc' }`，不执行、不写审计（按类型去重记 debug 日志）；有处理器却漏登记权限的仍按 `unmapped` 拒绝并审计。网关未知的 `gateway.*` 同样回 `unknown_rpc`。被拒绝的审计条目在 `detail.reason` 写明原因（`not_authenticated` / `setup_required` / `unmapped_permission` / `unmapped_route` / `insufficient_permission` / `scope_denied` / `handler_denied` / `no_plugin_handler`）。新增能力查询 `GET {base}/console/capabilities`（权限 `authenticated`）：返回 `{ version, rpc, features, complete }`，网关把自己处理的 RPC 与实例的合并，实例未运行或较旧时 `complete: false`（较旧实例每个路由表只问一次）。协议导出 `CONSOLE_UNKNOWN_RPC_CODE`、`CONSOLE_DENIAL_REASONS`、`CONSOLE_CAPABILITIES_PATH`、`CONSOLE_FEATURES`、`createConsoleCapabilities` / `parseConsoleCapabilities` / `mergeConsoleCapabilities`；`authorizeConsoleRpc` 新增 `registered` 选项，Host 导出 `RUNTIME_CONSOLE_RPC_TYPES`、`isAuditedRpcDenial`、`unknownRpcLog`。
- b3ba941: Token 用量（#1250）：`plugin.root.usage-stats` 与 `zhin usage report` 按（服务, 模型）合并行，`services:<id>` 与 `accounts:<id>` 两条记录路径不再拆成两行，并给出「服务名 · 模型」显示名（RPC 行新增可选 `displayName` / `providerLabel` / `providerIds`，顶层新增 `modelLabels`）；读不到服务名时只显示模型名。两个输入总数分别标注口径（`totals.inputBasis: 'reported-all-calls'`，新增 `inputBreakdown`：首次请求估算含 `other` 与对应的真实输入）。日期 / 小时分桶按请求 `timeZone` 或实例时区（`TZ`，否则系统时区）计算，CLI 新增 `--tz`。会话显示 trace 里记录的会话名（`bySession[].displayName`、CLI `display_name`）。`zhin trace` 的模型列不再显示 `services:<uuid>/`。

### Patch Changes

- 7126d03: CLI 输出与实例错误说明（#1250）：

  - CLI 的命令结果（`zhin packages info`、`zhin search`、`zhin schedule list/add/…` 等）写到 stdout，不再带 `[时间][INFO] [CLI]` 前缀；诊断日志写到 stderr，前缀只在全局 `--verbose` 时出现。**行为变更**：CLI 的日志输出（`logger.info` / `success` / `warn` 等，包括成功与提示行）从 stdout 移到了 stderr——只捕获 stdout 的脚本不会再看到这些成功 / 提示行，需要时请同时捕获 stderr（`2>&1`），或改为解析命令结果本身。`zhin packages info` 正确读取字符串形式的 `author` 与 `maintainers`，并列出已安装包的命令、Agent 工具与配置项（静态读取约定目录与 `schema.json`）。
  - 实例 HTTP API（`/message/send`、`/assistant/jobs`）区分预期失败与意外异常：预期失败返回 `code`（`delivery_failed`、`delivery_unknown`、`endpoint_not_found`、`notify_target_missing`、`invalid_argument`、`not_found`、`unavailable`）和中文说明，发送失败的 `data` 为 `ConsoleSendFailure`；意外异常仍只返回 `Internal error`，但带日志关联 `errorId`。`zhin send` / `zhin schedule` 显示具体原因，`--debug` 显示 `errorId` 并从实例日志找出对应行。
    - **行为变更**：这些预期失败的 `error` 文本改为中文说明，且今后可能调整措辞——程序请按 `code`（以及 `data.reason`）判断，不要匹配 `error` 文本。
    - **新错误码 `delivery_unknown`**（HTTP 502）：`/message/send` 的投递结果未知（平台可能已经收到）时不再归入 `delivery_failed`，而是返回独立的顶层 `code: 'delivery_unknown'`（`data.reason: 'delivery_unknown'`、`data.status: 'unknown'`）。`delivery_failed` 表示确定未发送、可以重试；`delivery_unknown` 不应自动重试，否则可能重复发送。
    - **行为变更**：`/assistant/jobs` 收到 `notify.channel: im` 时直接以 HTTP 400（`code: 'notify_target_missing'`）拒绝——这个接口无法指定目标会话，以前会接受后在调度时才失败；请在聊天中让机器人创建需要 IM 投递的任务，或改用 `log` / `silent`。CLI 的 `--notify-channel im` 同样被拒绝。
  - 网关终端区分 node-pty「未安装」与「已安装但原生模块未构建」，后者提示在 `allowBuilds` 放行后 `pnpm rebuild node-pty`（或 `zhin migrate`）。
  - 脚手架 `knowledge/faq.md` 写明换模型的两个入口（Console「AI 与模型 → 用途」与 `ai.plan.yml`）及实际优先级；`ai.agents.zhin.model` 已不再决定模型。
  - Introspection 的命令、中间件、组件、工具、Prompt Section 条目带 `owner`、`pluginInstance`、`pluginPackage`（`ConsoleIntrospectionOwner`）。
  - 决策审计：gate 写出的 `model_skip` 在 payload 中带 `parent`（如 `ambient_decision`），回放可折叠为一条。

- 4f6b8b9: 插件配置校验信息（`zhin config set`、Console 表单）按项目 `locale` 输出完整的中文 / 英文文本：除 `type` 外，`maximum` / `minimum` / `exclusiveMaximum` / `exclusiveMinimum` / `minLength` / `maxLength` / `enum` / `const` / `pattern` / `required` / `additionalProperties` / `format` / `minItems` / `maxItems` 也已本地化，消息中写明字段路径；`additionalProperties` 的错误路径指向多出的字段。其他关键字回退为带 Ajv 原文的本地化提示（#1250）。
- 0d8da71: 热重载与文件监视（#1250）：`zhin status` 显示实例当前的 generation（网关按实例每次提交后发布的路由表更新，不再停留在启动时的 1）；文件变化事件合并 300 毫秒（`HmrCoordinator` 新选项 `watchDebounceMs`；持续写入时最迟 2 秒也会触发，`watchDebounceMaxWaitMs`），`sed -i`、编辑器原子保存、`git checkout` 等一次改动只触发一次重载，显式 `enqueue` 不受影响（并合并同一路径尚在等待的监视事件，不会重复重载）；被监视的 `package.json` 只有 `scripts`、`description` 等不影响运行时的字段变化时直接忽略（debug 日志 `manifest_change_ignored`），依赖、`pnpm.overrides` / `pnpm.packageExtensions` / `pnpm.peerDependencyRules`、`dependenciesMeta` / `peerDependenciesMeta`、`engines`、`zhin`、`exports` / `main` / `type` 等字段变化仍按原路径处理，已挂载子插件包的 `version` 变化也会重载（插件树记录 `packageVersion`，网关据此判断 schema 漂移与发布状态；根项目自身的 `version` 仍忽略），重载失败时字段比较基线回退，下次仍能识别同一改动，需要重启时先记 `instance_restart | reason: manifest_changed | file | fields`（其他重启原因同样有结构化记录）；`hmr_reload` 新增 `rebuilt`（实际重建范围 root / subtree / capability）与 `rebuilt_plugins`（重新 setup 的插件，含适配器），实际退化为整棵 Root 重建时另记 warn `hmr_full_rebuild` 说明原因。重载范围算法本身不变。
- 19ff36c: `zhin use-cases`：RSS 订阅与管理员提醒的步骤不再提不存在的「任务中心」，改为 Console「运维 → 定时任务 → 管理员任务」（英文 Operations → Scheduled tasks → Administrator tasks）。（#1250）
- Updated dependencies [b3ba941]
- Updated dependencies [5232fd8]
- Updated dependencies [8c92bda]
- Updated dependencies [0e998fd]
- Updated dependencies [8609906]
- Updated dependencies [7126d03]
- Updated dependencies [9026329]
- Updated dependencies [1d1746e]
- Updated dependencies [e6d7cc1]
- Updated dependencies [71aa159]
- Updated dependencies [ccab2c1]
- Updated dependencies [b00725c]
- Updated dependencies [c6b5563]
- Updated dependencies [f1a9745]
- Updated dependencies [e0b4e51]
- Updated dependencies [7cc703a]
- Updated dependencies [0d8da71]
- Updated dependencies [627fb5e]
- Updated dependencies [70ddaf4]
- Updated dependencies [dbdfca3]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
- Updated dependencies [f3910f1]
  - @zhin.js/host-http@1.3.0
  - @zhin.js/runtime@1.3.0
  - @zhin.js/console-protocol@1.3.0
  - @zhin.js/scaffold-wizard@1.2.0
  - @zhin.js/plugin-runtime@1.3.0

## 1.2.0

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

- a86bdc7: 功能覆盖迁入数据库（ADR 0057 §2）：

  - 适配器 / 账号 / 会话三级功能覆盖统一存在项目数据库表 `feature_overrides`（`level` 列为 `adapter` / `endpoint` / `conversation`，主键由 `(plugin, level, key)` 生成）；旧表 `feature_conversation_overrides` 的行首次加载时复制过来，旧表保留只读。全局默认值仍是配置文件里的插件块，全局开关仍是 `disable_plugins`。
  - `configFor` / `isEnabledFor`、分发门禁与 Console `feature.*` 从数据库读取适配器 / 账号级覆盖，合并顺序与锁定规则不变；Console 与聊天「功能 设置 / 开启 / 关闭」的适配器 / 账号级写入改写数据库，立即生效、不再改写配置文件。新增 `readStoredFeatureOverrides`、`validateStoredFeatureOverride`。
  - 首次启动自动迁移：把配置文件里各插件块的 `overrides` 导入数据库，成功后备份原文件到 `.zhin/backups/` 并原子删除这些块，记录写入 `.zhin/migrations/feature-overrides.json`；失败时配置文件不变、下次启动重试。迁移完成后配置文件再出现 `overrides` 会在启动与配置更新时被拒绝。
  - MongoDB / Redis / memory 方言下拒绝覆盖写入（503 `feature-overrides-unpersisted`），会话级也不再只存内存。
  - `feature.*` 请求与响应形状不变；适配器 / 账号级的 `revision` 改为数据库行的修订号，仍兼容旧版 Console 传入的当前配置修订号。

- Updated dependencies [f74b4a5]
- Updated dependencies [f28d8b9]
- Updated dependencies [a86bdc7]
- Updated dependencies [ce8edf5]
- Updated dependencies [f2fa3d7]
- Updated dependencies [eba2566]
- Updated dependencies [ac72706]
- Updated dependencies [8f237bd]
- Updated dependencies [b2aae3c]
- Updated dependencies [3c14aeb]
- Updated dependencies [cdf04b2]
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/host-http@1.2.2
  - @zhin.js/console-protocol@1.2.2
  - @zhin.js/database@1.2.0
  - @zhin.js/runtime@1.2.2
  - @zhin.js/scaffold-wizard@1.1.21

## 1.1.2

### Patch Changes

- cfa3dbf: 新增 `zhin enable <plugin>` / `zhin disable <plugin>`：把已安装并已声明的插件实例移出或加入 `disable_plugins`（实例键，或只声明一次的包名）。网关运行时经新的 `gateway.plugins.enable` / `gateway.plugins.disable`（`plugin.manage`）执行只写配置的事务：停实例、写配置、启实例，启动失败时恢复配置并启动旧实例；网关未运行时直接写配置，下次 `zhin start` 生效。已是目标状态时成功且不改动；未声明、保留键、项目根插件，以及启用时包未安装、依赖无法解析或配置不通过插件 Schema 时报错（退出码 1）。`PluginManagementWorkflow` 新增 `planSetEnabled` / `setEnabled`；事务结果新增 `plugin` 字段，包来源新增 `local`（本地插件只限所有者启停）。
- fa22d4b: 配置存放规则落地（ADR 0057 第 1 步）：声明放 `zhin.config.yml`，运行时状态放数据库，密钥放 `.env`。

  - 密钥字段统一由 `@zhin.js/runtime` 的 `isSecretConfigKey` / `isSecretConfigSchema` 判定：Schema 标注 `x-zhin-secret: true`（主机 Schema 的 `http.token`、`database.password`、`mcp.token`、`a2a.token` 等已标注，`Schema.string().secret()` 同时输出该标注，Ajv 将其登记为注解关键字），没有标注时按字段名兜底（`token`、`password`、`secret`、`apiKey`、`privateKey`、`*Token` 等）。网关的配置脱敏、聊天配置策略、Console 表单与配置说明共用这一判定。
  - 实例启动（`zhin start` 与 `--standalone`）发现密钥字段是字面值而不是 `${…}` 引用时打一条警告，只列路径不打印值，提示运行 `zhin doctor --fix`。
  - `zhin doctor` 报告明文密钥；`zhin doctor --fix` 把字面值写进 `.env`（`ZHIN_<路径大写下划线>`，相同值复用，名字被其他值占用时追加 `_2`），并把配置值换成 `${变量名}`；配置经配置文件事务写入。
  - `.env` 改为加锁原子写（临时文件 + fsync + rename），保留原文件权限，新文件为 `0600`；网关 Console、`zhin console init`、`zhin doctor` 与脚手架向导都使用同一个写入函数。YAML/JSON 配置的原子替换同样会 fsync。

- 7fb1ee7: Console 的插件全局开关改由管理网关作为启停事务执行（ADR 0054 §4）：网关在转发前拦截 `plugin:set-enabled` 与 `level: 'global'` 的 `feature.set-enabled`，按 `plugin.manage` 授权，执行与 `gateway.plugins.enable` / `disable` 相同的事务（停实例 → 写 `disable_plugins` → 启实例，失败回滚），并用两者原有的回复形状作答（另带 `transaction`；失败时为 `transaction_failed` / `rollback_failed` 错误信封）；成功变更后在事件流补发 `plugin:lifecycle-updated`。权限表中 `plugin:set-enabled` 改为 `plugin.manage`，`feature.set-enabled` 的全局层细化为 `plugin.manage`（其余层仍是 `feature.toggle`），新增 `isGlobalFeatureSwitch` / `FEATURE_GLOBAL_SWITCH_PERMISSION`。实例不再写全局开关：`plugin:set-enabled` 与 Console 路径上的全局 `feature.set-enabled`（409 `gateway-required`）一律拒绝，`--standalone` 下请用 `zhin enable` / `zhin disable`；`RuntimeConsoleRpcContext.setPluginEnabled` 已移除。`@zhin.js/client` 的 `setPluginEnabled` 改用依赖事务的可续期超时。聊天命令的全局开关暂不变。
- ab49bbe: 插件包可以省略 `plugin.ts`：`type: "plugin"` 的清单既不写 `zhin.entry` 也不写 `exports["./zhin"]` 时，清单记录为无入口，运行时（普通与隔离加载路径）按 `definePlugin({ name: <去掉 scope 的包名> })` 装配，约定目录照常从包根目录发现。包名去掉 scope 后不符合 `/^[a-z][a-z0-9-]*$/` 时启动报错并提示添加带显式 `name` 的 `plugin.ts`。Feature 包仍必须声明入口，已声明但不存在的入口仍然报错。`zhin plugin check`、`check:plugin` 与网关插件安装检查接受无入口插件；`zhin plugin check` 对存在 `plugin.ts` 却未声明入口的情况给出警告。`@zhin.js/testing` 的测试应用根仍需声明入口（用于挂载测试端点），缺失时给出明确错误。

  `package.json#zhin.features` 可以省略：省略时运行时按包根目录下存在的约定目录（`commands/` → `@zhin.js/command`、`tools/` → `@zhin.js/tool` 等，映射表 `CONVENTION_FEATURE_PACKAGES` 由 `@zhin.js/runtime` 统一导出）推断要挂载的 Feature 包；推断出的引用不带 `api` 范围，找不到时报与显式声明缺失相同的 `PackageResolutionError` 并写明是哪个目录推断出来的。写了 `features`（包括 `[]`）的插件不做推断，行为不变；隔离插件不推断；Root 继承的 Stable Features 优先。最小插件清单为 `"zhin": { "protocol": 1, "type": "plugin" }`。`zhin plugin check` 要求推断出的 Feature 已声明为依赖，`zhin create` 在省略 `features` 时不再写出 `features` 列表，网关卸载检查与仓库依赖检查同样计入推断出的 Feature。

- Updated dependencies [cfa3dbf]
- Updated dependencies [fa22d4b]
- Updated dependencies [7fb1ee7]
- Updated dependencies [ab49bbe]
  - @zhin.js/console-protocol@1.2.1
  - @zhin.js/runtime@1.2.1
  - @zhin.js/scaffold-wizard@1.1.20
  - @zhin.js/host-http@1.2.1

## 1.1.1

### Patch Changes

- 1a5c569: 安装缺少必填配置的插件（如需要账号的适配器）时只安装依赖、不声明，结果报告 `needsConfiguration`（缺少的字段与环境变量），事务不再回滚；新增 `gateway.plugins.declare`（`plugin.manage`，按插件 Schema 校验、原子写入声明与配置、重启实例、失败回滚配置）。回滚日志尾部只含本次事务期间的实例输出。`zhin install` / `zhin setup` 对需要先配置的插件给出提示；经网关安装时显示网关阶段输出，不再打印本地 pnpm 命令行。
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
- 5120367: `schema:get` 支持按包名读取已安装但未声明插件的 Schema（返回 `declared: false`；以最新配置复核，经本地路径或别名已声明同一包的视为已声明）；`gateway.plugins.declare` 校验失败时返回结构化 `errors`（`path` / `message`）与 `missingEnv`，事务内复核失败时同样写入事务结果，提示文字保持不变。`@zhin.js/client` 的 `ConsoleTransportError` 新增 `details`（`serverCode`、`errors`、`missingEnv`）。
- 4e8ba38: `zhin runtime start` 经网关对外服务（ADR 0054 §1 / §3）

  - cli：`zhin runtime start` / `pnpm dev` 的监管进程同时启动网关 HTTP 服务器，监听配置的 `http.port`（含额外端口），经实例传输把请求转发给受监管的实例；不再需要 `--standalone` 就能访问 Console 与 Webhook。
  - gateway：新增子路径 `@zhin.js/gateway/server`（`GatewayHttpServer`、`startGateway`、`runGateway`）；`@zhin.js/gateway/http` 只保留响应工具，实例导入它时不会加载 Node HTTP 栈。网关改用 `@zhin.js/host-http/bridge` 的传输类型，转发失败按错误码映射：实例离线 `503 instance_unavailable`（带 `state`、`Retry-After`）、超时 `504 instance_timeout`、其他 `502 instance_error`。`POST {base}/console/request` 中的 `gateway.*` RPC 由网关处理（载荷在 `data`），其他类型原样转发给实例。经 Console 停止实例或依赖事务进行中，监管进程不会因实例停止而退出。
  - host-http：桥接协议新增过渡消息 `auth.authenticate` / `auth.result` / `auth.state` / `auth.audit`——Console 账号迁到网关（B1.4）之前，由实例解析用户会话与 API 令牌、上报是否已有所有者，网关侧审计写入实例；`createDelegatedAccessProvider` 把它装成网关 TokenRegistry 的访问提供者（未收到上报前按“已有所有者”处理）。没有所有者且未配置 `http.token` 时，网关转发 `{ kind: 'bootstrap', open: true }`。

- cc7a5f9: Console 访问控制迁到网关（ADR 0054 §3 / §7，B1.4）

  - gateway：网关自己打开项目数据库（新子路径 `@zhin.js/gateway/database`，按实例同一规则解析 `database`；SQLite 为 WAL，网关连接遇忙时异步退避重试（5 秒，不使用同步 busy*timeout），超时返回 `503 database_busy` 与 Retry-After，写入都是单语句自动提交），持有 `console*_` 表，本地认证会话、API 令牌与初始化令牌；`{base}/auth/_`、`iam.\*`、`onboarding.update`、初始化向导（切换数据库后网关重连并重启实例）、终端与审计都挂在网关上，没有实例时也能登录与初始化。数据库连接或重连期间按初始化标记失败即关闭。网关运行时另一个进程（`zhin console init`）创建了所有者，网关按初始化标记立即关闭开放 Host 并重读所有者状态，不再等 30 秒的定时刷新。网关接管 `{base}/events`（合并 `gateway.packages.progress`，实例离线时只含网关事件）与 `{base}/gateway/packages/progress`。
  - host-http：桥接协议升到 3：删除过渡消息 `auth.*`；实例上报插件权限目录（`catalog`）与审计条目（`audit`），网关下发 `principal-revoked`，实例关闭该用户的 SSE 与 WebSocket。
  - console-protocol：新增 `GATEWAY_PACKAGES_PROGRESS_PATH`，网关事件说明更新。
  - database：SQLite 文件库总是开启 WAL，新增 `busyTimeoutMs`；未设置同步等待的连接（实例）对事务外语句与 `BEGIN IMMEDIATE` 遇到 `SQLITE_BUSY` 时做有界的异步退避重试（默认 5 秒，`busyRetryMs`），事务默认 `BEGIN IMMEDIATE`，声明 `readOnly` 的事务用 `BEGIN DEFERRED` + `query_only`，网关短暂持有写锁时实例写入不再报错。
  - zhin.js：受监管实例不再安装 Console 账号与终端，只对网关转发的主体授权（`--standalone` 照旧自带）。
  - mcp / a2a：配合实例不再持有 Console 令牌注册表。
  - cli：`zhin console` 经网关模块打开项目数据库。

- 518cd79: 网关 SQLite 连接改为异步遇忙重试（不再用同步 busy_timeout 阻塞事件循环），超时返回 `503 database_busy` 与 Retry-After，认证簿记写入遇忙跳过；事务新增 `readOnly` 选项（SQLite 以 `BEGIN DEFERRED` + `query_only` 开启，不拿写锁）。网关运行时 `zhin console init` / `zhin console user` 经本地套接字由网关自身的初始化与账号服务执行（切换数据库由网关重连并重启实例，所有者状态立即生效），`zhin setup --install` 经 `gateway.packages.install` 安装并显示进度；无网关时保持直连。
- 4e8ba38: 网关 HTTP 服务器（ADR 0054 §2 / §3，B1.3）

  - gateway：`GatewayHttpServer`——项目唯一的监听者（主端口 + `http.listeners` 额外端口 / TLS），网关自有路由优先，`{base}` 请求在网关认证后连同主体转发，其他路由（Webhook、反向 WebSocket）原样转发；实例未就绪时返回 `503 { code: 'instance_unavailable', state }` 与 `Retry-After`，网关自有路由与 `/pub/health` 不受影响；`startGateway` 组合服务器、实例监管与实例传输。
  - host-http：`@zhin.js/host-http/node` 新增 `createNodeHttpListener`（Node 请求 ↔ `Request` / `Response`、`ws` ↔ `WsConnection`）；路由器新增 `builtinRoutes` 选项；WebSocket 升级拒绝可带状态码与响应头；CORS 暴露 `Retry-After`（跨域 Console 能读到登录限速与实例离线的等待时长）。

- cc7a5f9: 常驻网关与 `zhin start` / `stop` / `restart` / `status` / `logs`（ADR 0054 §5 / §6，B1.6）

  - gateway：`runGateway` 移到 `@zhin.js/gateway/server` 的独立模块；实例崩溃、风暴保护进入 `crashed` 或经 RPC 停止时网关照常运行，只在 SIGINT / SIGTERM、`gateway.shutdown` 或 `--once` 时结束。实例输出总是写入 `.zhin/logs/instance.log`，前台运行时同时回显。新子路径 `@zhin.js/gateway/local`：本地控制套接字 `.zhin/gateway.sock`（Windows 为命名管道，仅当前用户可连接），清理残留套接字、拒绝第二个网关，JSON 行协议（主体 `local`，另有 `gateway.info` / `gateway.shutdown` 与依赖事务进度流），状态文件 `.zhin/gateway.json` 与 CLI 客户端。
  - console-protocol：`gateway.packages.uninstall` 新增 `removeDependency`。
  - cli：`zhin start` 默认后台运行，`--foreground` 前台运行；新增 `zhin stop`、`restart [--gateway]`、`status [--json]`（未运行时退出码 3）、`logs [-f] [-n]`、`update`；网关运行时 `install` / `uninstall` 经网关执行。`zhin runtime start` 保留为前台别名。
  - zhin.js：提示改为 `zhin start`；网关前台运行时实例按交互终端输出。
  - runtime / scaffold-wizard / create-zhin-app：脚本与服务模板（systemd、Docker、PM2）改用 `zhin start --foreground`，README 附 Console 链接。

- f8bf684: 插件的安装、更新、卸载只走网关依赖事务 `gateway.packages.install | update | uninstall`（先停实例、失败回滚、需要配置的插件只装不声明）。删除实例内直接运行包管理器的 `plugin:install` / `plugin:update` / `plugin:uninstall` RPC 及其权限登记（`PLUGIN_RPC.INSTALL|UPDATE|UNINSTALL` 不再导出），实例只保留只读的 `plugin:plan-*`。`@zhin.js/client` 的 `installPlugin(packages, request?, options?)` / `updatePlugin(name, version, request?, options?)` / `uninstallPlugin(packages, request?, options?)` 改为调用网关 RPC，返回 `GatewayPackageTransactionResult`（`ok`、`status`、`needsConfiguration`、`errors`、`missingEnv`、`logTail`），不再接受 `expectedRevision`；新增 `planPackages()`（`gateway.packages.plan`），包事务默认超时改为 300 秒。

  网关转发失败的响应统一为 `GatewayInstanceErrorReply`：`503 instance_unavailable`（带 `Retry-After`）、`504 instance_timeout`、`502 instance_error`，都带 `requestOutcome`（`not-dispatched` / `unknown`）与实例 `state`；`GET /pub/health`（`GatewayHealth`）不缓存，可供 Console 在实例离线时轮询。

- 9f4b996: 拆包（ADR 0054 §0）：新增管理网关包 `@zhin.js/gateway`，承载 Console 账号与权限、终端、项目配置与 `.env`、依赖事务与实例监管，不依赖 zhin.js 与 IM 层；实例装配根迁到 `zhin.js/instance`（另有 `zhin.js/instance/cli`）；`@zhin.js/cli` 不再依赖 IM 层，`zhin runtime start` 等命令按项目解析 `zhin.js/instance`。迁移：原先从 `@zhin.js/cli` 导入的 `runStartCommand` / `RootHost` 改从 `zhin.js/instance` 导入。
- 4e8ba38: 依赖事务与网关 RPC（ADR 0054 §4 / §5，B1.5）

  - gateway：`GatewayPackageService`——`gateway.packages.list | plan | install | uninstall | update` 复用插件管理事务：停实例 → 执行包管理器 → 起实例并等待稳定 → 失败时恢复 `package.json` / 锁文件 / 配置、重新安装、启动旧版本，并报告失败阶段与日志尾部；进度可订阅（`subscribe()`）；`dispatchGatewayRpc` 统一检查权限并分发 `gateway.packages.*` 与 `gateway.instance.*`；Windows 下包管理器经 `.cmd` 解析启动。
  - console-protocol：新增 `gateway.*` RPC 契约（请求 / 结果类型、`GATEWAY_RPC_PERMISSIONS`、`gateway.packages.progress`），并并入 `CONSOLE_RPC_PERMISSIONS`。

- e0bc008: 管理网关审查修复：

  - `zhin migrate`：旧的 `"start": "zhin start"`（或 `--daemon`）会改写为前台的 `zhin start --foreground --mode production --no-watch`——`zhin start` 现在默认后台，容器 / PM2 / systemd 会立即退出；迁移校验要求 `start` 带 `--foreground` 或使用 `zhin runtime start`。新增的 `@zhin.js/gateway` 版本按项目 CLI 的发布线推导（CLI 锁在旧发布线时用 `~主.次.0`），`^0.0.0` 占位不再被说成「dependencies 已声明」。
  - 本地控制套接字：`gateway.http.request` 走与 HTTP 相同的路由表（网关自有路由可达，`http.base: /` 正常），只取路径与查询，拒绝含 `\` 的路径与带 body 的 GET，事件流返回「改用 HTTP」；设置了 `ZHIN_CONSOLE_TOKEN` 时由网关按该令牌认证并以其主体执行与审计，`http.token` 不再经套接字发送。大小上限按 JSON 编码后的 UTF-8 字节计（中文不再触发协议错误），超限提示改用 HTTP。Windows 命名管道每次启动带随机名，CLI 校验 `.zhin/gateway.json` 中密钥的握手 HMAC。网关把实际端点（含 `os.tmpdir()` 回退路径）通过 `ZHIN_GATEWAY_SOCKET` 告诉实例，Agent 文件工具与 `bash` 拒绝触及它。
  - 开放 Host：地址未知的请求不再算本机（进程内调用需显式 `inProcess`）；`http.host` 非回环且既无 `http.token` 也无所有者时，网关拒绝启动并提示设置 `HTTP_TOKEN` 或 `zhin console init`。
  - `zhin doctor`：`HTTP_TOKEN` 按行读取（空值不再吞掉下一行），`change-me`、`zhin-local-token` 等弱值告警并可 `--fix` 替换，写入后 `.env` 为 `0600`。
  - `zhin console init`：先校验所有者用户名与密码，再切换数据库、写 `.env`。
  - 前台网关只在自己是终端前台作业时把标准输入交给实例，实例退出 / 崩溃后恢复终端设置；登录辅助提示改为整行输出，不再卡在按行转发里。
  - `gateway.readyTimeout` 在每次启动、重启实例与每笔依赖事务前重新读取，修改后无需重启网关。
  - Console 客户端：依赖事务回滚（`ok: false`）时安装 / 卸载 / 更新 hook 设置 `error`；事务请求的超时随 `gateway.packages.progress` 事件续期，实例启动阶段放宽到最长就绪等待，仍超时则报「结果未知，请核对」。

- 5cd9d3d: HTTP 路由契约改为 Web 标准 `Request` / `Response`（ADR 0054 §2，B1.0）

  - host-http-contract：路由处理函数签名改为 `(request, context) => Response`，`context` 提供 `url`、`params`、`principal`、`remoteAddress`；新增 `readBodyBytes` / `readTextBody` / `readJsonBody`（带大小上限，超限先读完再报 413）、`jsonResponse` / `emptyResponse`、带背压的 `createResponseStream`（SSE、大文件下载）与 `WsConnection`。契约不再引用 `node:http` / `ws`。
  - host-http：Node 服务器移到 `@zhin.js/host-http/node`（`createHttpHost`），负责 Node 请求与 `Request` / `Response` 的互转；认证结果经 `context.principal` 传给路由，删除旧的按请求取主体的辅助函数；未预期的异常只返回通用错误信息，细节写日志。
  - runtime、mcp、a2a、gateway、zhin.js、calendar 插件与各适配器的 Webhook / 反向 WebSocket 路由迁移到新契约，行为不变。

- 5cd9d3d: 实例监管改为 IPC 控制通道，删除退出码 75 重启路径（ADR 0054 §3，B1.1）

  - host-http：新增 `@zhin.js/host-http/bridge`，定义控制通道协议（`ready`、`restart-request`、`shutdown`，带协议版本）与实例侧 `openInstanceControlChannel`；只有网关启动的子进程（带 `ZHIN_RUNTIME_CHILD` 标记）才打开控制通道，测试框架或进程管理器建立的 IPC 通道不会被误当作网关。
  - gateway：`InstanceSupervisor` 取代 `NativeTypeScriptSupervisor`——advanced 序列化 IPC、`ready` 握手与版本校验、先优雅停止再 SIGTERM / SIGKILL、按请求重启、崩溃退避与重启风暴保护；`InstanceLogCollector` 采集实例日志（内存环形缓冲 + 按大小轮转的 `.zhin/logs/instance.log`）；`zhin runtime start` 经 `runSupervisedInstance` 启动。删除 `planRespawn`、`processRestartExitCode`、`ZHIN_SUPERVISOR_PID` 与孤儿看门狗（网关包尚未发布，删除不算破坏性变更）。
  - zhin.js：实例启动完成后发 `ready`，收到 `shutdown` 时停止，重启（Console、聊天、依赖变更、自我变更）改为向网关发 `restart-request`；网关断开时实例自行停止，不再残留进程；未受监管时的重启请求只停止实例、不强制退出进程（嵌入方可通过 `exit` 选项接管退出）。
  - cli / runtime / agent：相应更新启动参数、自我变更生效与文档说明。

- 518cd79: README 更新为 `zhin start` 网关启动模型与 Console 初始化流程（修正 zhin.js README 中的端口为 8068），新增网关升级指南链接。
- 5cd9d3d: 引导服务核心（ADR 0053，B2）

  - gateway：新增 `@zhin.js/gateway/onboarding`——引导状态（`.zhin/onboarding.json`，原子写入，自动识别已配置的数据库、适配器、AI 与所有者）、`OnboardingService`（`status` / `markStep` / `complete`）、按 scaffold-wizard 目录生成的安装白名单、`authorizeInstall`（无所有者时只允许装数据库驱动，之后需要 `plugin.manage`；包名 / 版本 / dist-tag 严格校验），以及经依赖事务安装、流式输出事件、失败回滚。
  - cli：`zhin setup` 新增非交互参数 `--adapter`（可重复）、`--enable-ai`、`--skip-ai`、`--skip-adapters`、`--install`、`-y`，记录引导步骤并与 Console 走同一安装服务；`zhin console init` 记录第 1–2 步。
  - scaffold-wizard / create-zhin-app：共用 `buildDefaultAdapterSetup`；可以只启用 AI 而暂不配置模型 Provider。

- f8bf684: 开放 Host（未设 `http.token` 且尚未创建所有者）只接受回环地址、且不带 `X-Forwarded-For` / `Forwarded` 的请求；其他来源按未登录处理。此前把 Host 绑定到 `0.0.0.0` 又不设令牌时，文件、`.env`、数据库与插件安装会对整个网络开放。
- 5cd9d3d: 插件权限按级别授予内置角色，插件 Console RPC 按方法鉴权（ADR 0049 修订）

  - console-protocol：插件权限（`<plugin>:<action>`）分为 read / operate / manage 三级，可在 `definePluginConsoleRpc({ permissions })` 声明，未声明时按后缀推断；新增目录权限 `plugin.perms.read|operate|manage`：viewer 得到 read，operator 得到 read + operate，admin 与 owner 得到全部。
  - gateway / host-http：自定义角色与 API 令牌可以写入插件权限；`iam.roles.list` 返回各角色实际生效的插件权限与当前运行时的插件权限目录（`pluginPermissions`）；`/auth/me` 按已加载插件展开级别授予。
  - zhin.js：已登录用户与 API 令牌调用 `plugin.<id>.<method>` 时，按方法自身、所属页面或目录兜底权限逐一检查（此前只检查 `feature.view` / `feature.configure`，operator 可以审批 `ops:approve` 操作）；门禁放行但无插件分发器应答的请求一律拒绝并记审计。
  - adapter：账号类方法的授权目标与处理函数选择账号的方式一致（`consoleAccountTarget`，先看 `data.instanceId`），`id` / `instanceId` 不一致或放在 `data` 之外时拒绝，避免按一个账号授权、却操作另一个账号；适配器 / 账号作用域的绑定可满足目录与插件权限。
  - plugin-runtime：`definePluginConsoleRpc` 支持声明权限级别。
  - rss / reminder / ledger / calendar / qrcode / short-url：补充权限级别声明（写操作为 operate 级）。

- 1e54b1e: 安全加固：实例侧数据库宿主（Console 数据库页、原始 SQL、模型定义与事务）拒绝访问网关的 `console_*` 表，独立模式改用仅根可用的 `gatewayTableHost()`；Agent 文件工具把 SQLite 数据库文件视为敏感文件。SSH 终端目标必须配置 `hostFingerprint`，只有显式 `insecureAcceptAnyHostKey: true` 才跳过校验并在 Console 标为不安全。新增 `http.trustProxy`（受信任代理时从 `X-Forwarded-For` / `Forwarded` 推导客户端地址，用于限速、审计、协议鉴权与桥接）；带转发头的请求不再算本机连接（未配 `access_token` 的反向 WebSocket、MCP / A2A 本机免鉴权一律拒绝）。
- a7c31a6: Console 终端：在 Shell 就绪前收到的输入（票据校验、PTY / SSH 启动期间）不再丢弃，就绪后按顺序回放，排队上限 1 MiB；对端在启动前离开时丢弃排队内容。
- Updated dependencies [1a5c569]
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [4e8ba38]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
- Updated dependencies [f8bf684]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [c2bbdcf]
- Updated dependencies [63595fc]
- Updated dependencies [5120367]
- Updated dependencies [fd22375]
- Updated dependencies [4e8ba38]
- Updated dependencies [cc7a5f9]
- Updated dependencies [518cd79]
- Updated dependencies [4e8ba38]
- Updated dependencies [cc7a5f9]
- Updated dependencies [f8bf684]
- Updated dependencies [4e8ba38]
- Updated dependencies [e0bc008]
- Updated dependencies [3fcfc0e]
- Updated dependencies [5cd9d3d]
- Updated dependencies [5cd9d3d]
- Updated dependencies [e0f857e]
- Updated dependencies [c2bbdcf]
- Updated dependencies [5cd9d3d]
- Updated dependencies [f8bf684]
- Updated dependencies [5cd9d3d]
- Updated dependencies [0e35afd]
- Updated dependencies [f8bf684]
- Updated dependencies [1e54b1e]
  - @zhin.js/console-protocol@1.2.0
  - @zhin.js/logger@1.1.3
  - @zhin.js/host-http@1.2.0
  - @zhin.js/scaffold-wizard@1.1.19
  - @zhin.js/database@1.1.8
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/runtime@1.2.0
