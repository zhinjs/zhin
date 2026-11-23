# @zhin.js/console-protocol

## 1.9.0

### Minor Changes

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

- 58ce469: #1250 第 80 批：小型去重，统一多轨实现。

  - **重试、退避与可中断等待**：`@zhin.js/plugin-runtime` 新增 `sleep(ms, signal?)`（中止时清理计时器并以 `signal.reason` 拒绝）、`parseRetryAfterMs()`（解析秒数与 HTTP 日期：接受小数秒、`.5`、`5.` 与前导 `+`；负数、`1e3`、`0x10` 等非法值返回 `undefined`，AI 路径遇到这类值退回普通退避）和 `computeBackoffDelay()`（指数退避，默认等量抖动，可选对称抖动比例），插件经 `zhin.js` 导入。AI Provider 重试、OAuth 刷新冷却、适配器启动重试、地震与网络工具插件的 HTTP 重试、B 站直播 / QQ 扫码 / Telegram 轮询 / 微信 iLink 的等待全部改用它们；`@zhin.js/kernel` 删除不支持中止的 `sleep`，`@zhin.js/ai` 不再导出 `computeBackoffDelay` / `parseRetryAfterMs`，地震、网络工具和微信 iLink 插件不再导出各自的副本。
  - **HTML 转义**：`@zhin.js/plugin-runtime` 新增 `escapeHtml()`（转义 `& < > " '`），AI 输出、Console 页面外壳、`segment.escape`、链接海报和日历回调页改用它；`@zhin.js/pagemanager` 不再导出自己的 `escapeHtml`。`@zhin.js/jsx` 因只依赖 IM 契约保留同一实现，由契约测试锁定一致。
  - **`MarkdownView`**：`@zhin.js/components` 的 `Markdown` 组件改名为 `MarkdownView`（`MarkdownProps` → `MarkdownViewProps`，主题组件名同步），与 `zhin.js/jsx` 输出 Markdown 消息段的 `Markdown` 标签区分，不保留旧名。
  - **会话键**：`@zhin.js/console-protocol` 新增四段会话键 `parseConversationSessionKey()` / `formatConversationSessionKey()` / `isHashedSessionKey()`，网关用量统计（`parseSessionKey` 改名为 `sessionAddressOf`；endpoint 段为空的会话键照常解析，三段键只给出 platform）、实例的聊天记录与收件箱校验、沙盒页面都改用它。功能会话键在 plugin-runtime 与 console-protocol 中各保留一份（两者都是零依赖契约），由契约测试锁定语法、转义与错误文案一致。
  - **聊天角色导出格式**：`@zhin.js/console-protocol` 新增 `CHAT_ROLES_EXPORT_FORMAT`、`CHAT_ROLES_EXPORT_VERSION`、`CHAT_ROLES_BACKUP_DIRECTORY_SEGMENTS`、`chatRolesBackupFileName()` 与 `isConsoleChatRolesExport()`，`zhin chat-roles export|import` 与实例的导出、导入和迁移前备份共用；实例导入现在与 CLI 一样要求四个列表都存在。

## 1.8.0

### Minor Changes

- 19eeb90: 网关新增只读版本检查 RPC `gateway.version.check`（zhinjs/console#64 version-update），供 Console 显示当前版本与「有新版本」提示。

  - 报告 `zhin.js`、`@zhin.js/gateway`、`@zhin.js/console-*` 与已安装的 `@zhin.js/*` 插件（`package.json#zhin.type: "plugin"`）：每行 `name` / `range` / `installed` / `latest` / `wanted`（声明范围内的最高版本）/ `latestInRange` / `updateAvailable` / `needsMigrate`，外加 `gateway`（运行中的网关版本）、`checkedAt`、`registryReachable`、`truncated`、`incomplete`（到截止时间还有包没查，这些行 `latest: null`，与 `registryReachable: false` 区分）。核心行固定按 `zhin.js` → `@zhin.js/gateway` → `@zhin.js/console-*` 排列。插件超过 64 个时 `truncated` 为 true，`zhin.js`、`@zhin.js/gateway` 与 `@zhin.js/console-*` 仍留在报告里。网关不是项目直接依赖时也单列一行（`range: null`）。
  - 权限 `status.view`（与实例状态相同），已登记到 `GATEWAY_RPC_PERMISSIONS` / `CONSOLE_RPC_PERMISSIONS`。由网关自己回答，实例停止时也可用。
  - 在项目根目录执行 `npm view <包> dist-tags versions --json`，沿用项目的 npm 配置（`.npmrc`、镜像）；结果在内存缓存约 6 小时，失败的查询 10 分钟后重试，单次超时 5 秒，整次查询（含第一次探测）不超过约 8 秒（留在 Console 默认 10 秒请求超时之内）：每次查询的超时取单次超时与剩余时间中较短的一个，截止前一直可以开始新查询；到点就返回已经查到的结果，来不及查的为 `latest: null` 并标 `incomplete`。因截止被缩短而失败的查询不记作 registry 失败、不进失败缓存。先探测一个包，registry 不可达时其余包不再逐个等超时。离线、超时都得到 `latest: null` 与 `registryReachable: false`，从不报错；没有新增配置开关。
  - 只报告不升级：超出声明范围的新版本标为 `needsMigrate`，Console 只提示 `npx zhin migrate --dry-run`（新导出常量 `GATEWAY_VERSION_MIGRATE_COMMAND`），框架升级仍只走 `zhin migrate`（ADR 0062）。
  - `@zhin.js/console-protocol` 新增 `GATEWAY_VERSION_RPC`、类型 `GatewayVersionReport` / `GatewayVersionPackage`。`@zhin.js/gateway` 新增公开导出 `GatewayVersionChecker`、`classifyPackageVersion()`、`isVersionCheckedPackage()`、`parseNpmViewVersions()`、`npmViewRegistryFetcher`（/packages），`GatewayPackageService` 新增 `inventory()`（不做授权的依赖清单，供已自行授权的网关服务使用）；网关新增依赖 `semver`。
  - 文档：Console「运维」页（中英文）补充「版本」说明，CLI 文档的 `migrate` 小节加锚点 `#migrate`。

## 1.7.0

### Minor Changes

- c7f6285: 定时任务可以指定由哪个 Agent 执行（#1250 第 52 批 `schedule-agent-no-creation-path`）。运行时早已支持 `action.agent`，但没有任何入口能设置它，只能停服改数据库 `agent_schedule_jobs.agent`。不指定 Agent 时行为不变（默认 `zhin`）。

  - CLI：`zhin schedule add --agent <名称>`；新增 `zhin schedule set-agent <id> <名称>` 与 `set-agent <id> --clear`（恢复默认）。`zhin schedule list` 每个任务多一行 `Agent:`（未指定时为「zhin（默认）」）。
  - 实例接口：`POST /api/assistant/jobs` 接受可选 `agent`；新增 `POST /api/assistant/jobs/set-agent`（`{ id, agent }`，`agent: null` 清除）。名称必须是已配置的 Agent（`zhin` 与 `ai.agents` 的键），否则 400 `schedule_agent_not_found`，错误里列出可用的 Agent；心跳任务不能指定 Agent。权限沿用 `ops.schedule.write`。`GET /api/assistant/jobs` 新增 `agents`（可用的 Agent 名称）。
  - Console RPC：`cron:add` 接受可选 `agent`（同样校验）；新增 `cron:set-agent`（`ops.schedule.write`，已登记到 `CONSOLE_RPC_PERMISSIONS`）；`schedule:list` 的持久化任务行新增 `agent`，返回值新增 `agents`。`ConsoleScheduleEngine` 新增可选 `listAgents()` / `setJobAgent()`。
  - 对话工具：`schedule_add` 新增可选参数 `agent`，`schedule_list` 的持久化任务带 `agent`。聊天里只能指定当前会话里自己能用的 Agent：与 `@名称` 点名时的可见范围相同（Agent 包的 `platforms` / `scopes` / `permissions` 过滤），外加默认的 `zhin`；看不到的 Agent 与不存在的一样被拒绝。不在运行时回合内调用（如外部工具协议）时只接受默认 Agent。
  - `@zhin.js/agent`：`AgentTurnConfiguration` 新增可选 `availableAgents`（回合内可见的专家 Agent 名称）；`TimerScheduler` 新增 `setJobAgent()`；`AssistantRuntimeHandle.jobs` 新增可选 `agents()` / `setAgent()`；`ScheduleManager` 新增可选 `agents`；`ScheduleAddInput` 新增可选 `agent`。
  - `set-agent`（CLI / `POST /api/assistant/jobs/set-agent` / `cron:set-agent`）与创建时一样检查任务投递目标账号上的 `endpoint.operate`，没有时 403 `schedule_target_forbidden`（RPC：`data.code` 同名、`data.status: 403`）；`cron:add` 的同一拒绝也带上这个 `data`。
  - Profile 例程（`source: profile`）拒绝 `set-agent`（400 `schedule_agent_profile`，错误里说明去 Profile 文件改）：它们每次启动按 Profile 重新声明，原地修改会被静默还原。Profile 的 cron 例程新增可选 `agent` 字段，同步时写入 `action.agent`。心跳任务的拒绝码为 `schedule_agent_heartbeat`；调度器抛出的这两类拒绝在 HTTP 路由返回 400，不再是 500。`TimerScheduler.setJobAgent()` 对这两类抛 `ScheduleJobAgentError`（带 `code`）。
  - Agent 已从 `ai.agents` 删除的任务：`zhin schedule list` 标出「⚠ Agent 不存在」；`schedule:list` 的持久化任务行带 `agentMissing: true`；`schedule_list` 工具带 `agent_missing: true`。
  - 文档：CLI 与 Agent 文档（中英文）补充 `--agent`、`set-agent`、Profile 例程的 `agent`、聊天里的权限规则（可见性只在创建时检查，撤销权限后任务仍由原 Agent 执行）。
  - `TimerScheduler.stop()` 等正在进行的任务写完状态、投递与历史再返回（以前只等队列，关闭存储或删除数据目录时可能还有写入）。

## 1.6.1

### Patch Changes

- a8377d4: 已连接却没有任何 Agent 绑定的 MCP 服务器会被明确提示（zhinjs/zhin#1250 第 41 批 `mcp-connected-but-unbound`）：

  - 原因：每一轮的 MCP 工具只取当前 Agent 在 `ai.agents.<name>.mcpServers` 里点名的服务器，`ai.mcpServers` 只负责连接。项目配了 `ai.mcpServers` 的 GitHub MCP、`zhin status` 显示「已连接，49 个工具」，但 `ai.agents.zhin: {}` 没写 `mcpServers`，Agent 一个 GitHub 工具都拿不到，只能默默改走网页搜索；文档和配置说明却写成「连接成功后进入工具池」。
  - 文档与配置说明：中英文 `ai/index`、`configuration/index`、`ai/agent` 写清「`ai.mcpServers` 只负责连接，在 `ai.agents.<name>.mcpServers` 里绑定才能用」，并给出连接 + 绑定的完整示例；`ai.mcpServers` 与 `ai.agents.<key>.mcpServers` 的配置说明（Host 配置 Schema 与 `AgentStartupConfig` / `AgentBindingConfig` 注释）同步改写，`docs/configuration/generated.md` 由 `pnpm docs:config` 重新生成。
  - `GET /introspection/mcp` 的每一行新增 `boundAgents`（`ConsoleMcpServerRow.boundAgents`，绑定该服务器的 Agent；运行中的 Agent 优先，没有时读配置文件；绑定项写成服务器名或 `{ name, … }` 对象都算绑定，ADR 0065 的对象写法落地后不会误报未绑定）。
  - Console「需要你处理」新增 `mcp.unbound`（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`）：已连接但没有任何 Agent 绑定的服务器列为「MCP 服务 github 已连接但没有 Agent 能用」，说明在 `ai.agents.<name>.mcpServers` 里绑定（例如 `ai.agents.zhin.mcpServers: [github]`）；实例运行时 `zhin doctor` 经同一个列表列出它。
  - `zhin status` 的 MCP 行对这种服务器标 `!` 并注明「已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定」，已绑定的服务器列出绑定它的 Agent。
  - Agent 就绪日志的 `mcp:` 段只列这个 Agent 真正绑定的服务器，没绑定的另起一段写成 `未绑定: github(待连接)`（如 `ready | zhin | mcp: - | 未绑定: github(待连接) | …`），不再像是已经绑给了它；调试日志相应写成 `mcp configured:`。
  - MCP 工具本身的权限过滤不变。

- 4760a96: Sandbox 支持上传本地文件（ADR 0064 增补 I1，#1250 第 43 批）：图片、语音、任意文件可以拖放、粘贴或用按钮选择，上传后以签名地址发进会话，入站段与其他平台一致（`media.kind: 'url'`）。

  - **存储**：文件存于项目的 `.zhin/sandbox/media/<端点目录键>/`，只按 128 位随机 id 命名，上传者给的文件名只进元数据，读取只认 id，不接受任何路径。元数据记录上传时的会话（端点 + 会话）、上传者、按内容嗅探的 MIME、大小与过期时间。重启后历史里的文件在有效期内仍可用。
  - **上传**：`POST /api/sandbox/media/<endpoint>?type=&id=`，原始字节，必须带 `Content-Length`，需要 `endpoint.operate`。按类型限制大小（默认图片 10 MiB、语音 20 MiB、视频与其他文件 32 MiB，单文件硬顶 64 MiB，即网关的请求体上限，要更大需要同时调大网关），配额按上传者计（默认 200 MiB）并另有端点总配额（默认 500 MiB），超额直接拒绝，不删别人的文件；另限对象个数（每个上传者 1000 个、每个端点 10000 个）。
  - **签名地址**：`/pub/sandbox-media/<dir>/<id>?exp=&sig=`，HMAC-SHA256、常量时间比较；密钥在 `.zhin/sandbox/media/secret`（0600），保留 current / previous 两把，签发只用 current。有效期默认 24 小时，最长 168 小时；删除文件立即作废它的所有链接，所有者可轮换密钥或「全部作废」。
  - **下载**：Console 页面经 `GET /api/sandbox/media/<endpoint>/<id>`（`endpoint.view`，且必须是文件所属的会话）显示文件；`/pub/sandbox-media` 默认关闭（`media.publicDownload: false`），开启后仍需有效、未过期的签名，来源地址从不作为授权依据。SVG、HTML 等非图片 / 音视频文件一律以附件下载，带 `X-Content-Type-Options: nosniff`。
  - **会话绑定**：带着其他会话或他人上传的托管地址发消息会被拒绝（错误帧 `sandbox_media_rejected`）并记日志；地址只认签发时的原样（`?exp=&sig=`、规范的签名拼写）。指向本机路径的入站媒体（`media.kind: 'path'` 或 `path` / `file_path` 等旧字段）同样整条拒绝。
  - `@zhin.js/console-protocol`：`CONSOLE_HTTP_PERMISSIONS` 登记 `POST` / `DELETE /sandbox/media/*` 为 `endpoint.operate`、`GET /sandbox/media/*` 为 `endpoint.view`（只在已有常量里加条目）。
  - `@zhin.js/agent`：文件策略与 Shell 命令检查显式拒绝 `.zhin/sandbox/`（托管文件与签名密钥；`.zhin/` 原本已整体拒绝）；敏感目录名改为不区分大小写比较（macOS / Windows 上 `.ZHIN/…` 是同一目录）。
  - 本阶段插件与 Agent 还不能在进程内读取上传的文件，要等 I2（`LocalMediaSource`）；在此之前插件按网络地址下载时仍受它自己的域名白名单约束，Agent 暂时看不到上传的图片。

## 1.6.0

### Minor Changes

- a7f3a7c: MCP 状态口径与安装预览（zhinjs/zhin#1250 第 28 批）：

  - `mcp-status-not-loaded-contradicts-agent`（根因）：Plugin Runtime 下 `ai.mcpServers` 的服务作为本代（generation）的 MCP 特性运行，在代激活时连接；Agent 的内省却只读自己的 `resourceHub.mcps` 注册表，而这些服务从不进入该表，于是 Console「运行时能力 → MCP 服务」、`zhin status` 都把已连接的 github 显示成「未加载」（`not_loaded`），「需要你处理」也报「未连接」。现在由 `HostMcpStatusBoard` 记录每个配置服务客户端的实际连接结果（跨代保留：被沿用的代仍算已连接，候选代连接失败不影响旧代），内省按它报告：已连接（含工具数）/ 连接失败（附分类原因）/ 尚未连接（`idle`，显示为「待连接」：配置的服务在代激活时就连接，这是激活前的短暂状态）。发布新的一代时清掉已从配置删除的服务的失败记录，删掉再加回来不会显示旧原因。
  - 「需要你处理」只列连接失败的 MCP 服务并附失败原因，标题改为「MCP 服务 … 连接失败」；尚未连接、未加载的服务只在 MCP 页显示。`zhin status` 中 `idle` 显示为「待连接」。
  - 启动日志 `ready | … | mcp:` 改为与状态一致的写法（如 `github(待连接)`；日志写出时客户端尚未连接），连接结果另记 `mcp_connected`（工具数）/ `mcp_connect_failed`（分类与原因）。
  - 新增 MCP 连接测试：`POST {base}/introspection/mcp/test`（body `{ name }`，权限 `agent.configure`，已登记到 `CONSOLE_HTTP_PERMISSIONS`）用一次性客户端连接、列工具后断开，不改变 Agent 自己的连接与行状态；未配置的名字返回 404，同一服务测试进行中返回 409，Agent 未运行返回 503；全局最多同时 2 个测试，同一服务每次测试后冷却 5 秒，超出返回 429 并带 `Retry-After`；每次测试写入 Console 审计日志（`mcp.test`：操作者、服务名、结果与失败分类，不含失败消息）。注意：对 `stdio` 服务，测试会在 Agent 已有进程之外再启动一个同名命令，独占资源（锁文件、固定端口）的服务测试时可能冲突。新增导出：`@zhin.js/console-protocol` 的 `CONSOLE_MCP_TEST_PATH` / `ConsoleMcpConnectTestResult`；`@zhin.js/host-http` 的 `ConsoleAgentIntrospection.testMcp()`（Agent 不可用时返回 `'agent-unavailable'`）与 `ConsoleRestPagesOptions.mcpTestMaxConcurrent` / `mcpTestCooldownMs`；`@zhin.js/agent/runtime` 的 `HostMcpStatusBoard`（`probe()`）及相关类型，`AgentHostIntrospectionPort.testMcpServer()`。
  - `install-dry-run-dumps-whole-config`：`zhin install … --dry-run` 的配置预览改为 unified diff，只含改动的行和上下 3 行，由真正写入时（逐键补丁、保留注释与顺序）会产生的文本计算，不再重新序列化打印整份配置（此前注释几乎全部丢失，看起来像安装会抹掉注释）。
  - 安装插件时跟随项目的精确版本写法：项目 `dependencies` / `devDependencies` / `optionalDependencies` 里的 `zhin.js` / `@zhin.js/*` 注册表依赖全部是不带 `^` / `~` 等范围的精确版本（`=1.5.0` 也算精确）（`workspace:`、`link:`、`file:`、`catalog:`、`npm:` 别名、git / 路径来源与 `latest` 这类标签不参与判断；至少要有一条注册表依赖）时，`pnpm add` 加 `--save-exact`（npm `--save-exact`，yarn / bun `--exact`）。只对 npm 注册表包生效，请求本身写了范围（如 `foo@^1.2.0`）时按原样安装、不加；`--dry-run` 显示的命令同样带上。`@zhin.js/gateway/plugin-management` 新增 `projectPinsExactZhinVersions()`、`isRegistryPackageRequest()`、`installSavesExact()`。
  - 预览的 diff 也显示行尾差异：文件末尾无换行输出 `\ No newline at end of file`；只有行尾不同的单行标出 ` (CRLF)` / ` (LF)`；整个文件换了行尾时在文件头后用一行 `# line endings: CRLF -> LF` 说明。

- 19526a6: 没回复、被拒绝、离线都说清原因（zhinjs/zhin#1250 第 31 批）：

  - `self-service-unknown-conversation-opaque`（回退的根因）：第 9 批（ADR 0060 P3，b6ec01464「Sandbox speaks as the linked chat identity; typed ids are simulated and role-less」）起，Sandbox 里手填的发送者以 `~sim:<id>` 进入运行时，而 `chatRoleMessageContext()` 把这种保留 id 当成「无法识别」，`功能` / `角色` / `认领` / `绑定` 都只回「无法识别当前会话。」；之前同一个群里 `功能 关闭 repeater` 能用，是因为当时手填的 id 还会被当成真实身份。现在 `@zhin.js/core` 新增 `resolveChatRoleMessageContext()`，返回 `{ ok: false, reason }`（`no-conversation` / `unknown-endpoint` / `no-adapter` / `no-sender` / `simulated-sender` / `invalid-sender`），实例侧再加 `unkeyed-conversation`（适配器没有提供可用的会话类型或会话 id）；四个指令按原因回复下一步（如「你正以模拟身份发言……请在 Sandbox 打开『以我的身份发言』，或在 Console『功能』/『聊天角色』页设置」）。不带参数的 `功能` / `角色` 直接列出。
  - 被拒绝或失败的自助指令不再记成 `command_replied | executed`：`UserFacingError` 新增闭合的拒绝码 `reason`，指令派发结果带 `refusalReason`，入站结局记 `refused` 与该码（如 `simulated-sender`、`not-admin`、`usage`、`locked`、`self-service-disabled`），回复文字不变。没有码的 `UserFacingError` 仍记 `user_facing_error`。
  - `unaddressed-message-no-record`（复测失败的根因）：第 18 批之后，没被 @、不是指令的群消息其实已经记了 `not_addressed`，但未点名的静默结局一律只写 debug 日志，Console 的运行日志看不到；结局只存在进程内，Sandbox 和轨迹页也没有入口，看起来就像「什么都没记」。现在每个会话每分钟第一条 `not_addressed` 写 info（`inbound_outcome | … | sampled: first_per_minute`），其余仍为 debug；新增 `GET {base}/conversations/outcomes`（`endpoint.view`，只限当前 Sandbox 连接绑定的会话、且只列该连接 owner 本人或其模拟身份发出的消息；只返回结局码和面向发送者的文案，不含插件名、阶段等运维文案），Sandbox 发消息后读取这条消息的结局，没有回复时显示原因（如「这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。（not_addressed · no_command_not_ambient）」）。`ConsoleMessageDiagnostic` 补上已有的 `outcome` 字段。
  - `console-offline-no-reason`：适配器不上报连接状态（如 GitHub 这类 Webhook 适配器）且没有失败记录的已启动账号，不再显示「离线 · 连接状态：未知」，改为「未上报连接状态」（提示级），并说明常见原因与检查方法；确实离线时附上最近一次失败的原因、失败时间与自动重试次数 / 下次重试时间。这些只改显示文字：条目的 revision 与之前相同，已忽略的待办不会重新出现（「已从配置导入聊天角色」的 revision 也仍按原始条目数计算）。
  - `principal-link-attention-ids`：「人员名单或身份链接等待确认」按人分组，每个身份写出适配器与账号（`qq·bot-a`），平台 id 只显示后 4 位（`尾号 1234`），数量按去重后的 (adapter, endpoint, userId) 计算；查看者本人显示为「你（显示名）」，其他 Console 用户显示 id 前 8 位，条目新增 `links`（`ConsoleAttentionItem.links`）供 Console 按 `iam.users.list` 换成用户名。

### Patch Changes

- 2386370: 不同插件的命令或别名重名不再让实例启动失败（#1250 duplicate-command-route-crashes-instance）。以前 Command 索引遇到重名路由直接抛 `Duplicate Command route`，实例退出、被网关反复拉起，所有适配器下线。现在：

  - 命令名称冲突时，先声明的插件保留（按插件在配置里的声明顺序），后来的那条命令连同它的别名、快捷方式不注册，它的子命令仍然可用；
  - 只有别名或快捷方式冲突时，只跳过这个别名或快捷方式，命令本身照常注册；命令名称优先于别的插件的别名；
  - 同一插件内部的冲突仍然在加载时报 `Duplicate Command route`，插件自己的测试能发现；
  - 插件热重载替换自己的命令不算冲突，热重载也不会改变由谁保留路由；
  - 插件按适配器、账号或会话关闭时，在保留方被关闭的端点上，原来被跳过的命令会生效。

  **升级注意**：后声明的插件如果有与前一个插件的别名同名的命令（例如 A 的 `admin` 带别名 `ban`，B 有命令 `ban`），升级后 `ban` 由 B 处理，而不是像以前那样启动失败。用户熟悉的指令换了处理方，所以这种冲突在「需要你处理」里标为严重（`danger`），升级后请检查并处理。

  每处冲突在启动（及热重载）日志里打一条 warn（`op=command_route_conflict`），并作为 `command.conflict` 列在 Console「需要你处理」和 `zhin doctor` 的运行状态里，写明两个插件名、命令名或别名，以及建议：让其中一个插件改名（或配置 `commandNamespace`），或在配置里用 `disabledCommands` 禁用其一。`CommandIndex` 新增 `conflicts()`；`@zhin.js/console-protocol` 的 attention 新增 `command.conflict`（需要 `feature.view`）与 `subject.pluginId` / `commandRoute` / `command` / `commandKind`。

- f145963: 语音能力的可用性检查与 `voice_tts` 音频不再进入模型上下文（zhinjs/zhin#1250 第 29 批）：

  - `voice-tts-base64-in-model-context`（根因）：`voice_tts` 合成成功后把整段 mp3 的 base64 放进工具结果，Agent 把工具结果原样交给模型，于是模型看到约 2.5 万字符的 base64，并在回复里又抄写一遍（结果出现一段正常、一段残缺的两段语音，整轮将近 6 分钟）。现在 Agent 在工具结果进入模型之前把 `voice_tts` 的音频（以及没有对象存储时 `generate_image` 的内嵌图片）拆出来，作为媒体随本轮回复经正常发送链（`Message.$reply` → OutboundRenderer → Endpoint）只发一次；模型只看到 `{ format, size, sent: true, note }` 和「语音已发送给用户……不要重复输出音频内容」的提示。
  - 兜底：任何工具结果（成功、报告失败、抛错、PostToolUse 改写后的结果）进入模型前，base64 载荷 2048 字符以上的 data URL 与连续 base64 串替换为一行「[已省略 … 数据（N 字符），未提供给模型]」。读文件 / 搜索 / shell 类工具（`read_file`、`grep`、`glob`、`list_dir`、`web_fetch`、`bash` 等）的结果可能被原样写回文件，只截断 64 KB 以上的串并标明「已截断」，CSS / SVG 里的内嵌图标原样保留；`write_file` / `edit_file` 拒绝写入含这类占位的内容并给出明确报错。实现为一次线性扫描，构造输入不会退化为平方复杂度。
  - 会话历史：已发送的工具语音带 `fallbackText`（如「[语音 mp3 18.6KB 已发送]」），内嵌图片带 `alt`；写入历史（`encodeConfirmedOutput`，流式平台的已确认输出）与文本投影（`renderAgentOutput`）时，所有 data URL / base64 媒体元素与媒体段统一只写占位，下一轮模型看不到载荷。非流式回复只带 messageId 写历史（没有已确认输出，保存的是模型原文）时，助手文本同样经过上面的内嵌二进制兜底，模型自己写的内嵌音频 / data URL 段在历史里只剩「[已省略 … 数据（N 字符），未提供给模型]」。助手原文重新交给模型时也一样：格式修复（schema repair）提示里的「Rejected reply」、Agent 循环每次迭代的消息投影（本轮与历史中的助手文本）、迭代耗尽 / 进度摘要的补全，以及压缩摘要请求，都先省略内嵌二进制再发送，模型看不到被拒回复或先前回复里抄写 / 编造的 base64。修复提示要求删掉占位；模型照抄进回复的框架占位（「[已省略 / 已截断 … 数据（N 字符）…]」「[语音 mp3 18.6KB 已发送]」「[语音（内嵌数据，已省略）]」等固定形态）在出站前统一剔除（结算去重与流式快照都覆盖，流式中未写完、可能成为占位的尾部先不提交），普通方括号文字不受影响。取舍：超过 2048 字符、连续由 base64 字符集组成的文本（包括长十六进制串）会以占位提供给模型并存入历史；用户要求模型输出或改写超长 base64 时，原文不会保留到下一轮。
  - 本轮工具已经产出某类媒体（如语音）时，模型回复里同类的内嵌媒体（`kind: base64` 或 `data:` URL，结构化回复的媒体段和文本回复的 `[audio](data:…)` 都算）视为抄写的副本，不再作为第二段媒体发出——结算阶段与流式结构化回复都去重，并在 turn trace 记一条 `copied_inline_media_dropped`（`@zhin.js/agent/trace` 的 `TurnTraceNote` 新增该变体）；模型引用的 URL / 文件不受影响，没有工具媒体时行为不变。
  - `voice_stt` 只接收 URL / 本地路径并返回文字，入站语音按多模态配置转写或作为媒体块交给模型，不会以 base64 文本进入上下文，未改动。
  - `speech-ready-without-tts-binary`：`speech.tts.provider: edge` 时，Speech Host 启动会检查 `speech.tts.edgeTtsCommand`（默认 `edge-tts`）能否执行——只在 `PATH`（Windows 含 `PATHEXT`）/ 文件系统里查找，不运行命令，最多 3 秒。不能执行时：记 warn（`speech_dependency_unavailable`），启动行写成 `degraded | … | tts: edge (unavailable: not-found edge-tts)`，不再写 `ready`；Console「需要你处理」新增 `speech.unavailable` 条目（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`，指向 `speech.tts.edgeTtsCommand`，配置中的家目录路径只显示最后一段）；实例运行时 `zhin doctor` 通过同一个「需要你处理」列表列出它。检查超时只作为提示（`info`），不阻止调用。
  - `edgeTtsCommand` 填了带参数的命令行（如 `uvx edge-tts`）时单独提示「只能填可执行文件路径，不支持带参数」（新增原因 `has-arguments`；路径本身含空格时仍按找不到处理）。Windows 上只接受 `.exe` / `.com`（Node ≥ 22 不经 shell 运行 `.cmd` / `.bat` 会报 `EINVAL`），只有 `.cmd` / `.bat` 时报「不能直接执行」；`@zhin.js/speech` 把 `EINVAL` 翻译为可读提示。
  - 返回给模型的报错与 warn 日志里，命令路径只保留最后一段（`…/edge-tts`），不暴露家目录。
  - `voice_tts` 在 TTS 被标为不可用时先重新检查（装好 edge-tts 后无需重启），仍不可用则直接返回原因（「未找到 edge-tts（命令「…」不在运行环境的 PATH 中）……配置为可执行文件的绝对路径……」），模型据此准确告诉用户；单次调用改用其他 provider 不受影响。合成失败的 `{ error }` 按失败记录、模型看到完整原因（第 26 批）已核实，并在 eval 中断言原因到达模型。
  - `@zhin.js/speech` 的 edge-tts 缺失提示补充命令名、无执行权限（`EACCES`）的情况，以及 launchd / systemd 托管时必须写绝对路径（`PATH` 通常不含 `~/.local/bin`，也不展开 `~`）。其他 provider（openai / azure / custom TTS、openai / ollama STT）都是 HTTP 服务，没有本机命令依赖，不做启动探测。
  - 文档（中英文 `ai/speech`、`@zhin.js/speech` README）说明托管环境中 `edgeTtsCommand` 要写绝对路径、启动检查的表现，以及语音不进模型上下文。

## 1.5.0

### Minor Changes

- efa87bf: 失败原因看得见（#1270 第 14 批）：新增 `ConsoleErrorDetails`、`ConsoleErrorNextStep`、`isConsoleErrorNextStep()`，`ConsoleApiErrorBody` 新增可选 `details` / `nextStep`；attention 新增 `inference.account`、`config.ineffective` 两类条目与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，条目新增可选结构化 `reason`（`ConsoleAttentionReason`，含「重启前记录」标记 `restored`），主体新增 `inferenceAccount` / `configPath`，列表新增 `status: 'starting'`；新增运行时失败记录契约 `RUNTIME_FAILURES_FILE`、`ConsoleRuntimeFailure`、`ConsoleRuntimeFailureJournal`、`ConsoleRuntimeFailureSource`。
- 0e6a82f: 普通插件启停热生效，不再重启实例（zhinjs/zhin#1250 `toggle-plugin-restarts-instance`，ADR 0054 修订 2026-11-15）：实例运行时 `zhin enable` / `zhin disable` 与 Console 全局开关先写 `disable_plugins`，再经控制通道 `plugins.apply` 让实例按该修订换代（退役或装配该插件实例的全部能力），实例不重启、适配器不重新登录。插件声明 `package.json#zhin.toggle: "restart"`、含原生模块、实例启动后依赖有变化、实例不支持或热应用失败时，自动回退为停止 → 启动实例（启动失败照旧恢复配置并启动原实例），结果的 `plugin.apply` / `restartReason` / `restartDetail` 与新阶段 `apply-hot` 说明生效方式和原因；Console RPC 的 `restartRequired` 只在实例确实重启时为 true；CLI 输出「已热生效，实例未重启」或重启原因。

### Patch Changes

- 92e6c1e: 更正上一版发布说明：认领码只由 `zhin status` 显示（或读 `.zhin/chat-owner-claim.json`），实例日志里只记它的哈希前 8 位，不会出现认领码本身。1.4.0 / 1.5.0 发布说明中「实例日志与 `zhin status` 给出一次性认领码」的写法有误（ADR 0060「安全复核」）。

## 1.4.0

### Minor Changes

- 8bf8dfa: #1250 第 10 批（试用反馈、关键修复与 AI 账号）的公开 API 新增按 minor 发布：Console 协议的功能未启用状态、功能矩阵分类与传输状态文字；Host 端口校验与 owner 判定导出；网关项目标识与插件候选；Agent 运行时的连接测试与 Host 环境变量引用授权；模型请求首响应时限；`zhin ai` 命令与 `--allow-unverified-host`；日志单行转义导出；Host 根配置新增 `firstResponseTimeoutMs`，icqq 新增 `logLevel` 配置（按 commandSuggestion 先例为 minor）。
- bc31cd3: 聊天角色的引导与种子导入（ADR 0060 P1）：

  - 公共 API：`isOwner(sender, { level })`（默认全局 owner）、`hasChatRole(sender, role, { level })`，以及只读的 `chatRolesToken`（`ChatRoleReader`：`roleOf` / `principalOf` / `holders` / `factsOf` / `subscribe`），插件不再需要自建 `masters` 名单。
  - 认领码：没有全局 owner 且数据库为关系型时，实例日志与 `zhin status` 给出一次性认领码；在真实平台私聊机器人发送 `认领 <码>`（`claim <code>`）成为全局 owner。群聊中发送正确的码会立即作废，连错 5 次轮换，模拟适配器上不接受；审计 `chat-roles.claim` 只记码哈希前 8 位。
  - 配置中的人员名单（适配器 `master` / `trusted`、`ai.trigger.*`）在导入完成后再次出现不再启动失败：不自动授予，记入迁移记录后从配置移除，等待持有全局 `iam.manage` 的 Console 用户通过新 RPC `chat-roles.imports.list|resolve` 逐条导入或忽略（审计 `chat-roles.import`）。导入只升不降；迁移记录升为版本 2，原版本 1 保存为 `.zhin/chat-roles-migration.v1.json` 供回滚。
  - 「需要你处理」新增 `chat-roles.no-owner`、`chat-roles.imported`、`chat-roles.import-pending`（仅全局 `iam.manage` 可见）。

- 760e9f5: 聊天身份的「人」模型（ADR 0060 P2）：

  - 角色授予属于「人」：新实例表 `chat_principals`、`chat_identities`（一个平台身份至多属于一个人）、`chat_principal_console_links`（Console 用户与人一对一，缓存 Console 显示名）。全局授予对一个人的全部平台身份生效；低于全局的授予只对该作用范围所属适配器上的身份生效。
  - `chat_roles` 原地新增 `principal_id` 列：首次启动为已有授予的身份各建一个人并回填（幂等），迁移前全部授予导出到 `.zhin/backups/chat-roles-<时间>.json`；过渡期双写 `adapter` / `user_id` 并保持原行 id，降级到旧版本角色不变（回滚见升级指南）。
  - 入站消息新增 Runtime 写入的只读 `sender.chatPrincipal`，适配器或插件自带的同名字段被丢弃；`ChatRoleReader.principalOf` / `holders` 返回真实的人，`subscribe` 新增 `merge` / `split` 变化，`factsOf` 返回 `chatPrincipal`。
  - 新 Console RPC：`chat-principals.list|get|merge|split|rename|link-console|unlink-console|export|import`、`chat-identities.recent|me|bind-code.create`，全部登记到权限表；新权限 `self.chat-identity`（所有内置角色默认带）。归并 / 拆分持有全局角色的人、链接 Console 用户、导出导入需要全局 `iam.manage`。`chat-roles.*` 条目新增 `grantedByName`（授予者显示名的规范字段：已链接的人名优先）与 `principalId`；1.3.0 已发布的 `grantedByDisplayName` 保留并标记为 deprecated，取值始终与 `grantedByName` 相同。
  - 聊天侧新增 `绑定 <码>`（`bind <code>`）：只接受私聊，群聊中发送的正确码立即作废，模拟适配器不接受；审计 `chat-identities.bind`、`chat-principals.merge|split|rename|link-console|unlink-console`。
  - 最近发言时间与显示名缓存保留 90 天（供选择器，不参与鉴权）。
  - CLI：`zhin chat-roles export [文件]` / `zhin chat-roles import <文件>`（经运行中实例；导入只新增或提升）。结果（含跳过的条目）写到 stdout，错误写到 stderr。
  - 网关：Console 用户被删除或禁用时若实例不在线，在实例重新就绪后补发通知，实例据此删除该用户的链接。

### Patch Changes

- 603b892: #1250 安全复核修复：配置补丁把敏感字段的值移入 `.env` 需要 `ops.env.write`，否则以 `env-write-required` 拒绝（聊天自助与 Agent 自改同样拒绝），且只更新字段自己的规范变量、绝不覆盖字段仅仅引用的其他变量；CLI 的 `/pub/health` 项目核对在探测失败时按"未验证"处理（默认拒绝，`--allow-unverified-host` 时警告后继续），本机判定覆盖 `0.0.0.0`、`::ffff:127.x`、`*.localhost` 与本机网卡地址，`hostFetch` 不再以明文 HTTP 向非回环地址发送令牌；模型连接测试（`/probe`、`/account/test`）按账号限流（每分钟 6 次，超出返回 429 与 `retryAfterMs`）。
- 5d90159: 聊天身份 P3（ADR 0060）：Sandbox 以我发言、`ai.personalPrincipals` 改读链接。

  - **Sandbox 安全修复**：Console Sandbox 客户端自填的发送者 ID 一律是模拟身份——服务端写成保留 id `~sim:<id>`，不解析任何 zhin 角色，信任档位最低；填 owner 的 id 不再能冒充 owner。以 `~` 开头的发送者 id 不是聊天身份（`isChatIdentity` 为 false），不能持有、被授予或解析角色，也不记入最近发言人。
  - Sandbox 新增「以我的聊天身份发言」（默认开启）：已登录的 Console 用户按其链接的人在 Sandbox 上的身份发言，角色按该人的授予解析；未登录（引导令牌）与 `--standalone` 一律按模拟身份。新 RPC `chat-identities.simulated.ensure`（`self.chat-identity`）为调用者的人（没有则新建并链接）在模拟适配器上建立身份，不触及真实平台。`ChatRoleReader` 新增可选方法 `consoleSpeaker`。
  - `ai.personalPrincipals` 首次启动导入为「人 ↔ Console 账号」链接（不授予角色）；`rootId` 与当前目录不一致不再导致启动失败（按别名 + subjectId 导入并告警）；之后个人推理主体只读链接表。`@zhin.js/agent`：`HostInferenceOptions.personalOwners` 可为函数（每次管理租约读取），`resolveInferenceManagementPrincipal` 的 `bindings` 可为函数，且 `full` 范围允许切换到调用者自己的个人推理主体；新增 `personalOwnersOfIdentities` / `chatIdentityOfPersonalOwner`。
  - 「需要你处理」`chat-roles.imported` 列出 `ai.personalPrincipals` 导入的链接；若被链接的 Console 用户就是当前查看者且尚无全局 owner，提示「是否同时设为全局 owner」。确认已读同时标记该导入。
  - 聊天 `角色 授予 / 撤销` 可用 `#<人 id 前缀>` 引用一个人（前缀唯一时）。

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

- 9d3f50b: 依赖事务回滚后不再让机器人停在 `stopped`（#1250）：

  - 回滚时即使恢复文件或重新安装依赖失败，只要实例原来在运行就仍尝试拉起；拉起失败单独记入新字段 `restartError`（`GatewayPackageTransactionResult`），`rollbackError` 只描述恢复文件 / 重新安装依赖。
  - pnpm 11 在依赖已安装完成、只是跳过了未放行的构建脚本时以 `ERR_PNPM_IGNORED_BUILDS` 退出 1。网关（以及没有网关时的 `zhin install`）在确认依赖已就位（`node_modules/.modules.yaml` 存在且 `add` 的包都在）后不再把它当成安装失败，而是在结果里给出 `ignoredBuilds` 并提示用 `allowBuilds` 放行后 `pnpm rebuild`。
  - CLI 打印事务时，包管理器的原文逐行加 `│` 前缀放在对应步骤下，与「· 步骤」行分开；回滚失败时分别说明回滚错误与实例是否已重新启动。

- 00ca418: 没装或没启用 AI 时，Console 读取不再显示「暂时无法读取」（#1250）：`GET /api/assistant/jobs` 与 `GET /api/conversations/results` 在功能关闭时返回 200 `{ success: true, data: { status: 'disabled', reason, message, …空列表 } }`，`reason` 为 `agent-not-installed`（未安装 `@zhin.js/agent`）、`agent-disabled`（已安装但 AI 未启用）或 `assistant-disabled`（`assistant.enabled` 为 false），替代原来的 404 `assistant.enabled is false` 与 503 `result_store_unavailable`（存储损坏等真实读取失败仍是 503）。任务写入（`POST /api/assistant/jobs*`）仍返回 404 与旧的 `error: 'assistant.enabled is false'`（兼容旧 CLI），新增 `code: 'unavailable'` 与 `data`（同样的 `ConsoleFeatureDisabled`）。`@zhin.js/console-protocol` 新增 `ConsoleFeatureDisabled`、`ConsoleFeatureDisabledReason`、`consoleFeatureDisabled()`、`isConsoleFeatureDisabled()`；`zhin schedule` / `zhin watch` 识别新形状并打印原因。
- e690123: 功能矩阵不再只有适配器一行（#1250）：`feature.matrix` 在项目根插件提供了命令 / 组件 / 工具时加一行 `kind: 'root'`、`plugin: ''`、`readOnly: true` 的「本项目」行（始终启用，不可开关），列出 `capabilities: { commands, components, tools }`（如 `hello`、`card`）；其他行新增 `kind: 'plugin' | 'adapter'` 与各自的 `capabilities`，按 根插件 → 插件 → 适配器 排序。`feature.list` 的条目同样带 `kind` 与 `capabilities`（不含根插件行）。`@zhin.js/console-protocol` 新增 `ConsoleFeatureKind`、`ConsoleFeatureCapabilities`，`ConsoleFeatureSummary` / `ConsoleFeatureMatrixRow` 新增可选字段。
- 9cd764a: 敏感配置不再以明文写进配置文件（#1250）：经 `config:patch-project` / `config:patch` / `config:set`（`zhin config set` 与 Console 保存共用的 Host 写入路径）写入 Schema 标为敏感的字段（`x-zhin-secret`、`writeOnly`、`format: password`、`x-zhin-config.secret`，以及 token / 密码类键名）时，值写入项目 `.env`，配置里保留或改为 `${VAR}` 引用：沿用该字段原来引用的变量名，原来不是引用时按路径生成规范名（`http.token` → `HTTP_TOKEN`，重名加 `_2`）；`.env.<环境>` 已定义该变量时写到那里；配置写入失败时 `.env` 恢复原样。保存结果新增 `envSecrets: [{ path, variable }]`（只有变量名，从不含值）；补丁请求新增可选 `secretStorage: 'env' | 'plain'`（`ConsoleConfigPatchRequest`），`zhin config set --plain` 以明文写入并打印警告。
- b2ed753: Endpoint 的传输状态有了可读文字（#1250）：`endpoint.list` / `endpoint.info` 的每行在原始 `transportState` 旁新增 `transportLabel`（如 `open` → `已连接`、`reconnecting` → `重连中`）；「需要你处理」中离线账号的说明改用这段文字（不再显示「连接状态：closed」）。`@zhin.js/console-protocol` 新增 `ConsoleEndpointTransportState` 类型与 `endpointTransportLabel(state, locale)`，`ConsoleEndpointSummary` 新增可选字段 `transportLabel`。

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

- ccab2c1: Console Host 侧诊断数据修正（#1250），新字段均为可选、旧客户端不受影响：

  - `endpoint.friends` / `groups` / `channels` / `group_members`：适配器不提供该读取时不再返回 `{ error }`，而是空列表加 `status: 'unsupported'`、`capability`、`message`（协议类型 `ConsoleEndpointCapabilityUnsupported` / `ConsoleEndpointListReply`，判定函数 `isConsoleEndpointCapabilityUnsupported`）。
  - `endpoint.send_message` 失败时在 `data` 中带出 `{ code, reason, status, retryable? }`（`ConsoleSendFailure`；`reason` 为 `no_live_client` / `endpoint_offline` / `endpoint_not_found` / `target_not_found` / `policy_rejected` / `platform_rejected` / `unsupported` / `invalid_content` / `delivery_unknown` / `failed`），`error` 改为对应中文原因；Core 失败回执的消息带上失败码（`Outbound delivery failed (<code>).`）。
  - MCP 客户端记录最近一次连接失败（`auth` / `network` / `timeout` / `config` / `process_exit` / `sdk_missing` / `unknown` + 脱敏短消息 + 退出码），写入 warn 日志（`op=mcp_connect_failed`），并经 Agent introspection 与 `GET /api/introspection/mcp` 返回 `status`（`connected` / `failed` / `idle` / `not_loaded`）与 `lastError`。
  - 进程资源：`GET /api/system/status` 新增 `process`（`role: 'instance'`，与 `memory` 同一次采样）；`gateway.instance.status` 新增 `gateway`（`role: 'gateway'`，网关进程自身）。协议类型 `ConsoleProcessSample`。
  - `gateway.packages.list` 每个已安装依赖带 `kind`（`plugin` / `feature` / `library`，取自 `package.json#zhin.type`），Console 只应把 `plugin` 当插件。
  - `chat-roles.*` 条目新增 `grantedByDisplayName`：调用者本人授予的记录显示其显示名，聊天内授予、配置迁移、初始化令牌给出可读标签；其他 Console 账号不解析（实例不读取网关账号库）。

- b00725c: Console 未知 RPC 不再当作安全拒绝（zhinjs/zhin#1250）：Host 既没有处理器、也不在权限表里的 RPC 类型回 `404 { code: 'unknown_rpc' }`，不执行、不写审计（按类型去重记 debug 日志）；有处理器却漏登记权限的仍按 `unmapped` 拒绝并审计。网关未知的 `gateway.*` 同样回 `unknown_rpc`。被拒绝的审计条目在 `detail.reason` 写明原因（`not_authenticated` / `setup_required` / `unmapped_permission` / `unmapped_route` / `insufficient_permission` / `scope_denied` / `handler_denied` / `no_plugin_handler`）。新增能力查询 `GET {base}/console/capabilities`（权限 `authenticated`）：返回 `{ version, rpc, features, complete }`，网关把自己处理的 RPC 与实例的合并，实例未运行或较旧时 `complete: false`（较旧实例每个路由表只问一次）。协议导出 `CONSOLE_UNKNOWN_RPC_CODE`、`CONSOLE_DENIAL_REASONS`、`CONSOLE_CAPABILITIES_PATH`、`CONSOLE_FEATURES`、`createConsoleCapabilities` / `parseConsoleCapabilities` / `mergeConsoleCapabilities`；`authorizeConsoleRpc` 新增 `registered` 选项，Host 导出 `RUNTIME_CONSOLE_RPC_TYPES`、`isAuditedRpcDenial`、`unknownRpcLog`。
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

- f3910f1: 定时任务（#1250）：持久任务现在记录并显示下次运行时间（`state.nextRunAtMs`）——启动时为已启用的任务重新计算（修复升级后为空的旧数据并记 info），每次运行、`resume` 后都会重新计算，`pause` 清空；已启用却算不出下次运行时间的任务记 warn，并作为「需要你处理」的 `schedule.unschedulable` 条目出现。重启时 assistant profile 同步不再清空任务的运行记录（`state`）与创建时间；`routines.heartbeat.enabled: false`（或 profile 不再声明心跳）会把已持久化的 `assistant-profile-heartbeat` 停用，profile 改变任务启用状态时记 info。`zhin schedule list`、`GET /assistant/jobs` 与 Console `schedule:list` 的持久任务返回 `target: { resolved, display?, reason? }`（账号显示名 + 会话；账号已不存在时 `resolved: false`），CLI 以「⚠ 无效」标出，并显示已启用任务的下次运行时间。`zhin schedule add` 新增 `--target <adapter>:<endpoint>:<kind>:<id>`（省略时沿用 `assistant.defaults.notify` / profile `defaults.notify`）；`--notify-channel im` 缺目标或目标账号不存在时，Host 返回 400 与错误码 `schedule_target_required` / `schedule_target_not_found` / `schedule_target_invalid` 和中文说明，不再是 Internal error。数据库迁移完成后 `data/schedule-jobs.json` 改名为 `schedule-jobs.json.migrated`（记 info）；`schedule_list` 工具描述改为真实存储位置。

### Patch Changes

- e6d7cc1: 配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

  官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。

## 1.2.2

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

- f2fa3d7: ICQQ 改用登录辅助 v2 的登录流程（ADR 0058 P2）：每次登录一条流程（连接 → 挑战 → 验证中 → 在线 / 失败），声明 `login: { mode: 'interactive', relogin: true, refreshQr: true }` 并实现「重新登录」「刷新二维码」钩子。扫码时自动跟踪扫码状态（已扫码提示、确认后自动继续、过期自动换码两次）；滑块带托管验证码辅助页（`media.captcha`）和手动提取 ticket 的分步说明，NT 登录提交 `ticket,randstr`、旧版只提交 ticket；设备锁提供「我已在手机完成验证」和「改用短信验证码」（6 位验证码、60 秒后可重新发送，发送失败报 `rate_limited` / `unknown` 并留在设备锁）；身份验证提供设备 JSON（敏感，只在活动挑战上）、验证链接二维码和只在 `accounts.qq.com/login/attack` 运行的静态辅助脚本。`system.login.error` 按一张表映射到错误码，验证码错误留在原挑战；需要人处理的失败不再自动重新登录，只有被踢下线、网络错误等不需要验证的失败保留退避重试并记入时间线。QQ 命令 `icqq login confirm / code / status / qr` 按挑战作答（设备锁 `code sms`、短信 `code resend`），`code` 支持带 QQ 号。core：流程挑战的兼容待办 `payload.message` 带上简短说明，`payload.url` 在没有 `media.link` 时取第一个链接块。

  adapter：`AdapterIndex.loginControl` 的登录钩子（重新登录、刷新挑战）在账号启动中（卡在登录挑战上）也能调用，新增 `acquireLogin` 租约；已停止的账号和被替换的旧 incarnation 仍然拒绝。

  验证链接带会话标识：icqq 日志只记录挑战类型和链接主机名；core 的 `withoutLoginMedia`（`endpoint.login.flow` 事件与历史）去掉滑块 / 设备锁 / 身份验证 / link_verify 挑战的 `media.link`、`media.captcha` 和链接块，并标 `linkOmitted: true`（console-protocol 增加该字段）。

  复审修正：NT 滑块答错后重新登录拿新滑块（NT / 旧版格式按挑战记录，不再重新判断）；「ticket 已过期」映射为 `challenge_expired`；`system.receive` 的登录挑战副事件只带 `{ kind, host }`；包装 icqq SDK 日志，去掉链接查询串和手机号（SDK 直接写控制台的终端二维码和 237 分支 `console.log` 无法拦截，已在 README 说明）；自动重新登录 8 次用尽后流程失败并通知；扫码时 SDK 的 `internal.error.qrcode` 转为结果；登录钩子随租约中止；token 不兼容提示删除 token 文件；`icqq login code` 在多账号时不回显参数；短信冷却跨重新登录保留。core：纯字符串等于某个无输入操作的 id 时选择该操作（旧 Console 输入 `sms` 仍可用）。

- ac72706: 登录辅助 v2 第一期（ADR 0058）：每个账号一条登录流程（`LoginAssist.beginFlow`、时间线、提交后自动「验证中」与「结果待确认」、错误码与 `next`），挑战描述符带分步引导、复制 / 链接 / 提示块（敏感块只在活动挑战上）、`parseLoginTicket()` 与托管验证码辅助页的共享函数；`defineAdapter({ login })` 能力声明与 Endpoint `login` 钩子；Console 新事件 `endpoint.login.flow` 与 RPC `login.flow.list` / `login.flow.get` / `login.relogin` / `login.refresh`，`login.submit` 支持 `{ action, values }` 与 `wait: true`；登录操作审计结果类别；终端按流程逐行显示进度、按编号选择操作；账号行填写 `pendingLogin` / `loginStep` / `login`；配置 `console.loginAssist.captchaHelperUrl`。旧 `waitForInput` / `login.list` / `login.submit` 行为不变。
- b2aae3c: 登录流程事件与历史不再带验证链接：`withoutLoginMedia` 去掉滑块 / 设备锁 / 授权 / 链接验证挑战的 `media.link`、`media.captcha` 与链接块（它们带 sid），标记 `media.linkOmitted: true`，需要时用 `login.flow.get` 读取；二维码挑战不变。icqq 登录辅助日志只记录挑战类型与链接主机名。

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
