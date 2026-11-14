# zhin.js

## 1.3.0

### Minor Changes

- 8c92bda: Console「需要你处理」评审修复：`attention.list` 新增 `unavailableDetails: { source, reason }[]`（与 `unavailable` 同序；`reason` 为脱敏后的简短原因，不含绝对路径或凭据；旧字段 `unavailable: string[]` 保留），并按来源限频写 warn 日志；单个插件 `inspect` 失败时只为该插件生成 `plugin.error` 条目（带原因，如提示运行 `zhin migrate instances`），其余插件照常出条目，所有插件因同一原因失败（如旧版生命周期状态）时合并为一条项目级条目；离线账号条目的连接状态改为可读说法（已连接 / 连接中 / 已断开 / 重连中…，未知值显示「未知」），工具审批条目不再在文案中显示内部会话 key，改为来源会话的描述（群 / 频道 / 私聊），无法解析时写「一个会话」。
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

- 1d1746e: Console「需要你处理」：新增只读 RPC `attention.list`（`status.view`），把待登录、离线账号、插件异常 / 配置无效、项目插件依赖未满足（整个项目一条，不再按插件重复）、配置文件无法读取（只给出项目内相对文件名、行列与错误类别，不回显解析器原文）/ 改动未生效 / 明文密钥、待审批工具调用、未连接的 MCP 服务和错误日志汇总成带深链的条目，按调用者权限逐条过滤，标题按请求的 `locale` 本地化。账号以 `endpoint.list` 行的 `adapter` + `name` 标识（与 Console 作用域路由、账号级角色绑定一致；`endpoint.list` 的账号级过滤同步改用该键。过渡期内按 canonical id 写的旧账号级绑定——`<endpoint.adapter>/<id>` 或 `<adapter>/<id>`——仍匹配同一账号，`attention.list` 同样认这两种键，不会扩大到其他账号）。插件、配置、MCP 与日志的原始读取在请求间共享（并发合并，15 秒或项目文件 / 运行代变化即失效），权限过滤仍逐个调用者进行；账号与登录任务实时读取。每个来源要么完整给出，要么列入 `unavailable`。协议导出 `ATTENTION_RPC`、`ConsoleAttentionItem` 与稳定、无碰撞的条目标识 `attentionItemId`（`<kind>:<字段>=<值>…`）；网关配置存储新增 `readLiteralSecrets()`，插件管理新增 `checkDependencies()` 与 `inspect(…, { dependencies: 'skip' })`。
- 71aa159: Console environment variables are masked by default (#1250). `env:get` now returns `{ format: 'masked', variables: [{ key, masked, hasValue, isReference? }], lines, content }` — first 2 and last 2 characters of values of at least 16 characters, everything else masked, for every key; no value, value length or line length — and never the file as written. The variables are exactly the ones dotenv reads (an unterminated quote no longer swallows the following lines); whatever follows `=` or `:` in a comment is masked. New `env:reveal { filename, key }` returns one variable as written (exactly the text dotenv reads as its value); it needs `ops.env.write` and `ops.env.read` (new `CONSOLE_RPC_ALSO_REQUIRES`; a missing second permission is audited with `detail.reason`) and is audited with the file and key name, never the value. `env:save { filename, changes }` writes only the submitted keys, keeps every other line byte for byte, refuses mask placeholders and quoted values with anything but spaces or `# comment` after the closing quote, and is refused (nothing written) when dotenv would read any unsubmitted key differently afterwards; the whole-file form must declare `mode: 'replace'` and is refused when it holds mask placeholders.

  **Breaking for older Consoles:** an older Console's environment page saves the whole file without `mode: 'replace'` (or saves back the masked text), so its env save now fails — upgrade the Console together with the Host.

- c6b5563: `zhin.config.yml` 的 `<适配器>.endpoints` 与已保存账号不一致时给出提示并可显式处理（#1250）。`endpoints` 只在还没有账号快照时作为首次种子，之后以数据库中的加密账号文档为准；此前在 yml 里增删账号既不生效也没有提示。

  - 启动与配置重载时比对 yml 与已保存账号（按账号 id；字段比较不解析 `${VAR}`，引用只与同一引用相等，只输出路径不输出值），有差异时记一条 `endpoint_config_drift` 警告，并进入 Console「需要你处理」（新条目类型 `endpoint.config-drift`，需该适配器实例的 `endpoint.view`）。
  - 新增适配器账号 RPC：`plugin.<实例>.endpoint-drift`（只读，`endpoint.view`）、`endpoint-import { id, expectedRevision, expectedGeneration?, start? }`（把 yml 账号写入已保存账号，`${VAR}` 保存为引用、启动时才解析）、`endpoint-writeback { ids }`（把已保存账号写回 yml，密钥只写成 `${VAR}` 引用或占位引用，绝不写明文）。两者都需要 `endpoint.manage` 并进入审计；`endpoint-writeback` 会改写 `zhin.config.yml`，因此**还需要全局的 `ops.config.write`**（与其他配置写入相同），只有适配器级 `endpoint.manage` 的账号运维者会被拒绝（403）。
  - 新增 `Adapter.configDrift()` / `importConfigured()` / `writeBackConfigured()`、`endpointConfigSourceToken` 与 `EndpointConfigSource` 等比对工具；实例提供配置文件端口与 `${VAR}` 账号引用解析器（`endpointSecretResolverToken`）。
  - 账号启动失败原因：`startFailure` 新增 `category`（auth / network / timeout / config / process_exit / unknown）与只由类别和错误码组成的 `message`；core Endpoint 列表与 Console `endpoint.list` / `endpoint.info` 新增 `lastError { category, message, at }`（与 MCP 失败形状一致）。`endpoint_start_failed` 警告日志带类别和脱敏后的原因（屏蔽该账号凭据、URL 凭据与查询串、类令牌片段），启动摘要里因失败离线的账号以 warn 写出原因。
  - 权限：`@zhin.js/console-protocol` 的 `ConsoleRpcPermissionRule`（`exact`）新增可选 `alsoRequires`（还需全局持有的权限）与 `grantsAllowAlsoRequired()`；`endpoint-writeback` 的规则带 `alsoRequires: ['ops.config.write']`，实例插件 RPC 分发与 `@zhin.js/host-http` 的 `pluginRpcWriteAllowed()` 都会检查。
  - Console「需要你处理」：启动失败（`failed`）或等待重试（`retrying`）的账号也列为 `endpoint.offline`，详情附上分类后的失败原因。

- f1a9745: #1250 账号导入 / 写回与插件 Console RPC 权限的评审修复：

  - 权限：插件 Console RPC 的方法名只有一种规范化（新增导出 `normalizePluginConsoleRpcType()`）：camelCase 与 `action.` 写法（如 `plugin.root/qq.action.endpointWriteback`）按 kebab 方法（`endpoint-writeback`）解析权限目标、`alsoRequires`（`ops.config.write`）与写操作分类（进入审计），实例分发与审计 action 也使用规范类型。此前这类写法会落到通用插件规则，绕过 `ops.config.write` 与审计。
  - 写回：yml 里已有的 `${VAR}` 引用（条目自己的或从实例块继承的）只有在进程内解析后等于已保存值时才保留；不同或无法解析时写成新的占位引用，`placeholders[].reason` 为 `reference_mismatch` / `reference_unresolved`。新增可选端口 `EndpointConfigSource.resolveReference`。凭据也按值识别：URL 用户信息、带凭据的查询参数写成占位引用，含凭据的列表拒绝写回。写回结果新增 `reconnectsAll: true`，提示该适配器实例的全部账号会随配置重载重新连接；写回会重新生成整个 `endpoints` 序列（列表内注释丢失）。漂移比对同样在进程内比较引用与已保存值。
  - 导入：yml 账号的身份字段与已保存账号不同时拒绝导入（请替换账号）；导入的配置经过 `prepareConfiguration` / `validateConfiguration`；`endpoint-import` 必须带 `expectedRevision`；导入尚未保存的账号需要适配器级 `endpoint.manage`。
  - 启动：创建 Endpoint 时抛出的 `TypeError` 若是网络失败（undici `fetch failed`、cause 带网络错误码）按网络错误重试；`Adapter.configurationCredentialFields`（默认等于身份探测字段）的值在失败原因中脱敏，Bilibili 直播声明 `sessdata` / `biliJct` / `buvid3`。
  - `zhin start --once`：等待首次启动尝试有结果（最多 30 秒），有账号 `failed` / `retrying` 时以非零码退出并列出失败账号。

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

- 704c7a4: Sandbox 会话页与功能自助反馈（#1250）：

  - 审批标记：`UserInteractionRequest` 新增可选 `purpose: 'approval'`，Core 渲染为 keyboard 段 `data.purpose`（经正常出站链）；IM 审批端口（`createRuntimeApprovalPort`）发出的「操作确认」带此标记。Sandbox 页面只给带 `data.purpose === 'approval'` 的收到消息标「需要你的确认」，游戏卡片的「放弃」、菜单分页等普通按钮消息不再被误标。
  - Sandbox 输入区：顶栏只保留状态、停止 / 重试、对话与轨迹，其余（模拟发送者、运行环境、运行检查器、清空会话）收进「更多」菜单；底部快捷键提示改为可折叠；快捷命令不再写死 `/help`、`ping`、`/status`，改由新接口 `GET /api/conversations/workspaces/commands`（权限 `endpoint.view`）按该会话的命令索引与 endpoint 实际 `commandPrefix` 生成（菜单的真实命令名优先，无前缀不带 `/`，未注册的命令不出现）。
  - 功能覆盖记录操作者：`feature_overrides.updated_by` 在同一文本列内记录结构化写入者（来源 `chat` / `console` / `cli`、聊天身份 adapter + 平台用户 ID + 显示名，或 Console 用户 principal id + 显示名），旧记录照常读取（`chat:…` / `user:…` 推出身份）。`feature.get` 与 `feature.conversations` 返回可选 `operator`：只有对该层级有 `feature.configure` 的调用方看到完整写入者（Console 用户 id 与显示名、聊天身份与名字），仅有 `feature.view` 的只看到来源（`{ source }`）。能解析时返回会话显示名（Sandbox 会话名），只按该会话所属的 Sandbox Endpoint（适配器 + Endpoint）及其当前 owner 匹配，且只返回给同时有 `endpoint.view` 的调用方（与工作区目录同一权限）。**降级注意**：写入过结构化写入者的行，在旧版本里 `updatedBy` 会原样显示为 JSON 字符串（`{"f":1,"by":…,"op":…}`），不影响读取与覆盖生效。
  - Sandbox 输入区新增「@ 机器人」按钮：插入对当前机器人（ready 帧的 endpoint id）的 mention，文本形式为 `[@<机器人 id>]`，与入站 `[@机器人名]` 解析一致；@ 候选列表里的机器人条目改为真实 id；快捷操作帮助同步说明。
  - 页面兜底渲染：不认识的段不再只显示 `[type]`——`markdown` 显示原文，keyboard 与未渲染的 JSX（`{"$jsx":…}`）读出文本、按钮降级为 `[按钮标签]`，不再出现原始 JSX 对象。

  已知限制：Sandbox 页面的「需要你的确认」标记只用于展示，依据收到消息里 keyboard 段的 `data.purpose`；能自行构造该段的插件可以让普通按钮也显示这个标记（不影响审批本身的鉴权）。

- b3ba941: Token 用量（#1250）：`plugin.root.usage-stats` 与 `zhin usage report` 按（服务, 模型）合并行，`services:<id>` 与 `accounts:<id>` 两条记录路径不再拆成两行，并给出「服务名 · 模型」显示名（RPC 行新增可选 `displayName` / `providerLabel` / `providerIds`，顶层新增 `modelLabels`）；读不到服务名时只显示模型名。两个输入总数分别标注口径（`totals.inputBasis: 'reported-all-calls'`，新增 `inputBreakdown`：首次请求估算含 `other` 与对应的真实输入）。日期 / 小时分桶按请求 `timeZone` 或实例时区（`TZ`，否则系统时区）计算，CLI 新增 `--tz`。会话显示 trace 里记录的会话名（`bySession[].displayName`、CLI `display_name`）。`zhin trace` 的模型列不再显示 `services:<uuid>/`。

### Patch Changes

- 0e998fd: Agent 性能与 trace 改进（#1250）：

  - 按需加载的工具在会话内只增不减：常驻工具按名称排在最前，已加载工具按首次加载顺序追加；本回合策略较窄、看不到的已加载工具仍保留在会话快照里，下一回合原样回到列表，相邻请求的 `tools` 前缀不变。超出 `maxLoadedPerSession` 时按最早加载淘汰并写日志（`touchToolInSnapshot` / `touchToolsInSnapshot` 新增可选 `onEvict`）。
  - 子 Agent（`ask` / `follow_up`）回合里工具产出的图片、音频、视频、文件作为结构化附件随回复交回提问方，并入提问方的回复经正常出站链发送，不再依赖子 Agent 正文复述 URL。只收工具产出的媒体（子 Agent 正文里的链接不算），并先用子 Agent 自己收窄后的权限判定每个附件（本地路径须通过它的文件权限）。
  - `zhin trace` 记录子 Agent 的模型调用与用量（之前显示 0 次），父回合汇总写成「合计（自身 N，子 agent M）」，新增 `subagent_usage` 字段；`ai.usage` 与用量记录同样计入且不重复计。
  - 同一次模型请求在时间线、`requests`、`model_calls` 与 `ai.usage` 里记录同一个 provider（实际解析出的服务 ID），`zhin trace` 显示服务名。
  - 每次模型调用记录请求前缀哈希（system + 工具定义，`prefix_hash`）；某服务长期没有缓存命中而相邻请求前缀相同时，Console 用量统计（`promptCacheHints`）、`zhin usage report` 与 `zhin doctor` 提示「该服务可能不支持或未透传 prompt 缓存」并给出前缀相同的比例。

- b3ba941: Console「机器人状态」（#1250）：`/introspection/bindings` 的 `provider` / `model` 改为当前生效的用途绑定（`purposes.agents[name]`，否则默认 `chat`），不再读已废弃的 `ai.agents.*.provider/model`（之前全是 `- · -`）；行新增可选 `displayName`、`serviceId`、`profileId`、`profileLabel`、`purpose`、`bindingSource`、`configuredProvider` / `configuredModel`。新增 `/introspection/recent-turns`：trace 归档里最近 7 天的回合（新到旧，最多 20 条，只含会话名、状态、模型与 token 计数）。
- 3fa46a0: Console「需要你处理」：错误日志条目只统计最近 24 小时的错误（标题与说明写明统计时段），更早的错误不再让这一条常亮。
- 0e998fd: 机器人专用引导文件 `BOT.md`（#1250）：项目根目录有非空的 `BOT.md` 时（只认根目录，`data/BOT.md` 不读），机器人只读 `BOT.md`（与 `SOUL.md`、`TOOLS.md`），不再读任何 `AGENTS.md`，`AGENTS.md` 留给开发者与编码代理；没有 `BOT.md` 时行为不变。新项目生成 `BOT.md`（机器人指令与记忆）和面向开发者的 `AGENTS.md`；`zhin setup --bootstrap` / `zhin doctor --fix` 在已有 `AGENTS.md` 且无 `BOT.md` 时继续用 `AGENTS.md`。修改 `BOT.md` 与修改根 `AGENTS.md` 一样需要审批。新增导出 `BOT_BOOTSTRAP_FILENAME`、`BOT_BOOTSTRAP_FILENAMES`、`botBootstrapFilenames()`、`hasBotBootstrapFile()`。

  `BOT.md` 列入 `DEFAULT_SELF_FILES`：`self` 硬闸、未注入项目根时的按名匹配与隔离 shell 的只读挂载都覆盖它，与 `AGENTS.md` 相同。只读挂载只覆盖已存在的文件；隔离 shell（`workspace-write`）运行后，项目根下新出现的自我文件（`BOT.md`、`AGENTS.md`、根配置等）会被改名为 `<文件名>.quarantined-<时间戳>`，记警告日志并在工具结果里报告。Agent 宿主、`hasBotBootstrapFile()` 与 CLI 都只认项目根目录的非空 `BOT.md`。修改根目录 `BOT.md` 与修改 `SOUL.md` / `AGENTS.md` 一样触发 Root 重建并重新读取。

- 7cd299e: 群内功能自助（`功能` / `feature`，#1250）：参数支持中英文引号包裹（`"…"`、`'…'`、`“…”`、`‘…’`、`「…」`、`『…』`），`设置 <插件> <字段> <值> [层级]` 的值取字段之后的剩余全部文本（末尾的层级词仍作层级），`功能 设置 group-suite welcomeMessage "欢迎 {name}"` 不再只返回用法。`功能 列表` 只列当前会话适用、用户可感知的插件（拥有指令 / 中间件 / 事件处理器，且没有只针对其他平台的限制），不再列出适配器与纯服务插件；配置里 `enabled: false` 的插件标为「停用（配置 enabled: false）」，`disable_plugins` 里的插件标为「停用（全局停用）」而不是空状态；超过 15 项分页（`功能 列表 <页码>`）。
- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

- ccab2c1: Console Host 侧诊断数据修正（#1250），新字段均为可选、旧客户端不受影响：

  - `endpoint.friends` / `groups` / `channels` / `group_members`：适配器不提供该读取时不再返回 `{ error }`，而是空列表加 `status: 'unsupported'`、`capability`、`message`（协议类型 `ConsoleEndpointCapabilityUnsupported` / `ConsoleEndpointListReply`，判定函数 `isConsoleEndpointCapabilityUnsupported`）。
  - `endpoint.send_message` 失败时在 `data` 中带出 `{ code, reason, status, retryable? }`（`ConsoleSendFailure`；`reason` 为 `no_live_client` / `endpoint_offline` / `endpoint_not_found` / `target_not_found` / `policy_rejected` / `platform_rejected` / `unsupported` / `invalid_content` / `delivery_unknown` / `failed`），`error` 改为对应中文原因；Core 失败回执的消息带上失败码（`Outbound delivery failed (<code>).`）。
  - MCP 客户端记录最近一次连接失败（`auth` / `network` / `timeout` / `config` / `process_exit` / `sdk_missing` / `unknown` + 脱敏短消息 + 退出码），写入 warn 日志（`op=mcp_connect_failed`），并经 Agent introspection 与 `GET /api/introspection/mcp` 返回 `status`（`connected` / `failed` / `idle` / `not_loaded`）与 `lastError`。
  - 进程资源：`GET /api/system/status` 新增 `process`（`role: 'instance'`，与 `memory` 同一次采样）；`gateway.instance.status` 新增 `gateway`（`role: 'gateway'`，网关进程自身）。协议类型 `ConsoleProcessSample`。
  - `gateway.packages.list` 每个已安装依赖带 `kind`（`plugin` / `feature` / `library`，取自 `package.json#zhin.type`），Console 只应把 `plugin` 当插件。
  - `chat-roles.*` 条目新增 `grantedByDisplayName`：调用者本人授予的记录显示其显示名，聊天内授予、配置迁移、初始化令牌给出可读标签；其他 Console 账号不解析（实例不读取网关账号库）。

- b00725c: Console 未知 RPC 不再当作安全拒绝（zhinjs/zhin#1250）：Host 既没有处理器、也不在权限表里的 RPC 类型回 `404 { code: 'unknown_rpc' }`，不执行、不写审计（按类型去重记 debug 日志）；有处理器却漏登记权限的仍按 `unmapped` 拒绝并审计。网关未知的 `gateway.*` 同样回 `unknown_rpc`。被拒绝的审计条目在 `detail.reason` 写明原因（`not_authenticated` / `setup_required` / `unmapped_permission` / `unmapped_route` / `insufficient_permission` / `scope_denied` / `handler_denied` / `no_plugin_handler`）。新增能力查询 `GET {base}/console/capabilities`（权限 `authenticated`）：返回 `{ version, rpc, features, complete }`，网关把自己处理的 RPC 与实例的合并，实例未运行或较旧时 `complete: false`（较旧实例每个路由表只问一次）。协议导出 `CONSOLE_UNKNOWN_RPC_CODE`、`CONSOLE_DENIAL_REASONS`、`CONSOLE_CAPABILITIES_PATH`、`CONSOLE_FEATURES`、`createConsoleCapabilities` / `parseConsoleCapabilities` / `mergeConsoleCapabilities`；`authorizeConsoleRpc` 新增 `registered` 选项，Host 导出 `RUNTIME_CONSOLE_RPC_TYPES`、`isAuditedRpcDenial`、`unknownRpcLog`。
- 7cc703a: 热重载重建范围按受影响的子树分别计算（#1250 `hmr-multi-change-full-rebuild`、`hmr-stale-cross-package-import`）：同一批里改了几个插件（入口、子树内的辅助模块、能力文件混在一起）时，只重建这些插件子树并替换子树外受影响的能力，其他插件 Scope、适配器投影与 Endpoint 原样保留（不重连、不重登）；适配器只在自身源码或配置变化时重建。Root 安装器可以用新的 `watchProjectFiles({ patterns, onChange })`（`RootResourceContext`）声明自己读取的项目文件，只改了这些文件（例如 `SOUL.md` / `AGENTS.md` / `TOOLS.md`、`ai.knowledge` 目录）时不再重建 Root，改为通知声明方重读（Agent Host 已声明，turn 读取最新 bootstrap；`hmr_reload | rebuilt: resource`），未声明的根目录文件仍整棵重建并记 `hmr_full_rebuild` 原因。根插件 tool 等通过包名引用挂载的本地插件模块时，被引用文件变化会让引用方一起重新加载（新代码，所有重载的引用方共享同一个新实例）；未变化的插件包保持原有的共享实例，引用方重载不会重复执行其顶层副作用；依赖索引只沿包名导入进入被监视的目录，不再遍历 workspace 链接的框架源码（启动不再变慢）；引用了普通 workspace 库等无法刷新的依赖方，在 `hmr_reload` 的 `unrefreshed_dependents` 和 warn `hmr_unrefreshed_dependents` 中列出。子树重载因拓扑变化退回整棵重建时也记 `hmr_full_rebuild` 原因；没有归属记录的文件（例如 Feature 包内的文件）仍整棵重建并说明原因；批次中其余部分重载失败时，已声明的项目文件仍会通知声明方。
- 0d8da71: 热重载与文件监视（#1250）：`zhin status` 显示实例当前的 generation（网关按实例每次提交后发布的路由表更新，不再停留在启动时的 1）；文件变化事件合并 300 毫秒（`HmrCoordinator` 新选项 `watchDebounceMs`；持续写入时最迟 2 秒也会触发，`watchDebounceMaxWaitMs`），`sed -i`、编辑器原子保存、`git checkout` 等一次改动只触发一次重载，显式 `enqueue` 不受影响（并合并同一路径尚在等待的监视事件，不会重复重载）；被监视的 `package.json` 只有 `scripts`、`description` 等不影响运行时的字段变化时直接忽略（debug 日志 `manifest_change_ignored`），依赖、`pnpm.overrides` / `pnpm.packageExtensions` / `pnpm.peerDependencyRules`、`dependenciesMeta` / `peerDependenciesMeta`、`engines`、`zhin`、`exports` / `main` / `type` 等字段变化仍按原路径处理，已挂载子插件包的 `version` 变化也会重载（插件树记录 `packageVersion`，网关据此判断 schema 漂移与发布状态；根项目自身的 `version` 仍忽略），重载失败时字段比较基线回退，下次仍能识别同一改动，需要重启时先记 `instance_restart | reason: manifest_changed | file | fields`（其他重启原因同样有结构化记录）；`hmr_reload` 新增 `rebuilt`（实际重建范围 root / subtree / capability）与 `rebuilt_plugins`（重新 setup 的插件，含适配器），实际退化为整棵 Root 重建时另记 warn `hmr_full_rebuild` 说明原因。重载范围算法本身不变。
- cca4427: IM 渠道审批（#1250）：回合内审批提示按会话决定谁能确认——全局 owner 本人、群聊里的 Bot 主人（与之前相同），开启 `ai.agent.approval.adminSelfApprove`（默认关闭）后，管理员自己的私聊里主人无法作答时，由在场的端点层 zhin `admin` 发起人本人确认标为管理员可批的操作（仅「允许一次 / 拒绝」，不记住；其余仍需主人，见安全修订）；其他用户只能对「读取外部内容后的高危动作」确认自己的意图，这一确认（`scope: 'intent'`）不能代替普通审批。确认消息走原出站链，只认同一平台用户 ID 在同一会话（端点 / 会话 / 话题）里的「确认 / 取消 / yes / no」或按钮回调，他人回复、跨会话、过期按钮无效，超时按拒绝。私聊里非主人且无管理员身份的审批不再空等超时，直接说明原因。给模型的拒绝原因区分无人值守、此会话没有确认渠道、被拒 / 超时，并提示可在 Console 操作（定时任务：「运维 → 定时任务」），不再让模型把工具名当聊天命令推荐。审批提示里的密钥字段与令牌打码（执行仍用原参数）。每次回合内确认写 `tool_approval` 决策审计（`channel: turn_prompt`、`purpose`；新增原因码 `tool_approval_unavailable`）。`ApprovalRequestInput.purpose`、`ApprovalOutcome.scope`、`formatApprovalDenial` 的可选上下文参数、`formatApprovalBlocked`、`resolveImApprover`、`describeApprovalChannelConflicts` 为新增 API。`execApprovalMode: ask`，或 `confirmHighRisk` 未关闭且启用了定时任务 / 助理提醒时，启动日志提示一次配置冲突；`zhin doctor` 新增「审批渠道」检查。`UserInteractionRequest` 新增可选字段 `purpose?: 'approval'`（`UserInteractionPurpose`），审批确认消息带上它。
- 627fb5e: 插件市场元数据不再阻止实例启动（#1250 review）：实例加载包时，`zhin.metadata.category` 不在枚举内、`descriptionI18n` 无效、`displayNameI18n` / `descriptionI18n` 含 `zh-CN` / `en` 以外的语言键，只记一条结构化警告（`manifest_metadata_dropped`，带包名与字段）并丢弃该值；`displayNameI18n` 形状错误、空字符串和未知的 `metadata` 键仍然报错。`zhin plugin check` 与发布流程保持严格校验。`parsePackageJson` 新增可选参数 `{ metadata: 'strict' | 'lenient', onWarning }`（默认 strict），`NodePackageResolver.create` / `RootRuntime` / `RootHost` 新增 `onManifestWarning`。

  `zhin search` 识别文档推荐的 keywords `zhin.js`，以及 `zhinjs`、`zhin-plugin`（不区分大小写）和带 `zhin` 清单字段的搜索结果。

  会话选择器：没有 `endpoint.view` 时可以手动填写适配器、账号 ID（规范 endpoint ID，`\0` 表示分隔符）与会话 ID，并提示缺少的权限；没有 Provider 的 `ConversationLabel` / `useConversationDirectory` 共享同一对进行中的请求，并按连接缓存 10 秒。声明式页面动作带 `result` 时，未设置 `result.tone` 则沿用计算出的语气（如 `passed: false` 为 danger），并在内联结果中显示返回的 `message`（结果本身已渲染 `message` 时不重复）。

- 4922472: AI 订阅账号接入（#1250）：Antigravity「完成准备」按官方开源客户端的方式向 `loadCodeAssist` 发送客户端 `metadata`，账号还没有 Code Assist 项目时用默认档位调用 `onboardUser` 开通并轮询长任务（有次数上限），失败时 `ProviderPreparationError` 带上游 HTTP 状态、原因码与步骤（不含响应正文与令牌）。账号没有默认档位时与官方客户端一致改用 `legacy-tier`；上游要求账号验证（`VALIDATION_REQUIRED`）时以原因 `validation-required` 结束、不尝试开通（不返回验证链接）；长任务名只接受单段 `operations/<id>`。整个准备过程有 90 秒总时限、每个上游请求有 15 秒时限，超时以原因 `preparation-timeout` / `request-timeout` 报告。准备失败不再被吞掉：日志写出代码与上游状态；`/login/complete` 仍返回 200，但账号状态视图新增 `preparationFailure`（`code` / `reason` / `upstreamStatus` / `step`，仅当前凭据修订、进程内保存），Console 无需再次调用准备即可显示原因。**客户端可见的变化**：准备失败原先一律是 503 `unavailable`，现在 `/login/prepare` 返回 424，`code` 固定为 `preparation-failed`，驱动给出的代码放在 `preparationCode`，另带 `reason` / `upstreamStatus` / `step`；机密 OAuth 客户端缺少 client secret 时 `/login/begin` 由 503 改为 428 `client-secret-required`；模型目录请求被限流（上游 429）时 `/discover` 由 503 改为 429 `discovery-rate-limited`，带 `upstreamStatus` 与解析后的 `retryAfterMs`（401/403 仍按拒绝处理）。驱动元数据新增 `requiresClientSecret` 与 `modelSuggestions`（仅为建议）；Codex 订阅支持「从服务读取模型」（Codex CLI 使用的 `/models` 目录），Claude 订阅给出带「suggestion」标记的模型 ID 建议。

  审查跟进：Antigravity 账号 `loadCodeAssist` 返回了 `currentTier` 却没有项目时，先按当前档位再调用一次 `onboardUser`（同样的长任务轮询与时限）读取项目；仍没有项目时使用模型服务配置的新可选项 `projectId`（Google Cloud 项目 ID，字符串形式，与 gemini-cli 的 `GOOGLE_CLOUD_PROJECT` 一样以 `cloudaicompanionProject` 和 `metadata.duetProject` 发给 `loadCodeAssist` / 非免费档位的 `onboardUser`），都没有才以原因 `project-required` 结束，424 文案说明如何填写项目 ID。Codex 订阅的模型目录请求不再上报 `@zhin.js/ai` 自己的版本号：`client_version` 改用模型服务配置的新可选项 `codexClientVersion`，默认 `0.167.0`（已知可用的 Codex CLI 版本，导出为 `CODEX_DEFAULT_CLIENT_VERSION`）；目录为空时 `/discover` 的结果带 `emptyHint`（`code: 'discovery-empty'` 与提示文案），Console 可提示用户手动填写模型 ID。`@zhin.js/ai/providers` 新增导出 `CODEX_DEFAULT_CLIENT_VERSION`、`CodexServiceOptions`、`AntigravityServiceOptions`。

- b56cca9: 定时任务（#1250）：`ScheduleJobRegistration` / `defineSchedule()` 新增可选 `title`、`titleI18n`、`kind`（`plugin-internal` 默认 / `user-task`）；实例 Schedule Host 记录每个任务最近一次实际执行的开始 / 结束时间与成功 / 失败（`lastRun`）。`schedule:list` / `cron:list` 的内存任务行新增可选 `kind`、`title`（按请求 `locale` 解析）、`titleI18n`、`displayName`、`lastExecutedAt`、`lastFinishedAt`、`lastDurationMs`、`lastStatus`、`lastError`，持久任务行新增 `kind: 'user-task'`。官方插件的内部轮询任务补中文标题。
- f3910f1: 定时任务（#1250）：持久任务现在记录并显示下次运行时间（`state.nextRunAtMs`）——启动时为已启用的任务重新计算（修复升级后为空的旧数据并记 info），每次运行、`resume` 后都会重新计算，`pause` 清空；已启用却算不出下次运行时间的任务记 warn，并作为「需要你处理」的 `schedule.unschedulable` 条目出现。重启时 assistant profile 同步不再清空任务的运行记录（`state`）与创建时间；`routines.heartbeat.enabled: false`（或 profile 不再声明心跳）会把已持久化的 `assistant-profile-heartbeat` 停用，profile 改变任务启用状态时记 info。`zhin schedule list`、`GET /assistant/jobs` 与 Console `schedule:list` 的持久任务返回 `target: { resolved, display?, reason? }`（账号显示名 + 会话；账号已不存在时 `resolved: false`），CLI 以「⚠ 无效」标出，并显示已启用任务的下次运行时间。`zhin schedule add` 新增 `--target <adapter>:<endpoint>:<kind>:<id>`（省略时沿用 `assistant.defaults.notify` / profile `defaults.notify`）；`--notify-channel im` 缺目标或目标账号不存在时，Host 返回 400 与错误码 `schedule_target_required` / `schedule_target_not_found` / `schedule_target_invalid` 和中文说明，不再是 Internal error。数据库迁移完成后 `data/schedule-jobs.json` 改名为 `schedule-jobs.json.migrated`（记 info）；`schedule_list` 工具描述改为真实存储位置。
- b5884b3: 服务地址可以改了（#1250 `service-baseurl-immutable`）：没有账号引用的服务可以任意修改地址；已被账号引用的服务只允许改 URL 路径（协议、主机、端口不变，例如把 `https://byesu.com` 改成 `https://byesu.com/v1`），换主机仍然拒绝——账号的密钥只能发往原来的主机。只有 `baseUrl` 跨源修改才返回新的 `ProviderError` 代码 `service-origin-change`（HTTP 409），其他身份字段（issuer、tenant、product、headers、鉴权方式等）的修改仍是 `plan-conflict`；同源比较前按 URL 规范化（默认端口、IDN、IPv6 写法、大小写、主机名末尾的点），Console 拿到的错误文案说明原因并建议「复制为新服务」。另外，模型请求拿到 2xx 却不是 JSON / 事件流（例如少了 `/v1` 时返回站点首页 HTML）时，改为明确的 `non_json_response` 失败类型（「服务返回的不是 JSON（可能少了 /v1）」），不再是看不懂的 SDK 解析错误，也不会重试；连接测试与聊天失败提示都会用到它。
- f863a21: 启动时「引用了未设置的环境变量」警告跳过 `disable_plugins` 中插件实例的配置块：停用的插件不会加载，其 `${ENV}` 不再被报告（#1250）。
- Updated dependencies [b3ba941]
- Updated dependencies [8c92bda]
- Updated dependencies [7cd299e]
- Updated dependencies [7cd299e]
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
- Updated dependencies [cca4427]
- Updated dependencies [70ddaf4]
- Updated dependencies [dbdfca3]
- Updated dependencies [704c7a4]
- Updated dependencies [b56cca9]
- Updated dependencies [f3910f1]
- Updated dependencies [07bd3dc]
  - @zhin.js/host-http@1.3.0
  - @zhin.js/console-protocol@1.3.0
  - @zhin.js/command@1.3.0
  - @zhin.js/core@1.8.0
  - @zhin.js/plugin-runtime@1.3.0
  - @zhin.js/adapter@1.3.0
  - @zhin.js/im-contract@1.2.0
  - @zhin.js/schedule-feature@1.1.18
  - @zhin.js/middleware@1.1.19
  - @zhin.js/component@1.1.19
  - @zhin.js/feature-kit@1.1.18
  - @zhin.js/permission@1.2.2
  - @zhin.js/prompt-section@1.1.18

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

- eba2566: 功能覆盖迁移修正（ADR 0057 §2 复审）：键格式不合法或层级写错的条目（以前就不生效）跳过并警告、只留在备份里，不再让每次启动失败，也不会因迁移而变成生效；嵌套块只认插件树里真实的子插件实例，插件自己的形如 `xxx.overrides` 的配置字段不再被删除，迁移后也不被拒绝；`imported` 状态下配置文件的改动在数据库行仍为迁移所写时覆盖该行，否则保留数据库值并逐条警告。

  复审补充：迁移完成后的配置更新按当前在服务的插件树判断子插件，并在更新时就拒绝更新新加入的嵌套覆盖块（新子插件尚不在树里时不再等到下次启动才失败）；`imported` 状态下按配置文件同步过的行保持 `migration:` 标记，迁移完成前一直以配置文件为准（此前第二次同步后修订号变为 2，之后的文件改动会被忽略）。

- a86bdc7: 功能覆盖迁入数据库（ADR 0057 §2）：

  - 适配器 / 账号 / 会话三级功能覆盖统一存在项目数据库表 `feature_overrides`（`level` 列为 `adapter` / `endpoint` / `conversation`，主键由 `(plugin, level, key)` 生成）；旧表 `feature_conversation_overrides` 的行首次加载时复制过来，旧表保留只读。全局默认值仍是配置文件里的插件块，全局开关仍是 `disable_plugins`。
  - `configFor` / `isEnabledFor`、分发门禁与 Console `feature.*` 从数据库读取适配器 / 账号级覆盖，合并顺序与锁定规则不变；Console 与聊天「功能 设置 / 开启 / 关闭」的适配器 / 账号级写入改写数据库，立即生效、不再改写配置文件。新增 `readStoredFeatureOverrides`、`validateStoredFeatureOverride`。
  - 首次启动自动迁移：把配置文件里各插件块的 `overrides` 导入数据库，成功后备份原文件到 `.zhin/backups/` 并原子删除这些块，记录写入 `.zhin/migrations/feature-overrides.json`；失败时配置文件不变、下次启动重试。迁移完成后配置文件再出现 `overrides` 会在启动与配置更新时被拒绝。
  - MongoDB / Redis / memory 方言下拒绝覆盖写入（503 `feature-overrides-unpersisted`），会话级也不再只存内存。
  - `feature.*` 请求与响应形状不变；适配器 / 账号级的 `revision` 改为数据库行的修订号，仍兼容旧版 Console 传入的当前配置修订号。

- eba2566: 登录辅助加固（ADR 0058 复审）：登录 RPC 与权限表读同一组 `adapter` / `endpointKey` 字段（`data` 与顶层不一致即拒绝），只凭适配器 / 账号范围授权的调用方，`login.list`、`login.flow.list` / `get`、`login.submit` / `cancel`、`login.relogin` / `refresh` 都限定在被授权的账号，不能再借 `data` 里的目标读取或应答其他账号的挑战；终端只把敏感块和验证链接写到不被采集的终端（TTY stderr 或 `/dev/tty`），`zhin start --foreground` 管道输出里不再出现，没有控制终端时提示改在 Console 查看；兼容事件 `endpoint.login.pending` / `expired` 去掉二维码图片（`imageOmitted: true`）；超过约 24.8 天的挑战截止时间不再立即过期；终端绑定在流程结束后释放其记录。
- ac72706: 登录辅助 v2 第一期（ADR 0058）：每个账号一条登录流程（`LoginAssist.beginFlow`、时间线、提交后自动「验证中」与「结果待确认」、错误码与 `next`），挑战描述符带分步引导、复制 / 链接 / 提示块（敏感块只在活动挑战上）、`parseLoginTicket()` 与托管验证码辅助页的共享函数；`defineAdapter({ login })` 能力声明与 Endpoint `login` 钩子；Console 新事件 `endpoint.login.flow` 与 RPC `login.flow.list` / `login.flow.get` / `login.relogin` / `login.refresh`，`login.submit` 支持 `{ action, values }` 与 `wait: true`；登录操作审计结果类别；终端按流程逐行显示进度、按编号选择操作；账号行填写 `pendingLogin` / `loginStep` / `login`；配置 `console.loginAssist.captchaHelperUrl`。旧 `waitForInput` / `login.list` / `login.submit` 行为不变。
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
  - @zhin.js/core@1.7.0
  - @zhin.js/plugin-runtime@1.2.1
  - @zhin.js/host-http@1.2.2
  - @zhin.js/console-protocol@1.2.2
  - @zhin.js/database@1.2.0
  - @zhin.js/adapter@1.1.34
  - @zhin.js/command@1.2.2
  - @zhin.js/component@1.1.18
  - @zhin.js/feature-kit@1.1.17
  - @zhin.js/middleware@1.1.18
  - @zhin.js/permission@1.2.1
  - @zhin.js/prompt-section@1.1.17
  - @zhin.js/schedule-feature@1.1.17
  - @zhin.js/harness@1.0.1

## 1.1.27

### Patch Changes

- fa22d4b: 配置存放规则落地（ADR 0057 第 1 步）：声明放 `zhin.config.yml`，运行时状态放数据库，密钥放 `.env`。

  - 密钥字段统一由 `@zhin.js/runtime` 的 `isSecretConfigKey` / `isSecretConfigSchema` 判定：Schema 标注 `x-zhin-secret: true`（主机 Schema 的 `http.token`、`database.password`、`mcp.token`、`a2a.token` 等已标注，`Schema.string().secret()` 同时输出该标注，Ajv 将其登记为注解关键字），没有标注时按字段名兜底（`token`、`password`、`secret`、`apiKey`、`privateKey`、`*Token` 等）。网关的配置脱敏、聊天配置策略、Console 表单与配置说明共用这一判定。
  - 实例启动（`zhin start` 与 `--standalone`）发现密钥字段是字面值而不是 `${…}` 引用时打一条警告，只列路径不打印值，提示运行 `zhin doctor --fix`。
  - `zhin doctor` 报告明文密钥；`zhin doctor --fix` 把字面值写进 `.env`（`ZHIN_<路径大写下划线>`，相同值复用，名字被其他值占用时追加 `_2`），并把配置值换成 `${变量名}`；配置经配置文件事务写入。
  - `.env` 改为加锁原子写（临时文件 + fsync + rename），保留原文件权限，新文件为 `0600`；网关 Console、`zhin console init`、`zhin doctor` 与脚手架向导都使用同一个写入函数。YAML/JSON 配置的原子替换同样会 fsync。

- 7fb1ee7: Console 的插件全局开关改由管理网关作为启停事务执行（ADR 0054 §4）：网关在转发前拦截 `plugin:set-enabled` 与 `level: 'global'` 的 `feature.set-enabled`，按 `plugin.manage` 授权，执行与 `gateway.plugins.enable` / `disable` 相同的事务（停实例 → 写 `disable_plugins` → 启实例，失败回滚），并用两者原有的回复形状作答（另带 `transaction`；失败时为 `transaction_failed` / `rollback_failed` 错误信封）；成功变更后在事件流补发 `plugin:lifecycle-updated`。权限表中 `plugin:set-enabled` 改为 `plugin.manage`，`feature.set-enabled` 的全局层细化为 `plugin.manage`（其余层仍是 `feature.toggle`），新增 `isGlobalFeatureSwitch` / `FEATURE_GLOBAL_SWITCH_PERMISSION`。实例不再写全局开关：`plugin:set-enabled` 与 Console 路径上的全局 `feature.set-enabled`（409 `gateway-required`）一律拒绝，`--standalone` 下请用 `zhin enable` / `zhin disable`；`RuntimeConsoleRpcContext.setPluginEnabled` 已移除。`@zhin.js/client` 的 `setPluginEnabled` 改用依赖事务的可续期超时。聊天命令的全局开关暂不变。
- d80964d: 修复 1.2 发版撞号：`@zhin.js/core` 与 `@zhin.js/agent` 按 minor 升到 1.2.0 时，npm 上早已有同号的旧架构版本（core 1.2.0–1.5.16、agent 1.2.0–1.2.1），`changeset publish` 只提示 already published 就跳过，导致 `zhin.js@1.1.26` 等已发布的包依赖了旧 core / agent，启动时缺少 `CHAT_ROLES`。

  本次把 core 发为 1.6.0、agent 发为 1.3.0（npm 上第一个空闲的 minor），并重新发布所有直接依赖它们的包，让依赖版本与 peer 范围指向新版本（`^1.6.0` / `^1.3.0`，不再落进旧架构版本）。

- Updated dependencies [cfa3dbf]
- Updated dependencies [73ef48b]
- Updated dependencies [7fb1ee7]
- Updated dependencies [d80964d]
  - @zhin.js/console-protocol@1.2.1
  - @zhin.js/command@1.2.1
  - @zhin.js/host-http@1.2.1
  - @zhin.js/core@1.6.0
  - @zhin.js/adapter@1.1.33

## 1.1.26

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

- fd055d2: 修复依赖安全告警：传递依赖 zod 升到 4.6.7 以上、@hono/node-server 升到 2.1.7 以上、qs 升到 6.16.1 以上（经 MCP SDK 引入），rimraf 升到 6.1.4（随之使用已修复的 glob），开发工具链的 minimatch 升到 11.x；新建插件模板的 rimraf 范围同步更新。
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

- 9f4b996: 拆包（ADR 0054 §0）：新增管理网关包 `@zhin.js/gateway`，承载 Console 账号与权限、终端、项目配置与 `.env`、依赖事务与实例监管，不依赖 zhin.js 与 IM 层；实例装配根迁到 `zhin.js/instance`（另有 `zhin.js/instance/cli`）；`@zhin.js/cli` 不再依赖 IM 层，`zhin runtime start` 等命令按项目解析 `zhin.js/instance`。迁移：原先从 `@zhin.js/cli` 导入的 `runStartCommand` / `RootHost` 改从 `zhin.js/instance` 导入。
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
- 663473b: Agent 模型输出不能再借出站媒体段发送宿主文件（ADR 0056 §2）：

  - 此前模型可以在回复里写 `{"kind":"file","value":"file:///etc/passwd"}`（或 `/etc/passwd`）这样的「平台文件引用」，Agent 发布层原样放行，OneBot / NapCat 会把它当作本地文件读取上传；模型以 `path` 引用工作区文件时也只做了工作区与敏感文件名检查，没有按发起人角色做 `read_file` 的读取判定（普通成员可发出 `.git/config`、`package.json`）。
  - Core 新增不可信来源的出站媒体策略：`untrustedContent(content, trust)` 包装的内容在渲染器里（出站中间件与 Endpoint 之前，出站链仍唯一）只允许 http(s) 链接、有上限的内联数据（默认 25 MiB）与裸平台文件标识；本地路径（含 `file://`）只在 `trust.authorizePath` 认可或由可信代码 `trustedMediaRef()` 构造时放行；嵌套的本地来源拒绝，`html` 只保留文字，不做 `${…}` 模板替换。被拒的段替换为可见提示（「[图片未发送：媒体来源不被允许]」）并记录 `op=outbound_media_refused`。
  - Agent 的回复、流式回复（`OpenReplyStreamOptions.mediaTrust`）、场景事件回复、主动发送与 QQ / ICQQ / Telegram / Discord / NapCat / 企业微信的 Agent 工具发送都按不可信来源投递；模型引用的本地路径按发起人文件角色（只有全局 `owner` 是 `owner`）做与 `read_file` 相同的判定，需要确认的敏感读取直接拒绝。插件代码自己构造的内容不受影响；工作区内工具生成的截图、图表与 Agent 落盘的大附件照常发送。

- c606d51: 平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 已删除（聊天角色见 `sender.chatRole`，ADR 0056）。平台身份检查（`platform:admin` 等）、发言门控与参与者标签读 `sender.platform`（平台身份不映射为 zhin 角色），不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`。
- 5cd9d3d: 插件权限按级别授予内置角色，插件 Console RPC 按方法鉴权（ADR 0049 修订）

  - console-protocol：插件权限（`<plugin>:<action>`）分为 read / operate / manage 三级，可在 `definePluginConsoleRpc({ permissions })` 声明，未声明时按后缀推断；新增目录权限 `plugin.perms.read|operate|manage`：viewer 得到 read，operator 得到 read + operate，admin 与 owner 得到全部。
  - gateway / host-http：自定义角色与 API 令牌可以写入插件权限；`iam.roles.list` 返回各角色实际生效的插件权限与当前运行时的插件权限目录（`pluginPermissions`）；`/auth/me` 按已加载插件展开级别授予。
  - zhin.js：已登录用户与 API 令牌调用 `plugin.<id>.<method>` 时，按方法自身、所属页面或目录兜底权限逐一检查（此前只检查 `feature.view` / `feature.configure`，operator 可以审批 `ops:approve` 操作）；门禁放行但无插件分发器应答的请求一律拒绝并记审计。
  - adapter：账号类方法的授权目标与处理函数选择账号的方式一致（`consoleAccountTarget`，先看 `data.instanceId`），`id` / `instanceId` 不一致或放在 `data` 之外时拒绝，避免按一个账号授权、却操作另一个账号；适配器 / 账号作用域的绑定可满足目录与插件权限。
  - plugin-runtime：`definePluginConsoleRpc` 支持声明权限级别。
  - rss / reminder / ledger / calendar / qrcode / short-url：补充权限级别声明（写操作为 operate 级）。

- 0e35afd: 发版收尾：功能与文档对齐网关、访问控制的新语义。

  - `zhin migrate` 与 `zhin runtime migrate` 的 cutover 把项目的 `zhin.js`、`@zhin.js/cli`、`@zhin.js/gateway` 同批放进 `dependencies`：只写在 `devDependencies` 的连同版本挪过去，重复项删除；缺少网关时补上（CLI 用 `latest` 等标签时沿用同一标签，否则用与当前 CLI 同批发布的版本范围）。插件包（无项目配置 / 公开发布包）的 CLI 仍是开发依赖。
  - `zhin console init` 新增 `--database-password-stdin`（标准输入第一行；与 `--password-stdin` 同用时第二行是所有者密码），三种数据库密码来源只能选一个；`--database-password <值>` 保留但帮助与文档标为不推荐，使用时打印警告。
  - 脚手架生成的 `.env` / `.env.example` 把 `HTTP_TOKEN` 注释改为「初始化令牌：仅在创建首个所有者之前有效」，自动化改用账号签发的 API 令牌。
  - 文档：插件安装、更新、卸载统一写为网关 `gateway.packages.*`（实例内的 `plugin:install | update | uninstall` 已删除）；MCP / A2A 鉴权改为 `mcp.token` / `a2a.token`，或全局持有 `mcp.access` / `a2a.access` 的账号签发的 API 令牌，`http.token` 不再作为协议凭据（中英）；示例 `full-bot` 改用 `MCP_TOKEN` / `A2A_TOKEN`，各示例把 CLI 与网关放进 `dependencies`。

- 1e54b1e: 安全加固：实例侧数据库宿主（Console 数据库页、原始 SQL、模型定义与事务）拒绝访问网关的 `console_*` 表，独立模式改用仅根可用的 `gatewayTableHost()`；Agent 文件工具把 SQLite 数据库文件视为敏感文件。SSH 终端目标必须配置 `hostFingerprint`，只有显式 `insecureAcceptAnyHostKey: true` 才跳过校验并在 Console 标为不安全。新增 `http.trustProxy`（受信任代理时从 `X-Forwarded-For` / `Forwarded` 推导客户端地址，用于限速、审计、协议鉴权与桥接）；带转发头的请求不再算本机连接（未配 `access_token` 的反向 WebSocket、MCP / A2A 本机免鉴权一律拒绝）。
- Updated dependencies [1a5c569]
- Updated dependencies [53932e5]
- Updated dependencies [57c6cdc]
- Updated dependencies [e1fda87]
- Updated dependencies [4e8ba38]
- Updated dependencies [a9c7a13]
- Updated dependencies [120e225]
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
- Updated dependencies [5cd9d3d]
- Updated dependencies [5cd9d3d]
- Updated dependencies [c2bbdcf]
- Updated dependencies [f8bf684]
- Updated dependencies [663473b]
- Updated dependencies [c606d51]
- Updated dependencies [5cd9d3d]
- Updated dependencies [d655ef0]
- Updated dependencies [1e54b1e]
  - @zhin.js/console-protocol@1.2.0
  - @zhin.js/adapter@1.1.33
  - @zhin.js/core@1.2.0
  - @zhin.js/logger@1.1.3
  - @zhin.js/host-http@1.2.0
  - @zhin.js/feature-kit@1.1.16
  - @zhin.js/middleware@1.1.17
  - @zhin.js/command@1.2.0
  - @zhin.js/component@1.1.17
  - @zhin.js/database@1.1.8
  - @zhin.js/permission@1.2.0
  - @zhin.js/plugin-runtime@1.2.0
  - @zhin.js/prompt-section@1.1.16
  - @zhin.js/schedule@1.1.5
  - @zhin.js/schedule-feature@1.1.16
  - @zhin.js/im-contract@1.1.14
  - @zhin.js/harness@1.0.1

## 1.1.25

### Patch Changes

- 0d76a7c: Overhaul Console interactive workbenches, platform-specific adapter account onboarding/login flows, DeclarativePageView visual/interactive capabilities, and official utility plugin Console pages.
  - @zhin.js/core@1.1.60

## 1.1.24

### Patch Changes

- Updated dependencies [8adce16]
  - @zhin.js/core@1.1.59
  - @zhin.js/plugin-runtime@1.1.23
  - @zhin.js/permission@1.1.15
  - @zhin.js/schedule-feature@1.1.15

## 1.1.23

### Patch Changes

- 008ccad: Consolidate fragmented IM micro-packages (`@zhin.js/interaction` into `@zhin.js/im-contract`, `@zhin.js/ai-provider` into `@zhin.js/ai/provider`, and `@zhin.js/config-file` + `@zhin.js/isolate` into `@zhin.js/runtime`), and expose `zhin.js/schedule` convenience subpath.
- 5419b88: Add generation-scoped `definePluginStore` (`PluginStore`), `Scope.get()`, declarative `PluginSetupCapabilities` return in `definePlugin()`, and `JsonSerializable<T>` typing on `PluginStateStore` to eliminate `as never` casts on TypeScript interfaces.
- Updated dependencies [008ccad]
- Updated dependencies [a1f1028]
- Updated dependencies [5419b88]
  - @zhin.js/core@1.1.58
  - @zhin.js/plugin-runtime@1.1.22
  - @zhin.js/permission@1.1.14
  - @zhin.js/schedule-feature@1.1.14

## 1.1.22

### Patch Changes

- Updated dependencies [6163abc]
- Updated dependencies [fed2c27]
- Updated dependencies [bc6ccb1]
- Updated dependencies [72b5a12]
  - @zhin.js/core@1.1.57
  - @zhin.js/plugin-runtime@1.1.21
  - @zhin.js/permission@1.1.13

## 1.1.21

### Patch Changes

- b652db3: Keep default Database, Core and Agent declarations independent of unselected external database drivers. Memory and SQLite remain available from the root; native MySQL, PostgreSQL, MongoDB and Redis classes/configuration move to their precise `@zhin.js/database/dialects/*` entries. TypeScript `Registry.create()` callers select the corresponding dialect types, and third-party dialects augment the single `@zhin.js/database/registry` contract.

  This updates author imports: plugins using these new entries need `@zhin.js/database >=1.1.6` (pending this patch release). Built-in registration, synchronous creation, connection-time driver loading and existing Host database configuration remain unchanged. No drivers, type peers, data migration or version bump are added by this change.

- Updated dependencies [b249e5e]
- Updated dependencies [57661f6]
- Updated dependencies [cbd3f14]
- Updated dependencies [299863a]
- Updated dependencies [4fe49b5]
- Updated dependencies [b652db3]
- Updated dependencies [0315ba0]
  - @zhin.js/core@1.1.56
  - @zhin.js/plugin-runtime@1.1.20
  - @zhin.js/permission@1.1.12

## 1.1.20

### Patch Changes

- af8f803: Use the current Endpoint's platform profile for Agent account identity, with per-field configured fallbacks and scoped, identity-approved profile tools. Keep SOUL first-person and independent of account names. Profile ports preserve the source Client, cancellation, truthful update outcomes and private image authority.

  Adapter Feature API 2.1 and Tool Feature API 1.1 describe the additive profile requirements; new Core, official adapters and generated plugins declare the corresponding floors. Existing compatible API-2.0/API-1.0 plugins remain accepted by the newer providers. npm releases remain patch.

  Private IM assets now bind to the full canonical conversation and principal. Existing IM asset records that contain only the earlier lossy hash remain on disk until their original expiry, but cannot be safely rebound; recapture them. No automatic file deletion, platform profile mutation or workspace SOUL rewrite occurs during upgrade.

- Updated dependencies [b0c02a2]
- Updated dependencies [af8f803]
- Updated dependencies [26fda97]
- Updated dependencies [976886c]
- Updated dependencies [032dc96]
  - @zhin.js/core@1.1.55
  - @zhin.js/plugin-runtime@1.1.19
  - @zhin.js/permission@1.1.11

## 1.1.19

### Patch Changes

- 2c3610a: Move account lifecycle ownership into the generic Adapter base and let native Endpoints retain their SDK Client inheritance. Infer platform-specific operation Sessions from a single adapter registry while preserving command parameter, option, configuration and factory inference.

  Bind message replies, management ports, login challenges and Agent cancellation to the captured account incarnation. Persist runtime account intent with encrypted, revision-checked Host storage; keep account management independent of Root process restarts. Require explicit operator confirmation before importing existing accounts, and give replacement accounts a new identity without inheriting previous Sessions.

  Expose account save, start, stop, update and replacement through the existing adapter Console, with exact account ownership, truthful pending/unknown outcomes and no startup configuration or environment-file rewrites.

  Complete the target migration across every adapter, the public authoring API, generators, examples and Console. This intentionally removes the old create factory, inheritable Endpoint/ClientEndpoint classes, Client descriptors and file-rewrite account management; plugin authors must use createAdapter, native Client inheritance and the single AdapterRegistry. Satori and OneBot12 require explicit platform/userId selection, and WeCom requires a separate agentId.

  Verify opaque credential changes before the same configuration snapshot is committed. Drain admitted native callbacks across close/rollback, cancel target work on stop, and keep raw transport parsing, platform ACK timing and SDK native methods under their existing owners. Account metadata conceals credentials carried in URLs.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
- Updated dependencies [2c3610a]
  - @zhin.js/core@1.1.54
  - @zhin.js/plugin-runtime@1.1.18
  - @zhin.js/permission@1.1.10

## 1.1.18

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/core@1.1.53

## 1.1.17

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [4d728c0]
- Updated dependencies [24a2b71]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52

## 1.1.16

### Patch Changes

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- adb4af2: 允许应用 Root 显式选择命令反馈、菜单展示与按完整会话区分的出站展示偏好。未配置、返回 undefined 或策略函数异常时沿用默认展示；保留权限、30 项分页、代际隔离和统一发送链，投递失败不重试。
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/core@1.1.51
  - @zhin.js/permission@1.1.9

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
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/permission@1.1.8

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

- 5be09ae: Re-export the `ConversationRef`, `DeliveryReceipt`, `CapabilityContext` and `OperationClientPort` types from `@zhin.js/core` and `zhin.js`, so toolkits such as `@zhin.js/testing` can type against the app's single `zhin.js` tree instead of depending on `@zhin.js/im-contract` and `@zhin.js/feature-kit` directly (#899). Type-only and additive.
- d3563d9: Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
- 2264a99: **从 1.1.13 及更早版本升级（configVersion 2）**：先停止 Bot，再升级依赖，然后运行 `zhin migrate instances` 预览、`zhin migrate instances --apply` 迁移配置，最后 `zhin config check` 后重新启动。指南：https://zhin.js.org/operations/upgrades#configversion-2

  降低 v1 配置升级成本：启动、`zhin config check` 和 `zhin doctor` 检测到 v1 配置（缺少 `configVersion: 2` 或仍有 `package.json#zhin.plugins`）时，直接说明是 v1 配置，并给出停机与迁移命令和文档链接，不再报通用解析错误。`zhin migrate instances` 默认输出按键名列出的可读预览（不含任何配置值，`--json` 保留机器输出）；`--apply` 写入前把原文件复制到 `.zhin/backups/config-v2-<时间戳>/` 并打印路径与恢复方式。`zhin migrate` 默认保留精确版本、`link:`、`file:` 等锁定依赖（`--include-pinned` 才改为 latest），dry-run 结束时明确提示未做任何改动，帮助文本指向配置迁移并区分 `zhin runtime migrate`。

- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [c618eb7]
- Updated dependencies [fbfefb7]
  - @zhin.js/core@1.1.47

## 1.1.11

> **⚠️ 升级须知（configVersion 2）**：随本版本发布的 `@zhin.js/cli` 1.1.14 起，Runtime 只接受 `configVersion: 2`，旧配置会被拒绝启动。先停止 Bot，再升级依赖，然后运行 `zhin migrate instances` 预览、`zhin migrate instances --apply` 迁移（自动备份），最后 `zhin config check` 后启动。指南：https://zhin.js.org/operations/upgrades#configversion-2

### Patch Changes

- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/core@1.1.46
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15

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
  - @zhin.js/core@1.1.44
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/logger@1.1.2

## 1.1.8

### Patch Changes

- 386150d: Unify command parameters, options, validation and help; provide IM middleware defaults, exact persistent delivery targets and owner-scoped atomic state. Derive plugin configuration types, defaults, validation and Console metadata from one declaration, preserve plugin ownership and generation admission, and keep process database, scheduler and outbound resources private to the root. Reject inline configuration in isolated plugins inside their own realm; isolated configuration uses schema.json.

  Reject ambiguous optional/rest routes and undefined dynamic defaults, preserve optional parameter types and help handling, and validate Console edits with the Runtime configuration engine. Keep unrelated plugin entries cached during helper reloads, expose initial configuration metadata before login completes, and drain admitted Host operations while rejecting retired or failed-generation access.

  Keep schedule activation and hot reload atomic, preserving published jobs when a candidate fails; preserve immutable database query branches and path-only command parameters. Report background unhandled rejections for the Runtime Process Host, observe ICQQ heartbeat and reconnect login failures through the SDK reconnect policy, and normalize inline image data URLs before ICQQ file or base64 delivery.

- 9891e66: 入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

  - 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
  - self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
  - `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
  - `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
  - 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。

- 9891e66: Move the Workroom runtime composition (`workroom-runtime`) from `@zhin.js/agent` into `@zhin.js/workroom`; the dependency direction is now `@zhin.js/workroom` -> `@zhin.js/agent`.

  - Workroom exports were removed from `@zhin.js/agent`, `@zhin.js/agent/runtime` and `zhin.js/agent`; the `zhin.js/agent` re-export surface shrank, so users who imported Workroom exports through `zhin.js/agent` must import them from `@zhin.js/workroom` instead (the export names are unchanged). `@zhin.js/agent` no longer depends on `@zhin.js/workroom`.
  - The `Local*` assignment authority types declared by the authority provider module (`WorkroomLocalAssignmentAuthorityInput`, `WorkroomLocalAssignmentResolvedAuthority`, `WorkroomLocalAssignmentAuthorityPort`) clash with the domain contracts of the same name in a single barrel; the provider variants are exported with a `WorkroomProvider` prefix.
  - Compatibility stubs at the old internal agent paths and the `./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js` deep exports of `@zhin.js/workroom` are removed. Use the package root.
  - `@zhin.js/agent` gains three narrow host-integration exports: `collectAgentLoopTurnRun` and type `ZhinAgentPrivate` (`@zhin.js/agent/core`; `ZhinAgentPrivate` is an internal host-integration type, not a stable API), and `runWithAgentTurnConfiguration` (`@zhin.js/agent/turn`).
  - `@zhin.js/cli` and `@zhin.js/a2a` declare `@zhin.js/workroom` as an optional/dev + peer dependency (like `@zhin.js/agent`), so installing the core no longer pulls in agent/workroom.

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
  - @zhin.js/core@1.1.43
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13

## 1.1.7

### Patch Changes

- 5ab6307: 修正 JSX 的默认语义为消息排版：内置小写标签无需导入并提供属性类型，标签与属性映射为 Segment；只有显式 html / Html 子树序列化为 HTML。支持注册组件标签、原生 share 与平台 card，以及 Button onClick 回跳与返回值自动回复；同步脚手架、示例和文档。

  运行实例统一分配递增、不重复的按钮降级编号，会话交错发送时允许跳号，回调有效期为一小时，发送确认前的点击可正常执行；等待文字输入不会吞掉 JSX 按钮事件。修复 Card 原生 key 载荷、带 MIME 参数的图片 data URI、注册组件递归深度和媒体/HTML 类型约束。原有裸 HTML 布局需要显式包裹 `<html>` / `<Html>`。

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
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/permission@1.1.4

## 1.1.5

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/core@1.1.40

## 1.1.4

### Patch Changes

- 43eda99: Unify Notice and Request payloads with their public types and runtime exports. Use camelCase fields, preserve native data under metadata, and bind canonical endpoint identity and request actions to the held generation. Remove legacy data aliases and from factories.

  Keep login and lifecycle signals as independent SystemEvent payloads on system.receive, without chat conversation fields or user interaction. Update built-in adapter projections and authoring guidance.

- 0de4836: Expose the canonical Plugin Runtime `Message` contract from `@zhin.js/core`, `@zhin.js/core/runtime`, and the `zhin.js` root entries, and migrate Agent, permission, and GitHub integrations to the fields middleware actually receives. Document and lock the `EndpointEvent<Notice | Request>` handler boundary so side-event payload fields match editor inference.
- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39
  - @zhin.js/permission@1.1.3

## 1.1.3

### Patch Changes

- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
  - @zhin.js/core@1.1.38
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/permission@1.1.2

## 1.1.2

### Patch Changes

- c861789: Own the Agent lifecycle event contract inside the Agent package and remove the
  classic Plugin event subscription bridges. Runtime consumers now subscribe
  through explicit event targets instead of Plugin AsyncLocalStorage. Agent event
  publication no longer double-writes into `Plugin.dispatch()`, and Core no longer
  declares Agent or Schedule events in `Plugin.Lifecycle`. Replace the process-global
  activity bus with a generation-owned Resource, and remove concrete Plugin objects
  from ZhinAgent and its tool security path.
- cd54131: Remove the deleted `usePlugin`, `getPlugin`, and host-root registry signatures
  from the public runtime instead of retaining throwing or no-op compatibility
  exports. Remove the module-global `registerAIHook` compatibility registry;
  Agent hooks now belong to generation-owned resources and canonical stream events.
- a9e4a40: Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
- 5855db7: Decouple canonical Message, Side Event, and middleware contracts from the classic Adapter class registry. Adapter identity now follows the Plugin Runtime string contract, and the unused `RegisteredAdapters`, adapter-message inference, and classic Endpoint config aliases are removed.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 9110ab8: Move optional Speech loading and pipeline ownership into the CLI composition root. Agent media handling now depends on an explicitly injected `AudioTranscriptionPort`; Core no longer exposes a process-global Speech loader, and Logger no longer exposes the process-global warn-once registry.
- b853dba: Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
- f4387ef: Publish `generate_image` as a generation-owned native Tool Feature for both main and subagent turns. Provider lookup and image defaults now stay with the Host-owned `AIService`, execution follows the canonical `ToolIndex` and `TurnToolRuntime` path, and the detached class-based implementation is removed.
- 5a7a7f7: Remove the duplicate classic interactive handler registry and process-global keyboard fallback store. `ImRuntime` now owns one encapsulated interactive router whose handlers and fallback mappings are isolated by runtime instance, generation, and conversation.
- 75920c4: Replace the process-global LLM provider, transport, live-model resolver, and language-model caches with owner-scoped `LlmApiRuntime` instances. Agent loops and compaction now require an explicit completion port; AIService, ZhinAgent, subagents, deferred workers, and the CLI composition root retain and inject their own runtime. Remove the global registration, lookup, resolver, cache-reset, and test-reset APIs.
- 5c1ea6c: Replace the process-global Owner approval helpers with `OwnerApprovalRuntime`, owned by each `ZhinAgent` and injected into command handling and exec policy evaluation. Remove classic `Plugin` lookup wrappers, the unreachable pending-approval map and shorthand, and its misleading stability metric.

  Split strict V2 persistence into a private store that validates complete documents and writes atomically. V1 files are rejected without online migration or rewriting; retained approvals must be recreated explicitly.

- cd4f240: Replace the detached class-based `knowledge_search` implementation with a generation-owned Tool Feature backed by the explicit `KnowledgeIndex` contract and encapsulated `MarkdownKnowledgeIndex`. The CLI publishes it to main and subagent turns only when `ai.knowledge.baseDir` is explicitly configured inside the project root. Knowledge indexing is bounded, abort-aware, deterministic, and shared by both execution paths.
- 1cb1163: Remove the unused process-global `Adapter.Registry`, `Adapter.register`, and `Adapter.Factory` APIs. Adapter definitions and live instances are now discovered and owned only by the current generation's `AdapterIndex`.
- be3061e: Remove the classic Core `Adapter` class, Core `Endpoint` compatibility type, capability WeakMap, and their connection and lifecycle helpers. Platform integrations now have one model: `defineAdapter`, `Endpoint<TClient>`, and the current generation's `AdapterIndex` from `zhin.js/adapter`.
- 98dbc85: Remove classic `*.tool.md` and standalone Skill directory discovery from the Agent runtime. Tools now enter through Plugin Runtime `tools/<name>/index.ts` features, Skills use `skills/<name>/SKILL.md`, and Group Suite keeps its database and transient state inside its owning plugin runtime.
- f19d598: Remove the remaining classic Agent Tool rail and the unmounted `install_skill` and retired `activate_skill` protocols. Skill loading now uses the polymorphic `SkillInstructionSource` contract and typed read results, `spawn_task` owns its explicit turn-bound definition, and Web, file, orchestration, spawn, and Skill modules replace the former catch-all `builtin` directory. Remove the unused ToolSelection collector and its compatibility exports so the generation Tool catalog remains the only production selection path.
- ba0ba3c: Remove the unused classic `createBuiltinTools()` aggregate and the duplicate class-based file, web-fetch, and TODO Tool implementations. These capabilities are now exposed only as generation-owned `@zhin.js/tool` definitions and executed through `ToolIndex` and `TurnToolRuntime`.
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
- 4bc3d3c: Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
- 6012e3c: Remove the detached `analyze_media` Tool that reported images as model-ready without injecting them into a model turn. Inbound images now use the canonical media pipeline directly: vision-capable providers receive native image input, while unsupported providers report that limitation explicitly. File tools no longer direct callers to a nonexistent analysis path.
- 31b42a8: Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

  RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.

- cb61227: Remove the implicit classic `web_search` Tool from standalone `AIService` agents. Standalone capabilities are now explicit through per-agent `tools` or the service-owned registration boundary, while the generation runtime remains the sole owner of native Web Tool Features. Move shared Web search infrastructure into the cohesive `web` module and reject ambiguous duplicate registrations.
- 135ac91: Remove the unmounted classic Schedule, AgentPreset, and MessageFilter Feature registries. Plugin Runtime scheduling now has one owner-scoped authority through `scheduleHostToken`, Agent presets have one authority in the Agent Feature and Resource Hub, and message admission remains in the active middleware and guardrail pipeline.
- 140cf0f: Remove the legacy composed side-event mapping aliases in favor of structured `mapNoticeParts` and `mapRequestParts`. Delete unmounted Agent default hook, tool, and subagent modules that exposed no runtime behavior.
- 203ad34: Remove process-global expression and proxy caches from Kernel evaluation. Every evaluation now compiles independently and owns its proxy identity map for the lifetime of one sandbox, so unrelated runtimes cannot share hidden evaluator state.
- e6c5113: Remove the unused Kernel PluginBase, mutable Feature registry, string-based dependency injection, and prototype extension registry. Plugin lifecycle now belongs solely to the generation-owned Plugin Runtime, while capability discovery and projection belong to Feature Kit.
- e0f6478: Remove plugin.yml build detection, package-name heuristics, and the unused Core PluginManifest type. Smart builds now recognize plugins through the canonical package.json zhin manifest and applications through an explicit zhin.js dependency.
- adecba9: Remove process-global prompt, instruction, bootstrap, and Git status caches. Context readers now observe the current workspace on every request without cross-owner state or cache-reset APIs.
- 019f5ff: Make the generation `ToolIndex` the sole Agent Tool catalog. Remove the empty ResourceHub Tool registry, its builder and Capability Seam adapter, and stop merging its empty projection into Console introspection. Agent support resources now own only Skill, SubAgent, MCP, and Hook state; plugins register Tools through `tools/<name>/index.ts` or `context.addTool()`.
- 77d5a46: Remove the retired `tool_search` and `run_deferred_task` orchestration protocol from the Agent and CLI. `discover`, `load_tool`, and `spawn_task` are now the only documented and executable orchestration vocabulary; obsolete config migration, result formatting, prompt redaction, reserved names, subagent filtering, and the detached class-based tool are removed. Config repair now preserves canonical `ai.agent` fields while removing retired model fields.
- 659b61d: Require the current Agent session database models during generation activation and remove automatic SQLite schema probing, legacy-column deletion, and historical session-tree backfills. Database mode now rejects incomplete schema registration instead of silently retaining in-memory session state.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [13f7301]
- Updated dependencies [cd54131]
- Updated dependencies [5855db7]
- Updated dependencies [ef92a6d]
- Updated dependencies [ec921d2]
- Updated dependencies [9110ab8]
- Updated dependencies [3d42fc9]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [b076eae]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
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
- Updated dependencies [31b42a8]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [65d0391]
- Updated dependencies [5c3858e]
- Updated dependencies [cf83528]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/core@1.1.37
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/logger@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.1

### Patch Changes

- @zhin.js/core@1.1.36

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/core@1.1.35
  - @zhin.js/logger@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9

## 7.0.1

### Patch Changes

- Updated dependencies [f7ee28d]
  - @zhin.js/runtime@1.0.19
  - @zhin.js/core@1.5.16
  - @zhin.js/agent@1.2.1
  - @zhin.js/html-renderer@3.0.16
  - @zhin.js/speech@3.0.16

## 7.0.0

### Patch Changes

- Updated dependencies [12325e1]
- Updated dependencies [d19e976]
  - @zhin.js/agent@1.2.0

## 6.0.15

### Patch Changes

- Updated dependencies [a5ee497]
- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/agent@1.1.18
  - @zhin.js/core@1.5.15
  - @zhin.js/html-renderer@3.0.15
  - @zhin.js/speech@3.0.15
  - @zhin.js/ai@1.5.7

## 6.0.14

### Patch Changes

- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [e9c6a73]
- Updated dependencies [2719580]
- Updated dependencies [902fa35]
- Updated dependencies [c92286c]
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/agent@1.1.16
  - @zhin.js/runtime@1.0.14
  - @zhin.js/core@1.5.14
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/ai@1.5.7
  - @zhin.js/logger@1.0.77
  - @zhin.js/html-renderer@3.0.14
  - @zhin.js/speech@3.0.14
  - @zhin.js/permission@1.0.4

## 6.0.13

### Patch Changes

- Updated dependencies [f2c532f]
- Updated dependencies [3dbf990]
  - @zhin.js/core@1.5.13
  - @zhin.js/agent@1.1.15
  - @zhin.js/runtime@1.0.13
  - @zhin.js/html-renderer@3.0.13
  - @zhin.js/speech@3.0.13

## 6.0.12

### Patch Changes

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 1312ca0: Replace the legacy mutable orchestration stack with the event-sourced Workroom Kernel.

  - `@zhin.js/agent` now exposes versioned Workroom events, pure replay/decision state transitions, CAS journals, and a read-only runtime projection. The public `OrchestrationService`, mutable repositories, `AgentDispatcher`, executor/workflow APIs, remote Agent registry/poller, old orchestration tools/constants, and five-agent workflow strategy are removed.
  - `zhin.js/agent` no longer exports the immediate-execution `runPipeline`, `runParallel`, or `route` helpers. Use `AIService.runAgent` for an ordinary one-shot model call; durable multi-Agent collaboration must enter a Workroom Plan and Assignment lifecycle.
  - `spawn_task` is now only an ordinary chat subtask facility. It no longer accepts Run/Task identifiers, creates Runs from IM sessions, dispatches remote tasks, or writes Workroom state.
  - `@zhin.js/ai` no longer owns IM Agent orchestration database models or the unused `ai.remoteAgents` configuration. Workroom persistence belongs to `@zhin.js/agent` as `workroom_events` or an atomic file journal.
  - The Workroom journal backend is fixed for the process lifetime. Changing `ai.sessions.useDatabase` requires a process restart; an unavailable selected database rejects generation activation instead of falling back to another authority.
  - The CLI exposes the read-only Project-scoped Console API at `/api/agent/workroom/runs`; the old `/api/agent/orchestration/runs` route is removed. No model-writable Workroom compatibility tools are published: future command adapters must hold an authenticated Project capability and dedicated Scheduler/Executor/Acceptance ports.
  - The Console client now queries Workroom Runs by `projectId` and renders the replayed Task revision/attempt state. `registerOrchestrationConsole`, `OrchestrationRunsPage`, and `/console/orchestration` are removed in favor of the Workroom-named surface.

  Execution completion and acceptance are separate durable facts. All writes use `append(runId, expectedSequence, events)`; no mutable Task projection can act as a second authority.

- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [d336a3f]
- Updated dependencies [0c82a7e]
- Updated dependencies [b9217e4]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [63d89f9]
- Updated dependencies [71c7cdd]
- Updated dependencies [3cca0ea]
- Updated dependencies [1312ca0]
- Updated dependencies [985fa22]
- Updated dependencies [04b861d]
- Updated dependencies [a23d544]
- Updated dependencies [8cddabf]
- Updated dependencies [dbe5081]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/runtime@1.0.13
  - @zhin.js/core@1.5.12
  - @zhin.js/agent@1.1.14
  - @zhin.js/ai@1.5.6
  - @zhin.js/permission@1.0.3
  - @zhin.js/html-renderer@3.0.12
  - @zhin.js/speech@3.0.12

## 6.0.11

### Patch Changes

- @zhin.js/core@1.5.11
- @zhin.js/agent@1.1.13
- @zhin.js/html-renderer@3.0.11
- @zhin.js/speech@3.0.11

## 6.0.10

### Patch Changes

- d3920e9: Extract the `handlers/` convention into a dedicated Feature package `@zhin.js/handler`, and mount it as a platform Stable Feature on `@zhin.js/core` (inherited by Roots via `platformFeatures` / `zhin runtime start`).

  Also add the `zhin.js/middleware` facade re-export so Stable Feature authoring is consistent with `zhin.js/command` / `adapter` / `component` / `handler`.

  `@zhin.js/feature-kit` is now kit-only: handler authoring, `HandlerIndex`, and the Feature provider entry are removed. Do not list `@zhin.js/feature-kit` in `zhin.features`.

  **Authoring:** apps and plugins that depend on `zhin.js` should import `definePlugin` from the main entry (`zhin.js`) and other `define*` from facade subpaths (`zhin.js/command`, `zhin.js/middleware`, `zhin.js/handler`, `zhin.js/adapter`, `zhin.js/component`) — do not separately install `@zhin.js/plugin-runtime` or the `@zhin.js/*` Feature implementation packages. Workspace plugins/examples/adapters were updated accordingly (imports + deps; child plugins keep `zhin.features` mounts and peer `zhin.js`). CLI `zhin new` / migrate cutover scaffolds follow the same rule.

  BREAKING CHANGE: `@zhin.js/feature-kit` no longer exports handler APIs and is no longer a `type: "feature"` package.

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - @zhin.js/runtime@1.0.12
  - @zhin.js/agent@1.1.11
  - @zhin.js/html-renderer@3.0.10
  - @zhin.js/speech@3.0.10

## 6.0.9

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/runtime@1.0.11
  - @zhin.js/agent@1.1.10
  - @zhin.js/core@1.5.9
  - @zhin.js/ai@1.5.4
  - @zhin.js/html-renderer@3.0.9
  - @zhin.js/speech@3.0.9

## 6.0.8

### Patch Changes

- 8e973dc: Delete the classic Node bootstrap and its entire unreachable setup graph. `zhin.js/node`, `bootstrapNode`, classic endpoint/config/service assembly, legacy signal handling, and the duplicate database log transport are no longer published or compiled.

  BREAKING CHANGE: applications must start through `zhin runtime start`; there is no compatibility stub or classic Host bootstrap subpath.

- Updated dependencies [63253bb]
- Updated dependencies [6fb24dd]
- Updated dependencies [d162216]
- Updated dependencies [7427818]
- Updated dependencies [90da255]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/runtime@1.0.10
  - @zhin.js/core@1.5.8
  - @zhin.js/agent@1.1.9
  - @zhin.js/ai@1.5.3
  - @zhin.js/permission@1.0.2
  - @zhin.js/html-renderer@3.0.8
  - @zhin.js/speech@3.0.8

## 6.0.7

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7
  - @zhin.js/agent@1.1.8
  - @zhin.js/html-renderer@3.0.7
  - @zhin.js/speech@3.0.7

## 6.0.6

### Patch Changes

- Updated dependencies [7945544]
  - @zhin.js/agent@1.1.7
  - @zhin.js/core@1.5.6
  - @zhin.js/runtime@1.0.9
  - @zhin.js/html-renderer@3.0.6
  - @zhin.js/speech@3.0.6

## 6.0.5

### Patch Changes

- @zhin.js/core@1.5.5
- @zhin.js/runtime@1.0.9
- @zhin.js/agent@1.1.6
- @zhin.js/html-renderer@3.0.5
- @zhin.js/speech@3.0.5

## 6.0.4

### Patch Changes

- ba08a2f: refactor(zhin): replace PermissionFeature with createPermissionHost

  Zhin entry point now creates a standalone PermissionHost and passes it to
  the message dispatcher, removing the legacy PermissionFeature registration.
  Command permit checks are unified through the new permission system.

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

- Updated dependencies [6f9c366]
- Updated dependencies [373a56b]
- Updated dependencies [0de46a8]
- Updated dependencies [c106ecc]
- Updated dependencies [b0f37ae]
- Updated dependencies [c50aca3]
- Updated dependencies [b08f7fe]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [a9fa72e]
- Updated dependencies [c8de3ef]
- Updated dependencies [60f0fc8]
- Updated dependencies [574c990]
- Updated dependencies [d096f16]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [d047869]
- Updated dependencies [162fa34]
- Updated dependencies [e62561e]
- Updated dependencies [3eeeb46]
- Updated dependencies [85d0f82]
- Updated dependencies [61bfc1c]
- Updated dependencies [04bad47]
- Updated dependencies [e40b048]
- Updated dependencies [5a5b1bb]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [7123c47]
- Updated dependencies [05befc1]
- Updated dependencies [0663b6a]
- Updated dependencies [f28f9b3]
- Updated dependencies [9f340f7]
- Updated dependencies [e53444f]
- Updated dependencies [5eedd26]
- Updated dependencies [92b0dd7]
- Updated dependencies [f919b6f]
- Updated dependencies [098e411]
- Updated dependencies [e1b7c01]
- Updated dependencies [9b94f87]
- Updated dependencies [a7df753]
  - @zhin.js/agent@1.1.5
  - @zhin.js/permission@1.0.1
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - @zhin.js/ai@1.5.2
  - @zhin.js/runtime@1.0.9
  - @zhin.js/html-renderer@3.0.4
  - @zhin.js/speech@3.0.4

## 6.0.3

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/agent@1.1.4
  - @zhin.js/ai@1.5.1
  - @zhin.js/core@1.5.3
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/runtime@1.0.8
  - @zhin.js/html-renderer@3.0.3
  - @zhin.js/speech@3.0.3

## 6.0.2

### Patch Changes

- Updated dependencies [afc0e66]
- Updated dependencies [2e41ad5]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/agent@1.1.3
  - @zhin.js/html-renderer@3.0.2
  - @zhin.js/speech@3.0.2
  - @zhin.js/runtime@1.0.7

## 6.0.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/agent@1.1.1
  - @zhin.js/core@1.5.1
  - @zhin.js/runtime@1.0.6
  - @zhin.js/html-renderer@3.0.1
  - @zhin.js/speech@3.0.1

## 6.0.0

### Patch Changes

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0
  - @zhin.js/core@1.5.0
  - @zhin.js/agent@1.1.0
  - @zhin.js/runtime@1.0.5
  - @zhin.js/html-renderer@3.0.0
  - @zhin.js/speech@3.0.0

## 5.0.3

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3
  - @zhin.js/runtime@1.0.5
  - @zhin.js/agent@1.0.9
  - @zhin.js/html-renderer@2.0.3
  - @zhin.js/speech@2.0.3

## 5.0.2

### Patch Changes

- Updated dependencies [d5cd4aa]
  - @zhin.js/runtime@1.0.4
  - @zhin.js/core@1.4.2
  - @zhin.js/agent@1.0.7
  - @zhin.js/html-renderer@2.0.2
  - @zhin.js/speech@2.0.2

## 5.0.1

### Patch Changes

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 43485a9: 架构对齐修复（platformFeatures 继承落地）：

  - `zhin.js` 主包 `zhin.plugins` 清空：host-router/host-api 是 legacy 插件包（`usePlugin` 入口），经 graph 加载会崩溃；新 Runtime 的 Console 由 cli 装配，门面保持纯 re-export。
  - `@zhin.js/runtime` package-resolver：`declaredDependency` 接受 `peerDependencies`（optional peer 是合法声明，未安装时由 `optional` 引用容错）。
  - `@zhin.js/cli` PackageCutover 检查器适配继承形态：依赖 zhin.js/core 时 manifest `features` 可省略 command/component/middleware（platformFeatures 继承），不再误报 blocked。
  - 文档：新增 `docs/architecture/package-topology.md`（包结构依赖图与各层 zhin 字段配置指南）。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [43485a9]
- Updated dependencies [f0ec5ab]
- Updated dependencies [8c7d03d]
- Updated dependencies [3e925d0]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/runtime@1.0.3
  - @zhin.js/agent@1.0.6
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/ai@1.4.6
  - @zhin.js/html-renderer@2.0.1
  - @zhin.js/speech@2.0.1
  - @zhin.js/core@1.4.1

## 5.0.0

### Patch Changes

- Updated dependencies [7db69c1]
- Updated dependencies [e5c84ed]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/host-router@3.0.0
  - @zhin.js/agent@1.0.5
  - @zhin.js/host-api@3.0.0
  - @zhin.js/html-renderer@2.0.0
  - @zhin.js/speech@2.0.0
  - @zhin.js/runtime@1.0.2

## 4.1.3

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
  - @zhin.js/agent@1.0.4
  - @zhin.js/logger@1.0.75
  - @zhin.js/host-api@2.0.6
  - @zhin.js/host-router@2.0.4
  - @zhin.js/html-renderer@1.0.4
  - @zhin.js/speech@1.0.4
  - @zhin.js/kernel@1.0.4
  - @zhin.js/runtime@1.0.1

## 4.1.2

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/agent@1.0.3
  - @zhin.js/core@1.3.4
  - @zhin.js/host-api@2.0.5
  - @zhin.js/host-router@2.0.3
  - @zhin.js/kernel@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/html-renderer@1.0.3
  - @zhin.js/speech@1.0.3

## 4.1.1

### Patch Changes

- 5cc9c03: fix: ai 优化
- 7700903: fix: 游戏强化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/kernel@1.0.2
  - @zhin.js/agent@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/logger@1.0.73
  - @zhin.js/schema@1.0.71
  - @zhin.js/host-api@2.0.4
  - @zhin.js/host-router@2.0.2
  - @zhin.js/html-renderer@1.0.2
  - @zhin.js/speech@1.0.2

## 4.1.0

### Minor Changes

- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/host-router@2.0.1
  - @zhin.js/host-api@2.0.3
  - @zhin.js/agent@1.0.1
  - @zhin.js/core@1.3.2
  - @zhin.js/logger@1.0.72
  - @zhin.js/speech@1.0.1
  - @zhin.js/html-renderer@1.0.1
  - @zhin.js/kernel@1.0.1

## 4.0.1

### Patch Changes

- ae5239c: fix: 核心包瘦身
- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/agent@0.3.1
  - @zhin.js/core@1.3.1
  - @zhin.js/host-api@2.0.1
  - @zhin.js/host-router@2.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/ai@1.3.0
  - @zhin.js/agent@0.3.0
  - @zhin.js/core@1.3.0
  - @zhin.js/host-api@2.0.0
  - @zhin.js/host-router@2.0.0

## 2.0.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/host-router@1.0.1
  - @zhin.js/host-api@1.0.1
  - @zhin.js/agent@0.2.1
  - @zhin.js/core@1.2.1
  - @zhin.js/ai@1.2.1
  - @zhin.js/logger@0.1.71
  - @zhin.js/kernel@0.1.1

## 2.0.0

### Patch Changes

- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/kernel@0.1.0
  - @zhin.js/core@1.2.0
  - @zhin.js/ai@1.2.0
  - @zhin.js/agent@0.2.0
  - @zhin.js/host-api@1.0.0
  - @zhin.js/host-router@1.0.0

## 1.0.92

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/kernel@0.0.50
  - @zhin.js/agent@0.1.31
  - @zhin.js/core@1.1.33
  - @zhin.js/ai@1.1.31
  - @zhin.js/host-router@0.0.3

## 1.0.91

### Patch Changes

- 3735e96: fix: 智能家居控制
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/kernel@0.0.49
  - @zhin.js/host-api@0.0.4
  - @zhin.js/agent@0.1.30
  - @zhin.js/core@1.1.32
  - @zhin.js/ai@1.1.30
  - @zhin.js/host-router@0.0.3

## 1.0.90

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
- Updated dependencies [c8f8207]
  - @zhin.js/logger@0.1.70
  - @zhin.js/schema@1.0.70
  - @zhin.js/host-api@0.0.3
  - @zhin.js/host-router@0.0.3
  - @zhin.js/agent@0.1.29
  - @zhin.js/ai@1.1.29
  - @zhin.js/core@1.1.31
  - @zhin.js/kernel@0.0.48

## 1.0.89

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/host-router@0.0.2
  - @zhin.js/kernel@0.0.47
  - @zhin.js/agent@0.1.28
  - @zhin.js/core@1.1.30
  - @zhin.js/ai@1.1.28
  - @zhin.js/host-api@0.0.2

## 1.0.88

### Patch Changes

- ccb6e24: fix: zhin.js 瘦身

## 1.0.87

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/schema@1.0.69
  - @zhin.js/core@1.1.29
  - @zhin.js/agent@0.1.27
  - @zhin.js/ai@1.1.27
  - @zhin.js/kernel@0.0.46
  - @zhin.js/host-api@0.0.1
  - @zhin.js/host-router@0.0.1

## 1.0.86

### Patch Changes

- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/agent@0.1.26
  - @zhin.js/core@1.1.28
  - @zhin.js/logger@0.1.68
  - @zhin.js/schema@1.0.68
  - @zhin.js/ai@1.1.26
  - @zhin.js/host-router-host@0.1.4
  - @zhin.js/kernel@0.0.45
  - @zhin.js/queue-runtime@0.0.4
  - @zhin.js/storage-port@0.0.2
  - @zhin.js/adapter-sandbox@3.0.5
  - @zhin.js/console@3.0.5
  - @zhin.js/host-router@1.0.79

## 1.0.85

### Patch Changes

- Updated dependencies [b0e0a71]
  - @zhin.js/agent@0.1.25
  - @zhin.js/logger@0.1.67
  - @zhin.js/schema@1.0.67
  - @zhin.js/adapter-sandbox@3.0.4
  - @zhin.js/console@3.0.4
  - @zhin.js/host-router@1.0.78
  - @zhin.js/core@1.1.27
  - @zhin.js/ai@1.1.25
  - @zhin.js/kernel@0.0.44
  - @zhin.js/queue-runtime@0.0.3

## 1.0.84

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/adapter-sandbox@3.0.3
  - @zhin.js/console@3.0.3
  - @zhin.js/host-router-host@0.1.3
  - @zhin.js/kernel@0.0.43
  - @zhin.js/agent@0.1.24
  - @zhin.js/core@1.1.26
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24
  - @zhin.js/schema@1.0.66
  - @zhin.js/queue-runtime@0.0.2
  - @zhin.js/storage-port@0.0.1
  - @zhin.js/host-router@1.0.77

## 1.0.83

### Breaking Changes

- **移除** `zhin.js/setup` 侧效入口。Node/Bun 请改用 `import { bootstrapNode } from 'zhin.js/node'`（CLI `zhin dev` / `zhin start` 已切换）。Edge（Deno Deploy、Vercel、Cloudflare Workers）请使用 `zhin.js/deno`、`zhin.js/vercel` 或 `zhin.js/cloudflare` 的 `bootstrap*()`。

### Patch Changes

- 775427e: fix: edge 支持
- 多运行时 bootstrap：`zhin.js/node`、`zhin.js/deno`、`zhin.js/vercel`、`zhin.js/cloudflare`；共享 `bootstrapEdgeCore`（Fetch HTTP、Console 子集、Sandbox SSE/WS）
- Updated dependencies [775427e]
  - @zhin.js/kernel@0.0.42
  - @zhin.js/agent@0.1.23
  - @zhin.js/core@1.1.25
  - @zhin.js/logger@0.1.65
  - @zhin.js/schema@1.0.65
  - @zhin.js/ai@1.1.23

## 1.0.82

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/schema@1.0.64
  - @zhin.js/agent@0.1.22
  - @zhin.js/ai@1.1.22
  - @zhin.js/core@1.1.24
  - @zhin.js/kernel@0.0.41

## 1.0.81

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/agent@0.1.21
  - @zhin.js/core@1.1.23
  - @zhin.js/ai@1.1.21
  - @zhin.js/logger@0.1.63
  - @zhin.js/schema@1.0.63
  - @zhin.js/kernel@0.0.40

## 1.0.80

### Patch Changes

- Updated dependencies [3b3e49b]
  - @zhin.js/agent@0.1.20
  - @zhin.js/logger@0.1.62
  - @zhin.js/schema@1.0.62
  - @zhin.js/core@1.1.22
  - @zhin.js/ai@1.1.20
  - @zhin.js/kernel@0.0.39

## 1.0.79

### Patch Changes

- Updated dependencies [92da96d]
  - @zhin.js/agent@0.1.19
  - @zhin.js/logger@0.1.61
  - @zhin.js/schema@1.0.61
  - @zhin.js/core@1.1.21
  - @zhin.js/ai@1.1.19
  - @zhin.js/kernel@0.0.38

## 1.0.78

### Patch Changes

- Updated dependencies [88caeb2]
  - @zhin.js/agent@0.1.18
  - @zhin.js/core@1.1.20
  - @zhin.js/logger@0.1.60
  - @zhin.js/schema@1.0.60
  - @zhin.js/ai@1.1.18
  - @zhin.js/kernel@0.0.37

## 1.0.77

### Patch Changes

- Updated dependencies [fcad030]
  - @zhin.js/agent@0.1.17
  - @zhin.js/ai@1.1.17
  - @zhin.js/core@1.1.19
  - @zhin.js/logger@0.1.59
  - @zhin.js/schema@1.0.59
  - @zhin.js/kernel@0.0.36

## 1.0.76

### Patch Changes

- cb9fbf1: fix: ai 增强
- Updated dependencies [cb9fbf1]
  - @zhin.js/agent@0.1.16
  - @zhin.js/ai@1.1.16
  - @zhin.js/logger@0.1.58
  - @zhin.js/schema@1.0.58
  - @zhin.js/core@1.1.18
  - @zhin.js/kernel@0.0.35

## 1.0.75

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/agent@0.1.15
  - @zhin.js/core@1.1.17
  - @zhin.js/logger@0.1.57
  - @zhin.js/schema@1.0.57
  - @zhin.js/kernel@0.0.34

## 1.0.74

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/kernel@0.0.33
  - @zhin.js/agent@0.1.14
  - @zhin.js/core@1.1.16
  - @zhin.js/ai@1.1.14
  - @zhin.js/logger@0.1.56
  - @zhin.js/schema@1.0.56

## 1.0.73

### Patch Changes

- Updated dependencies [63d0b88]
  - @zhin.js/agent@0.1.13
  - @zhin.js/logger@0.1.55
  - @zhin.js/schema@1.0.55
  - @zhin.js/core@1.1.15
  - @zhin.js/ai@1.1.13
  - @zhin.js/kernel@0.0.32

## 1.0.72

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/logger@0.1.54
  - @zhin.js/schema@1.0.54
  - @zhin.js/agent@0.1.12
  - @zhin.js/ai@1.1.12
  - @zhin.js/core@1.1.14
  - @zhin.js/kernel@0.0.31

## 1.0.71

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53
  - @zhin.js/agent@0.1.11
  - @zhin.js/ai@1.1.11
  - @zhin.js/core@1.1.13
  - @zhin.js/kernel@0.0.30

## 1.0.70

### Patch Changes

- Updated dependencies [bcd56d5]
  - @zhin.js/logger@0.1.53
  - @zhin.js/schema@1.0.53
  - @zhin.js/core@1.1.12
  - @zhin.js/ai@1.1.11
  - @zhin.js/kernel@0.0.30
  - @zhin.js/agent@0.1.11

## 1.0.69

### Patch Changes

- Updated dependencies [7b0227a]
  - @zhin.js/core@1.1.11
  - @zhin.js/agent@0.1.11

## 1.0.68

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/agent@0.1.10
  - @zhin.js/logger@0.1.52
  - @zhin.js/schema@1.0.52
  - @zhin.js/ai@1.1.10
  - @zhin.js/kernel@0.0.29

## 1.0.67

### Patch Changes

- Updated dependencies [0eba6d6]
  - @zhin.js/agent@0.1.9
  - @zhin.js/core@1.1.9
  - @zhin.js/ai@1.1.9
  - @zhin.js/logger@0.1.51
  - @zhin.js/schema@1.0.51
  - @zhin.js/kernel@0.0.28

## 1.0.66

### Patch Changes

- Updated dependencies [9aa08c3]
  - @zhin.js/agent@0.1.8
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8
  - @zhin.js/logger@0.1.50
  - @zhin.js/schema@1.0.50
  - @zhin.js/kernel@0.0.27

## 1.0.65

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/agent@0.1.7
  - @zhin.js/core@1.1.7
  - @zhin.js/logger@0.1.49
  - @zhin.js/schema@1.0.49
  - @zhin.js/kernel@0.0.26

## 1.0.64

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/logger@0.1.48
  - @zhin.js/schema@1.0.48
  - @zhin.js/agent@0.1.6
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6
  - @zhin.js/kernel@0.0.25

## 1.0.63

### Patch Changes

- Updated dependencies [ba30934]
  - @zhin.js/agent@0.1.5
  - @zhin.js/logger@0.1.47
  - @zhin.js/schema@1.0.47
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5
  - @zhin.js/kernel@0.0.24

## 1.0.62

### Patch Changes

- Updated dependencies [bf0dc75]
  - @zhin.js/agent@0.1.4
  - @zhin.js/logger@0.1.46
  - @zhin.js/schema@1.0.46
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4
  - @zhin.js/kernel@0.0.23

## 1.0.61

### Patch Changes

- Updated dependencies [a257f3f]
  - @zhin.js/agent@0.1.3
  - @zhin.js/logger@0.1.45
  - @zhin.js/schema@1.0.45
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3
  - @zhin.js/kernel@0.0.22

## 1.0.60

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
  - @zhin.js/agent@0.1.2
  - @zhin.js/core@1.1.2
  - @zhin.js/logger@0.1.44
  - @zhin.js/schema@1.0.44
  - @zhin.js/ai@1.1.2

## 1.0.59

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/logger@0.1.43
  - @zhin.js/schema@1.0.43
  - @zhin.js/agent@0.1.1
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1
  - @zhin.js/kernel@0.0.20

## 1.0.58

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/agent@0.1.0
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0
  - @zhin.js/logger@0.1.42
  - @zhin.js/schema@1.0.42
  - @zhin.js/kernel@0.0.19

## 1.0.57

### Patch Changes

- Updated dependencies [c606a57]
  - @zhin.js/agent@0.0.20
  - @zhin.js/core@1.0.57
  - @zhin.js/logger@0.1.41
  - @zhin.js/schema@1.0.41
  - @zhin.js/ai@1.0.18
  - @zhin.js/kernel@0.0.18

## 1.0.56

### Patch Changes

- Updated dependencies [20ab379]
  - @zhin.js/agent@0.0.19
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56
  - @zhin.js/logger@0.1.40
  - @zhin.js/schema@1.0.40
  - @zhin.js/kernel@0.0.17

## 1.0.55

### Patch Changes

- Updated dependencies [75709e1]
  - @zhin.js/agent@0.0.18
  - @zhin.js/core@1.0.55
  - @zhin.js/logger@0.1.39
  - @zhin.js/schema@1.0.39
  - @zhin.js/ai@1.0.16
  - @zhin.js/kernel@0.0.16

## 1.0.54

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/logger@0.1.38
  - @zhin.js/schema@1.0.38
  - @zhin.js/agent@0.0.17
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54
  - @zhin.js/kernel@0.0.15

## 1.0.53

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/agent@0.0.16
- @zhin.js/logger@0.1.37
- @zhin.js/schema@1.0.37
- @zhin.js/ai@1.0.14
- @zhin.js/kernel@0.0.14

## 1.0.52

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- bb6bfa8: feat: 技能全面文件化——仓库内插件/适配器使用 `skills/<name>/SKILL.md`；Core 已移除 `plugin.declareSkill` / `Adapter.declareSkill` API
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/agent@0.0.15
  - @zhin.js/logger@0.1.36
  - @zhin.js/schema@1.0.36
  - @zhin.js/ai@1.0.13
  - @zhin.js/kernel@0.0.13

## 1.0.51

### Patch Changes

- Updated dependencies [607acc4]
  - @zhin.js/agent@0.0.14
  - @zhin.js/logger@0.1.35
  - @zhin.js/schema@1.0.35
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12
  - @zhin.js/kernel@0.0.12

## 1.0.50

### Patch Changes

- Updated dependencies [2510365]
  - @zhin.js/agent@0.0.13
  - @zhin.js/logger@0.1.34
  - @zhin.js/schema@1.0.34
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11
  - @zhin.js/kernel@0.0.11

## 1.0.49

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/kernel@0.0.10
  - @zhin.js/core@1.0.49
  - @zhin.js/agent@0.0.12
  - @zhin.js/logger@0.1.33
  - @zhin.js/schema@1.0.33
  - @zhin.js/ai@1.0.10

## 1.0.48

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/kernel@0.0.9
  - @zhin.js/core@1.0.48
  - @zhin.js/agent@0.0.11
  - @zhin.js/logger@0.1.32
  - @zhin.js/schema@1.0.32
  - @zhin.js/ai@1.0.9

## 1.0.47

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/agent@0.0.10
  - @zhin.js/core@1.0.47
  - @zhin.js/logger@0.1.31
  - @zhin.js/schema@1.0.31
  - @zhin.js/ai@1.0.8
  - @zhin.js/kernel@0.0.8

## 1.0.46

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/agent@0.0.9
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46
  - @zhin.js/logger@0.1.30
  - @zhin.js/schema@1.0.30
  - @zhin.js/kernel@0.0.7

## 1.0.45

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6
  - @zhin.js/agent@0.0.8
  - @zhin.js/logger@0.1.29
  - @zhin.js/schema@1.0.29
  - @zhin.js/kernel@0.0.6

## 1.0.44

### Patch Changes

- Updated dependencies [4f2fb55]
  - @zhin.js/agent@0.0.7
  - @zhin.js/logger@0.1.28
  - @zhin.js/schema@1.0.28
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5
  - @zhin.js/kernel@0.0.5

## 1.0.43

### Patch Changes

- 72ec4ba: fix: 新增插件,控制台调优
- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/agent@0.0.6
  - @zhin.js/logger@0.1.27
  - @zhin.js/schema@1.0.27
  - @zhin.js/ai@1.0.4
  - @zhin.js/kernel@0.0.4

## 1.0.42

### Patch Changes

- Updated dependencies [0999ca6]
  - @zhin.js/agent@0.0.5
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42
  - @zhin.js/logger@0.1.26
  - @zhin.js/schema@1.0.26
  - @zhin.js/kernel@0.0.3

## 1.0.41

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/agent@0.0.4
  - @zhin.js/logger@0.1.25
  - @zhin.js/schema@1.0.25
  - @zhin.js/ai@1.0.2
  - @zhin.js/kernel@0.0.2

## 1.0.40

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/agent@0.0.3
  - @zhin.js/core@1.0.40
  - @zhin.js/logger@0.1.24
  - @zhin.js/schema@1.0.24
  - @zhin.js/ai@1.0.1
  - @zhin.js/kernel@0.0.1

## 1.0.39

### Patch Changes

- Updated dependencies [04f76ac]
  - @zhin.js/agent@0.0.2
  - @zhin.js/core@1.0.39
  - @zhin.js/logger@0.1.23
  - @zhin.js/schema@1.0.23

## 1.0.38

### Patch Changes

- ab5c54a: fix: ai 架构优化
- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
  - @zhin.js/agent@0.0.1
  - @zhin.js/logger@0.1.22
  - @zhin.js/schema@1.0.22

## 1.0.37

### Patch Changes

- Updated dependencies [a8ce720]
  - @zhin.js/core@1.0.37
  - @zhin.js/logger@0.1.21
  - @zhin.js/schema@1.0.21

## 1.0.36

### Patch Changes

- Updated dependencies [6d94111]
  - @zhin.js/core@1.0.36
  - @zhin.js/logger@0.1.20
  - @zhin.js/schema@1.0.20

## 1.0.35

### Patch Changes

- Updated dependencies [8502351]
  - @zhin.js/core@1.0.35
  - @zhin.js/logger@0.1.19
  - @zhin.js/schema@1.0.19

## 1.0.34

### Patch Changes

- Updated dependencies [634e2d7]
  - @zhin.js/core@1.0.34
  - @zhin.js/logger@0.1.18
  - @zhin.js/schema@1.0.18

## 1.0.33

### Patch Changes

- Updated dependencies [4abae79]
  - @zhin.js/core@1.0.33
  - @zhin.js/logger@0.1.17
  - @zhin.js/schema@1.0.17

## 1.0.32

### Patch Changes

- Updated dependencies [10d8bdc]
  - @zhin.js/core@1.0.32
  - @zhin.js/logger@0.1.16
  - @zhin.js/schema@1.0.16

## 1.0.31

### Patch Changes

- Updated dependencies [771706d]
  - @zhin.js/core@1.0.31
  - @zhin.js/logger@0.1.15
  - @zhin.js/schema@1.0.15

## 1.0.30

### Patch Changes

- 460a6c6: fix: unhandleRejection
  - @zhin.js/logger@0.1.14
  - @zhin.js/schema@1.0.14
  - @zhin.js/core@1.0.30

## 1.0.29

### Patch Changes

- Updated dependencies [4ec9176]
  - @zhin.js/core@1.0.29
  - @zhin.js/logger@0.1.13
  - @zhin.js/schema@1.0.13

## 1.0.28

### Patch Changes

- Updated dependencies [05a514d]
  - @zhin.js/core@1.0.28
  - @zhin.js/logger@0.1.12
  - @zhin.js/schema@1.0.12

## 1.0.27

### Patch Changes

- b27e633: fix: cli 优化
- Updated dependencies [b27e633]
  - @zhin.js/core@1.0.27
  - @zhin.js/logger@0.1.11
  - @zhin.js/schema@1.0.11

## 1.0.26

### Patch Changes

- 106d357: fix: ai
- Updated dependencies [106d357]
  - @zhin.js/core@1.0.26
  - @zhin.js/logger@0.1.10
  - @zhin.js/schema@1.0.10

## 1.0.25

### Patch Changes

- 26d2942: fix: ai
- 6b02c41: fix: ai
- Updated dependencies [26d2942]
- Updated dependencies [6b02c41]
  - @zhin.js/ai@0.0.2
  - @zhin.js/logger@0.1.9
  - @zhin.js/schema@1.0.9
  - @zhin.js/core@1.0.25

## 1.0.24

### Patch Changes

- Updated dependencies [6108e5d]
  - @zhin.js/core@1.0.24
  - @zhin.js/logger@0.1.8
  - @zhin.js/schema@1.0.8

## 1.0.23

### Patch Changes

- 52ae08a: fix: 更新消息处理流程
- Updated dependencies [52ae08a]
  - @zhin.js/core@1.0.23
  - @zhin.js/logger@0.1.7
  - @zhin.js/schema@1.0.7

## 1.0.22

### Patch Changes

- 26aba27: fix: error default config
  - @zhin.js/logger@0.1.6
  - @zhin.js/schema@1.0.6
  - @zhin.js/core@1.0.22

## 1.0.21

### Patch Changes

- Updated dependencies [3960e70]
  - @zhin.js/core@1.0.21
  - @zhin.js/logger@0.1.5
  - @zhin.js/schema@1.0.5

## 1.0.20

### Patch Changes

- 5141137: fix: 修复适配器读取配置 bug
- Updated dependencies [a3b7673]
- Updated dependencies [5141137]
  - @zhin.js/logger@0.1.4
  - @zhin.js/schema@1.0.4
  - @zhin.js/core@1.0.20

## 1.0.19

### Patch Changes

- f9faa1d: fix: test release
- Updated dependencies [f9faa1d]
  - @zhin.js/logger@0.1.3
  - @zhin.js/schema@1.0.3
  - @zhin.js/core@1.0.19

## 1.0.18

### Patch Changes

- d16a69c: fix: test trust publish
- Updated dependencies [d16a69c]
  - @zhin.js/logger@0.1.2
  - @zhin.js/schema@1.0.2
  - @zhin.js/core@1.0.18

## 1.0.17

### Patch Changes

- Updated dependencies [3bc5d56]
  - @zhin.js/core@1.0.17

## 1.0.16

### Patch Changes

- Updated dependencies [e733fab]
  - @zhin.js/core@1.0.16

## 1.0.15

### Patch Changes

- Updated dependencies [f9e75ce]
- Updated dependencies [e783f90]
- Updated dependencies [f9e75ce]
  - @zhin.js/core@1.0.15

## 1.0.14

### Patch Changes

- Updated dependencies [547028f]
  - @zhin.js/core@1.0.14

## 1.0.13

### Patch Changes

- Updated dependencies [a2e1ebc]
  - @zhin.js/core@1.0.13

## 1.0.12

### Patch Changes

- Updated dependencies [ff5a7ed]
  - @zhin.js/core@1.0.12

## 1.0.11

### Patch Changes

- @zhin.js/core@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [c8c3996]
  - @zhin.js/logger@0.1.1
  - @zhin.js/core@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [c490260]
  - @zhin.js/core@1.0.9

## 1.0.8

### Patch Changes

- 551c4d2: fix: 插件支持配置文件读取,优化 test 用例
- Updated dependencies [551c4d2]
  - @zhin.js/core@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [47845fb]
  - @zhin.js/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [c2d9047]
- Updated dependencies [c2d9047]
  - @zhin.js/core@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [f347667]
  - @zhin.js/core@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [15be776]
  - @zhin.js/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [89bc676]
  - @zhin.js/core@1.0.3

## 1.0.2

### Patch Changes

- 15fc934: fix: 支持 jsx
- Updated dependencies [15fc934]
- Updated dependencies [3ecd487]
  - @zhin.js/core@1.0.2

## 1.0.1

### Patch Changes

- efdd58a: fix: init
- Updated dependencies [efdd58a]
  - @zhin.js/core@1.0.1
