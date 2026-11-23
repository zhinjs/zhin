# zhin.js

## 1.10.0

### Minor Changes

- 64612cf: 会话列表与审批卡片显示来自哪个聊天（zhinjs/zhin#1250 第 63 批）。全部是新增的可选字段，已有字段含义不变，不新增权限。

  - `@zhin.js/agent`：trace 会话摘要（`TurnTraceArchive.sessions()`，Console `GET /api/agent/trace-archive/sessions`，权限仍是 `agent.view`）新增 `origin`（最近一个记录了来源的回合的来源，与回合 `origin` 同形状）、可读名 `platform`、`scope_kind`、`scene_label`、`display_name`（如 `sandbox · 私聊 Developer`、`定时任务 每日早报`，与用量统计 `bySession[].displayName` 同格式）与 `conversations`（一个会话跨多段聊天时每段的 `{ origin, turns, last_started_at }` 加同样的可读名字段，最近的在前，最多 10 段，超出时给 `conversations_total`；只有 IM 会话、定时任务与内部来源分段，A2A / MCP / HTTP 回合同一会话只算一段）；旧 trace 没有来源时这些字段不出现。trace 的 `origin.conversation` 现在记录会话名 `name`（最长 128 个码点）；平台给的名字（群名、发起人显示名）在记录与生成可读名时清理控制字符、U+2028/2029 与双向控制符（转义为 `\uXXXX`）并按码点截断，新增导出 `sanitizeOriginText()`。工具审批队列的卡片（`ToolApprovalEntry`）新增 `turnOrigin` 与 `turnOriginLabel`。`@zhin.js/agent/trace` 新增导出 `turnOriginLabelOf()`、`turnOriginDisplayName()`、`turnOriginKey()`、`withScheduleJobLabel()`、`summarizeTraceSessions()`、`sessionLabelFields()`、`withSessionScheduleLabels()`、`TURN_TRACE_SESSION_CONVERSATION_LIMIT` 与类型 `TurnOriginLabel`、`TurnTraceSessionConversation`、`TurnTraceSessionLabelFields`。
  - `zhin.js`：Console `plugin.root.tool-approvals` 的卡片（`ToolApprovalCard`）新增 `origin`（与 trace `origin` 同形状）与可读名 `platform`、`scopeKind`、`sceneLabel`、`displayName`（卡片的 IM `origin` 只保留 `platform`、`endpoint`、`scope`、`sceneId` 与 `conversation: { kind, id, name? }`，新增导出类型 `ToolApprovalCardOrigin`）；trace 会话摘要里的定时任务会话、用量统计 `bySession` 里的 `schedule:<id>` 会话在实例还认得该任务时用任务的 `label` 命名（之前显示 `sched_<id>`）。
  - `@zhin.js/gateway`：用量统计新增可选 resolver `resolveScheduleJob`（导出类型 `UsageScheduleJobResolver`），定时任务会话的 `sceneLabel` / `displayName` 用任务名；会话名清理控制字符与双向控制符（新增导出 `sanitizeSessionText()`、`formatSessionDisplayName()`），缺 `platform` 时取会话的适配器，空白的 `scope` / `sceneId` 退回 `conversation.kind` / `conversation.id`。
  - `@zhin.js/cli`：`zhin trace --sessions` 每行显示 `平台 · 私聊/群 名称（短会话键）`（与 `zhin usage report` 同格式，输出前转义控制字符），跨多段聊天的会话在下面缩进列出每段聊天；没有记录来源的旧 trace 仍显示完整会话键。

- 637383b: 确认 / 取消词统一为一套词表，中英文都认、不分语言（zhinjs/zhin#1250 第 74 批）。之前至少 6 处各有一份词表，有的按提问语言分开（中文提问回 `yes` 不算确认），有的中英混收，有的只认一个词。

  - 新增导出（`@zhin.js/core`，经 `zhin.js` 再导出）：`isConfirmWord(text, options?)`、`isCancelWord(text, options?)` 与类型 `ReplyWordOptions`。匹配先做 NFKC（全角转半角）、去首尾空白、去掉末尾标点（`！!。.？?` 等）、不区分大小写，再整句比对——`我不确定`、`取消了吗` 都不是取消词。
  - 基础确认词：`确认` / `确定` / `同意` / `confirm` / `yes` / `y` / `ok` / `agree`；基础取消词：`取消` / `退出` / `算了` / `cancel` / `quit` / `exit`。是非答语 `是` / `好` / `true` 与 `不` / `否` / `拒绝` / `no` / `n` / `reject` / `false` 只在明确的是非问答里算（`{ yesNo: true }`：`confirm` 提问、布尔列表），普通对话里一句「不」或「no」不会被当成取消。选项序号 `1` / `2` 只在 `confirm` 提问与布尔列表里局部认。
  - 行为放宽：`confirm` 提问不再按提问语言区分回答（中文提问回 `yes`、英文提问回 `取消` 都有效；提问与提示文案仍用流程固定的语言），并新增 `确定`、`好`、`不`、`ok`、`算了` 等；`select` / `multiselect` / `number` / `list` / `text` 的取消词新增 `算了`，并接受全角、大小写与末尾标点；选项的名称与别名比对也做同样的规范化（`生产。` 选中「生产」）。普通 `select` / `multiselect` 只按名称、别名与序号匹配，不会因为选项名或别名在词表里就接受同类词（选项「好」不认 `ok`，选项 `N` 不认 `no`）。
  - 审批（`purpose: 'approval'`：普通审批、`humanOnly`、需主人、一次性确认）更严，只认明确答语，中英文不分提问语言：批准是 `确认` / `同意` / `批准` / `confirm` / `approve` / `yes`，拒绝是 `拒绝` / `否` / `no` / `deny` / `reject`，以及选项名与序号。`好`、`是`、`ok`、`y`、`true`、`确定`、`agree` 不再批准（之前英文审批认 `y`），按无效回答重问；`不`、`n` 也不再算拒绝。别名不再按语言分开，统一显示 `否 / no` 与 `确认 / yes`。回复 `取消` / `cancel` 等取消词仍算拒绝（现在与其他提问一样按取消离开，并回复「已取消。」）。
  - Agent 停止当前回合：`取消` 之外也认 `退出`、`算了`、`quit`、`exit` 及全角、大小写、末尾标点；`@zhin.js/agent/turn` 的 `isCancelIntent(text, commandPrefix?)` 新增可选参数，带命令前缀的取消词（如前缀为 `/` 时的 `/cancel`、前缀为 `#` 时的 `#取消`）按会话真实的命令前缀剥离后识别，不再写死 `/cancel`——命令前缀不是 `/` 的会话里，`/cancel` 不再停止回合（发 `cancel` 或带本会话前缀即可）。
  - 聊天重启 `restart` 的确认参数、功能自助 `功能 确认 <码>` 的确认子命令认所有基础确认词（如 `restart 确定`、`restart ok`、`功能 OK 123456`），仍需同一个人在同一会话、在时限内确认；`是` / `no` 等是非答语不算。
  - 插件：提醒创建（`@zhin.js/plugin-reminder`）只对等待中的补问回复判断取消，不再把命令参数当取消（之前 `remind create 十分钟后 取消` 会直接取消；现在 `remind create 明天9点 退出` 按正文「退出」创建）。提醒的补问与点歌选择（`@zhin.js/plugin-music`）之前只认当前语言的一个取消词（`取消` 或 `cancel`），现在不分语言都认上述取消词；回复文案仍用流程固定的语言。

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

- 93c5172: #1250 第 83 批：Agent 管理命令改为 Root 命令，和 `bind`、`config`、`restart`、`language` 一样走命令分发。

  - `models`、`health`、`tree`（`tree N`）、`fork N`、`compact`、`reset`，以及启用语义记忆时的 `memory`、`memory forget <key|id|all>`，由 zhin 实例的 Agent Host 注册（未安装 Agent 时不存在）。它们出现在菜单 / 帮助里，有近似指令提示，参数由命令模块解析（`tree 0`、`fork` 缺编号等给出用法），处理结果记 `command_replied`；命令认领的消息不进入 AI 回合。都不设冷却。
  - 权限：`models`、`health`、`tree`、`fork`、`compact` 声明 permit `trusted`（本会话链上任一 zhin 聊天角色，与原来的「有宿主聊天角色」判定等价），菜单只给有权限的人列出；群里无权限者静默（`permission_denied`），私聊回复原因；拒绝原因只有 `denied:trusted` 一种（不再有 `not_operator`）。
  - `reset` 对所有人开放，菜单里人人可见：有聊天角色的人发它直接归档当前会话（成功归档的固定确认仍记为本会话自己的投递，ADR 0067 D8）；其他人发 `reset` 等同 `/clear`——同一条清空路径、AI 触发与 @ 要求、确认冷却、控制面与发言闸门，不再回复无权限或「改发 /clear」的引导。
  - 只回应人：消息来源标为其他机器人（`origin` 不是 `human`）时这些命令不回复、不执行，结局 `filtered_by_policy`（原因 `non_human_origin`），与改前 Agent 入站的处理一致。
  - 命令在分发它的那一代上运行：推理与模型操作持有的是这条消息被分发时那一代的租约（Host 操作资源里的分发租约），不再取当前最新一代。没有 Host 模型操作时 `tree N`、`fork`、`compact` 报错，不再直接执行。
  - `memory` 在群聊 / 频道里不再把发送者的记忆公开到群里，只提示「记忆只在私聊里列出，请私聊机器人发送 /memory 查看」（中英文）；私聊照常列出。`memory forget` 在群里照常执行，只回复遗忘了几条，不回显记忆内容。`memory` 只作用于发送者自己的记忆；语义记忆未就绪时回复「未启用长期记忆」，不再交给 AI。
  - （不兼容）删除无前缀 `ai.health`（改用 `health` 命令）；`forget` 改为 `memory forget`。
  - `@zhin.js/agent`：（不兼容）删除 `handleRuntimeManagementCommand`、`RuntimeManagementDeps`、`RuntimeManagementSenderRoles`；新增 `createRuntimeManagementCommands()`、`RUNTIME_MANAGEMENT_PERMIT` 与类型 `RuntimeManagementCommand`、`RuntimeManagementCommandHost`（`open(message, dispatch, run)`、`clear(message, dispatch)`）、`RuntimeManagementDispatch`、`RuntimeManagementOperation`；`AgentTurnIngressRoute` 新增 `runManagementOperation()` 与 `clearAsCommand()`；`createHostOperationResources()` 的 IM 操作资源额外提供分发租约（内部令牌）。入站管理阶段（`tryHandleIngressCommands`）只保留带短码的 `rule …`、`approve …` / `deny …` 与主人 `/approve …`，其上下文去掉 `lease`、`operationSignal`、`sessionKey`、`senderRoles`、`withInference`、`withModelScope`、`replyFixed`。

- 45dcb9e: #1250 第 84 批：收尾第 83 批（Agent 管理命令改为 Root 命令）的复审问题。

  - 命令只回应人：命令分发统一过滤非人类来源。消息的可信来源 `origin`（或没有可信来源时适配器自报的 `metadata.origin`）不是 `human` 时，这条消息不进任何命令——不执行、不回复无权限（permit 拒绝）、不给近似指令提示，对所有插件命令都生效；结局 `ignored_bot`（原因 `non_human_origin`，阶段 `command`）。过滤分两层：入站分类器判出的可信来源 `self` / `member` / `peer_bot` 在入站阶段就丢弃（结局 `ignored_self` / `ignored_bot`，阶段 `ingress`），中间件、事件处理器和命令都收不到；命令分发层的过滤是兜底，只对没有可信来源、靠 `metadata.origin` 自报的消息生效，这类消息中间件与事件处理器照常收到。「只回应人」只覆盖 PeerRegistry 里登记过的 zhin 机器人（以及出站台账认得出的本实例消息）：不在 PeerRegistry 里的第三方机器人会被分类器判成 `human`，命令照常响应。Agent 管理命令里各自的来源判断随之删除（结局由 `filtered_by_policy` 改为 `ignored_bot`）。
  - `@zhin.js/core`：新增导出 `isNonHumanOrigin()`（`@zhin.js/core/runtime`，Agent 入站复用同一判定）；`InboundOutcomeSink` 新增可选 `reportCount()`；`ImOperationResourcesInput` 新增可选 `conversationSequence`（这条消息在会话里的序号）。
  - 结局如实：指令什么都没返回、什么都没发，且执行期间自己记了结局时，分发层不再追加 `command_replied`（它的优先级会压过静默结局）。没有聊天角色的人发 `reset` 却没有清空时，结局记 `not_addressed`（原因 `clear_command`：群里未 @、AI 不回应他等）、`filtered_by_policy`（原因 `outbound_stopped`：控制面停了出站），直播间里记 `not_addressed`（原因 `live_room_clear`）；清空了但冷却期内没有再发确认时记 `cleared`。新增两条原因级结局说明（ADR 0061 表同步）。
  - 直播间里没有聊天角色的人发 `reset`：保持静默，不清空也不进 AI 回合（文档写明）。
  - `reset` 的清空路径带上这条消息的会话序号，发言闸门把截至这条消息的场景事件（如刚被禁言）折叠进来再判断。
  - 分发租约只给 Root 自己分发的 Root 命令操作（Agent 管理命令）：插件命令 / handler 的操作资源里不再有分发租约，深路径导入内部令牌也拿不到，无法钉住旧快照代。操作的 owner 由框架绑定，不由调用方自报：交给插件的消息视图只为它自己的作者打开 Host 资源，自称 Root（`owner: snapshot.root`）时这次操作没有任何 Host 资源；`CommandIndex.dispatch` 从来源消息读操作资源时改从命令作者的视图读取（在执行策略计数之前读取）。
  - 插件中间件 / handler / 按钮回调经 `CommandIndex.dispatch({ input, source: context.input })` 分发 Root 命令（项目自己的命令与宿主命令）照常执行，装不装 Agent 都一样，拿到的资源与直接发送一致（例如推理客户端），只是没有分发租约：消息视图经插件作者改绑（含 P → Q → Root、Root → P → Root 等多跳，记为第一个插件作者）时，Host 收到 `ImOperationResourcesInput.delegatedFrom`（新增可选字段）并只去掉分发租约。
  - 分发租约不靠令牌保密：Agent 管理命令只认**本 Host 实例**签发的租约端口，并由 Host 侧用真实快照存储再校验一次。`createHostOperationResources()`（`@zhin.js/agent/runtime`）返回值新增 `isDispatchLease(port)`，只认这个工厂实例自己签发的端口（登记在实例私有的 WeakSet 里，不再是模块级登记：插件自己调用公开的 `createHostOperationResources()` 签出的端口不算）；`RuntimeManagementCommandHost` 新增必填 `isDispatchLease`，Agent Host 把自己那个实例的判定传给 `createRuntimeManagementCommands()`。`AgentRuntime` 新增 `ownsLease(lease)`，`AgentTurnIngressRoute.runManagementOperation()` / `clearAsCommand()` 用它校验命令交来的租约属于这个 Root 的真实 SnapshotStore，不属于就拒绝。调用方经显式 `operation` 自造资源视图、对租约令牌（id 可读）回答 `has` / `use` 的，拿不到租约；没有 Host 资源时同样不执行。需要分发租约的 Agent 管理命令（`models` / `health` / `tree` / `fork` / `compact` / `reset`）经插件转发（或自造 `operation`）时不执行，回复中英文提示请用户直接发送该命令（带这条消息的命令前缀，如「请直接发送 /reset。」）。
  - `CommandIndex.dispatch`：调用方没传 `commandPrefix` 时用来源消息自身的 `commandPrefix`（帮助文本、命令里的 `formatCommand` 都带前缀）；显式传入消息自身的 `snapshot` 与不传等价——同样校验命令表、按 endpoint 过滤被关插件的命令（ADR 0050，之前显式传入会绕过）、拿到同样的资源；从来源消息读操作资源在执行策略计数之前，读取失败不占冷却额度。
  - 结局如实：经插件转发（来源为框架消息、未传 `operation`）的命令以 UserFacingError 拒绝时，`CommandIndex.dispatch` 自己记这条消息的结局 `refused`（原因为命令的拒绝码，如 `direct_command_required`，阶段 `command`），不再只剩中间件的 `handler_replied`。`dispatch` 返回的 `value` 就是给用户的回复（含拒绝提示），中间件必须把它回复出去（文档示例改为 `return result.value`）；中间件不回复时用户收不到提示。`@zhin.js/feature-kit` 新增内部钩子 `operationInputOutcome` / `reportOperationInputOutcome()`，由框架消息实现。
  - `createRuntimeManagementCommands()` 必须配合 Host 资源（同一个 `createHostOperationResources()` 实例的 `im` 端口与 `isDispatchLease`）。没有 Host 资源时（嵌入方没接），需要租约的管理命令即使用户直接发送也不执行，回复「管理命令在此实例不可用。」/「Management commands are not available on this instance.」，结局 `refused`（原因 `management_unavailable`，新增原因级结局说明，ADR 0061 表同步），不再误答「不能经插件转发执行，请直接发送」。

### Patch Changes

- 126023d: 聊天重启命令 `restart`（别名 `重启`、`reboot`）更安全（zhinjs/zhin#1250 第 68 批）：仍只给全局层 `owner`（私聊与群聊均可，其他人得到原有的无权限回复），现在需要二次确认——第一次发送只回复确认提示，60 秒内由同一个人在同一个会话发送 `restart confirm`（或 `重启 确认`）才执行，过期、换人或换会话都无效。确认后仍先回复「正在重启」，再经与 Console 重启相同的网关路径重启实例；不受网关监管时说明原因且不做任何事。每次请求、拒绝与确认记入 Console 审计（`instance.chat:restart`，只记身份与会话标识），确认触发时写一条 `instance_restart_requested` 日志。不新增公共导出。
- 53d2523: #1250 第 73 批：审批卡、群规卡与提示里的命令按本账号的真实命令前缀书写，并按收件人的语言输出。

  - `@zhin.js/agent`：IM 审批卡（危险工具卡与变更审批卡）、群规预览卡、「Bot 不是管理员」群通知与群规冲突提示不再写死 `/`：卡片按收件 Endpoint 的真实命令前缀拼写 `approve <id>` / `deny <id>` / `rule approve <短码>` / `rule disable <短码>`（与入站解析剥掉的前缀一致）。默认值由 `/` 变为「裸命令 + 加前缀提示」：前缀未知时卡片、「Bot 不是管理员」通知与冲突回复都给裸命令并提示加上本账号的命令前缀。这些卡片、通知、`approve` / `deny` 与 `rule …` 的回复按收件人 / 发送者的语言输出中英文，过期时间改用 `YYYY-MM-DD HH:mm:ss`；群里公开的通知（禁言等阶梯通知、「Bot 不是管理员」）与默认群规模板的说明用项目语言，不随违规者的个人语言变化；踢人审批卡参数里的 `reason` 与定时任务被预算 / 超时终止的附注也按语言输出。
  - `@zhin.js/agent`（不兼容）：`formatImApprovalCard()` / `formatSelfChangeCard()` / `formatGroupRuleCard()` 的第 3 / 2 / 3 个参数类型变为命令呈现对象（`{ locale?, commandPrefix? }`，不再接受前缀字符串），返回值由 `string` 变为出站内容 `SendContent`；`ImApprovalSender`、`GroupRuleImDeps.send` 的第 2 个参数相应变为 `SendContent`，`GroupRuleImChannel.handleCommand()` 返回 `SendContent | null`。卡片与回复里所有由用户、模型或插件提供的内容（工具名与参数预览、会话与发起人、变更摘要、文件路径、diff 摘录、试跑详情、群规说明、`rule disable` / 待审回显的用户键）以 `untrustedContent(...)` 分段发送：出站模板不会展开其中的 `${…}`（自变更卡的 diff 摘录原样显示），其中的换行显示为 `⏎`；diff 摘录与群规说明作为 `│ ` 引用行列出，命令行只来自框架文案。变更回报（自变更生效 / 回滚等私聊与会话回报）整体按字面发送，摘要折成一行。删除导出常量 `GROUP_RULE_TRIGGER_LABELS`（中文固定标签，改为按语言取）；`defaultGroupRuleTemplate()` 新增可选参数 `locale`。`formatGroupRuleStage()` / `formatGroupRuleNotice()` 新增可选参数 `locale`；`ImToolApprovalChannelOptions`、`GroupRuleImDeps` 新增可选 `resolvePresentation`，`GroupRuleEffects` 新增可选 `presentation`，`ImApprovalCommandInput` 新增可选 `locale` 与 `senderIsGlobalOwner`，`GroupRuleCommandInput` 新增可选 `locale`、`commandPrefix`，`AgentTurnIngressRouteOptions` 新增可选 `resolveConversationPresentation`，`EnsureDefaultGroupRuleInput` 新增可选 `locale`。
  - `@zhin.js/agent`：主人 `approve` 指令与自变更卡的私聊结算改为「发送者是任一全局聊天主人（global owner）」（`OwnerApprovalCommandContext` 新增必填 `senderIsGlobalOwner`），不再只认账号解析出的第一个 owner；放行规则仍记在账号的 owner 地址下。拒绝文案改为「仅全局聊天主人（global owner）可在私聊中使用此指令」，并给出步骤：先私聊发「绑定 <码>」绑定聊天身份，再在 Console「聊天角色」给自己授予全局 owner；或私聊发「认领 <码>」。模型空回复兜底（`formatReplyFallback()` / `formatToolCallsForUser()` 的 `context` 新增可选 `locale`）按回合语言输出英文，`/clear` 是不需要前缀的入口词，保留字面。
  - `zhin.js`：实例为这些回合外的卡片解析命令呈现时，前缀取自 IM 运行时提供给出站模板的同一个命令环境（与入站命令分发同一个 dispatcher，含 `ImRuntimeOptions.commandPrefix` 覆盖），语言取收件人的偏好（群里取项目语言）；`绑定` / `功能` / `角色` 三个命令声明中文首选名，中文的用法、翻页与全局确认提示写成 `#功能 列表` 这样的中文命令，命令菜单同步显示中文名。

- 50b577d: #1250 第 75 批：群里无权限者发确认 / 审批 / 管理类命令时，机器人不回复、不执行，避免旁人乱操作刷屏；私聊照旧回复无权限原因，有权限的人操作出错（确认码过期、格式不对等）照常提示。这些拒绝都记为入站结局 `permission_denied`（群里 `reply: no`，私聊 `reply: yes`），Console「消息结局」可查；原有审计照常写。

  - `@zhin.js/agent`：Agent 管理命令（`models`、`tree`、`fork`、`compact`、`reset`、`ai.health`）对非主人 / 受信任用户、审批卡命令 `approve <id>` / `deny <id>` 对不在审批人名单且不是能结算该自我变更卡的全局主人、主人命令 `approve …` 对非全局主人（全局主人在群里发仍提示改用私聊）、群规命令 `rule approve|reject|disable …` 对非群管理员 / 非审批人：在群聊与频道里不回复，消息在入站管理阶段终止，不会再进入 AI 回合（模型不会代为回答「没有权限」）；私聊回复不变。群规命令在频道等非群会话、或群规不可用时也先判审批人：非审批人静默，只有审批人收到「只能在对应的群里用」「群规不可用」。`rules` 列表、`memory` / `forget` 仍对所有人开放。`RuntimeManagementDeps`、`ImApprovalCommandInput`、`GroupRuleCommandInput`、`OwnerApprovalCommandContext` 新增可选回调 `onUnauthorized(reason)`：处理器在回复是「无权限拒绝」时调用它（返回的文案不变），由入站阶段决定群里静默、私聊回复。
  - `@zhin.js/agent`（不兼容）：删除只为兼容保留的 `ingressMessages.cleared` 键（清空确认文案只在清空命令里使用）。
  - `@zhin.js/core`：别人提问的确认 / 选择按钮被旁人点击时，群里不再回复「交互已过期」（提问仍属于被提问的人，结局 `permission_denied`，原因 `interaction_not_own`）；旁人打字回答本来就不会被当成回答，现有测试锁定。带 `permit` 的按钮被不满足条件的人点击时，群里不再回复「你不能使用这个按钮」，私聊照旧说明。提问结束后 10 分钟内（最多记 512 个按钮）仍记得它是问谁的：旁人在群里点已结束提问的按钮也不再回复「交互已过期」，被提问的人自己点仍提示过期，记录过期或被挤掉后按原样提示。插件命令的 `permit` 不满足、且不满足的是对发送者的条件（zhin 角色、`platform:*` / `platform-role:*` / `platform-permission:*`、`user(…)`、插件自定义 permit）时，群聊 / 频道里不再回复「没有权限执行此指令」（也不调用自定义命令反馈渲染器），结局 `permission_denied` 记 `reply: no`；场合条件（`private()`、`group()` 等）与机器人自身条件（`bot:*`）照常回复，例如 `config` 在群里仍对所有人回复。不新增公共导出。
  - `@zhin.js/command`：命令被拒时，若最先不满足的是场合或机器人条件、而发送者也不满足某个对发送者的条件，拒绝结果改为指名后者（`denial.permit`），使群里对无权限者静默；例如 group-suite 的 `teach`（`group()` + `trusted`）被不受信任的人在私聊里发时，回复改为说明需要 zhin 角色。
  - `zhin.js`：聊天 `restart` 对非全局主人在群里不回复（审计原因 `not-global-owner`）；另一位全局主人替别人确认他发起的重启时，审计与结局原因记 `confirmation-not-own`，但他有权限，群里照常提示「没有待确认的重启」；主人自己的确认过期或参数不对照常提示。`功能` / `角色` 自助在任何范围都没有 admin 时先按 `not-admin` 拒绝（`角色` 的用法错误、找不到人等格式类拒绝不再在群里回复无权限旁人），该范围没有 admin、角色不足以授予 / 撤销（`not-admin`、`role-denied`、`owner-denied`、`peer-denied`），或确认码属于别人（新拒绝原因 `confirm-not-own`；确认者本身是全局 admin 时照常提示）时，群里不回复，私聊照旧说明；有 admin 的人的用法错误、确认码过期等仍回复。不新增公共导出。

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

- a5ac09e: #1250 第 85 批：收紧入站路由与 Agent 管理命令的分发租约。

  - `ingressRouteToken` 改为 Root 私有 token（`createRootPrivateToken`）：插件作用域 `use` / `has` 读不到它，运行时快照的公开资源里也没有它。IM 运行时改经 Root 的真实快照存储按消息租约读取：`resolveIngressRoute(snapshots, lease)`（签名变化，原来是 `resolveIngressRoute(snapshot)`）；`executeInboundTurnSpine` 不再从快照公开资源回退读取路由，只用 `envelope.ingressRoute`。
  - 令牌下承载的也只是入站钩子的窄外观：新增 `createIngressRouteFacade(route)`（`@zhin.js/core/runtime`），返回冻结对象，只有绑定到路由的 `preRoute` / `shouldRouteBeforeDispatch` / `route`；Agent Host 不再提供 `AgentTurnIngressRoute` 对象本身，路由的选项（Agent 运行时、快照存储）与 `clearAsCommand` / `runManagementOperation` 都不经令牌暴露。`AgentTurnIngressRoute` 的选项改为 ECMAScript 私有字段（`#options`）。
  - 纵深防御：`AgentTurnIngressRoute` 的 `route` / `preRoute` 只处理 Root 真实快照存储签发且仍有效的租约（`AgentRuntime.ownsLease(lease) && lease.active`）；伪造或他人的租约不路由（返回 `false`，静默，记一条 warn 日志），伪造消息无法借此执行清空等操作。
  - 分发租约只认本 Host 分发交出的：`createHostOperationResources()` 返回值新增 `holdsDispatchLease(lease)`（只认本工厂签发的租约端口 `retain()` 交出的租约），`AgentTurnIngressRoute` 新增可选项 `holdsDispatchLease`；管理路径除了用真实快照存储校验，还要求租约是本 Host 分发交出的，直接从快照存储 `acquire()` 的租约不执行。**行为变化（嵌入方）**：自行装配时必须把同一个 `createHostOperationResources()` 实例的 `holdsDispatchLease` 传给 `AgentTurnIngressRoute`，不传时 `/models`、`/health`、`/tree`、`/fork`、`/compact`、`/reset` 一律以 `dispatch_lease_rejected` 拒绝；`runManagementOperation` 收到没有 `retainLease` 的分发时也同样拒绝（与 `clearAsCommand` 一致）。校验抛错时，已 retain 的租约在抛出前释放。
  - Host 侧拒绝租约时不再抛普通错误：以 UserFacingError 拒绝（结局 `refused`，原因 `dispatch_lease_rejected`），回复「这条管理命令没有通过本实例 Agent Host 的分发校验，没有执行。」（英文同义）。
  - `createRuntimeManagementCommands()` 新增可选项 `hostResourcesInstalled`：Host 接好操作资源时传 `true`（`zhin start` 装配的实例已传），调用方自传的 `operation` 即使不提供任何资源，管理命令的结局也是 `direct_command_required`（之前误报 `management_unavailable`）。`imOperationResourcesToken` 是 Root 私有 token，不在运行时快照的公开资源里，所以由 Host 显式声明，而不是从快照判断。
  - 结局说明新增原因级模板 `refused` / `direct_command_required` 与 `refused` / `dispatch_lease_rejected`，ADR 0061 表同步；`docs/ai/agent.md`（中英文）补充说明。

- Updated dependencies [0899424]
- Updated dependencies [7f39b10]
- Updated dependencies [637383b]
- Updated dependencies [50b577d]
- Updated dependencies [49f9042]
- Updated dependencies [a05eb73]
- Updated dependencies [ee51324]
- Updated dependencies [58ce469]
- Updated dependencies [d3aae4d]
- Updated dependencies [74eb13a]
- Updated dependencies [45dcb9e]
- Updated dependencies [a5ac09e]
- Updated dependencies [884d827]
  - @zhin.js/core@1.14.0
  - @zhin.js/im-contract@1.3.1
  - @zhin.js/adapter@1.6.0
  - @zhin.js/plugin-runtime@1.5.0
  - @zhin.js/command@1.5.0
  - @zhin.js/console-protocol@1.9.0
  - @zhin.js/host-http@1.8.0
  - @zhin.js/permission@1.3.0
  - @zhin.js/kernel@1.6.0
  - @zhin.js/feature-kit@1.1.21
  - @zhin.js/component@1.2.2
  - @zhin.js/middleware@1.1.22
  - @zhin.js/prompt-section@1.1.21
  - @zhin.js/schedule-feature@1.1.21

## 1.9.0

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

### Patch Changes

- dff78e6: #1250 第 55 批：定时任务权限收紧。

  **行为变化：普通用户在聊天里只能看到、管理自己的任务。**

  - 聊天工具 `schedule_list`：所有者（`owner` 角色）照旧看到全部持久化任务；其他人（群管理员也一样）只看到自己在聊天里创建的任务（同一用户、同一平台账号与 endpoint，与 `createdBy` 记录的规则相同）和投递到当前会话的任务，不再看到别人的提示词、投递目标与 Agent；投递到当前会话的他人任务，会话成员能看到其提示词与标签。非 IM 来源（A2A、MCP、到点运行、远程 Mail 等，`createdBy` 没有聊天地址）创建的任务不认创建者，只有所有者能在聊天里看到和管理，避免共用的 `a2a-client` / `mcp-client` / `schedule` 或对端自报的 id 互相冒充。任务指定的 Agent 不在当前会话可用的 Agent（`@名称` 可见范围加默认 `zhin`）之内时，只显示「其他 Agent」（`agent_hidden: true`）；已从配置删除的 Agent 只对所有者显示名称，其他人看到「其他 Agent」（仍带 `agent_missing: true`）。插件内存任务（只有插件名与 cron）照常列出。
  - 聊天工具 `schedule_remove` / `schedule_pause` / `schedule_resume`：所有者可以管理任何任务；其他人只能管理自己创建的任务；任务不存在与不是自己的任务得到同一句「未找到你能管理的任务：<id>」，不透露任务是否存在（所有者仍得到「未找到」）。Console / CLI / Profile 创建的任务（没有 `createdBy`）只有所有者能在聊天里管理。Profile 例程（`source: profile`）在聊天里一律不能删除、暂停或恢复（重启会还原），提示去 Profile 文件（`assistant.profile.file`，默认 `assistant.profile.yml`）修改。
  - Console `cron:resume` 与 `POST /api/assistant/jobs/resume`：恢复后任务会再次投递，因此与 `cron:add` / `cron:set-agent` / `POST /api/assistant/jobs` 一样，任务有 IM 投递目标时要求该账号上的 `endpoint.operate`，否则 403 `schedule_target_forbidden`（RPC：`data.code` / `data.status: 403`）。暂停与删除仍只需 `ops.schedule.write`。
  - Agent 不存在时，`cron:add`、`cron:set-agent` 与 `POST /api/assistant/jobs`、`POST /api/assistant/jobs/set-agent` 的错误新增 `data: { code: 'schedule_agent_not_found', agent, available }`，错误文本不变。
  - 预演不再自己建任务（所有者反馈 `schedule-preview-prompt-creates-schedule`）：预演回合不提供内建的 6 个调度工具（`schedule_list` / `add` / `preview` / `remove` / `pause` / `resume`，带插件前缀的同名限定名与执行计划里点名的也排除；第三方的 `schedule_meeting` 等照常提供），模型把「明天 8 点提醒我喝水」这类建任务请求原样传给 `schedule_preview` 时，预演不会再调用 `schedule_add` 并被无人值守规则拒绝、让用户点了允许却收到「任务没建成」。`schedule_preview` / `schedule_add` 的 `prompt` 参数说明改为「到点要执行的内容（例如『提醒我喝水』），不是建任务的请求，不要包含时间安排」。调度回合的执行画像（`TurnExecutionProfile` 的 `schedule` 分支）新增可选 `preview`。
  - Profile 例程写的 Agent 不在配置中（`zhin` 与 `ai.agents`）时，启动同步记一条警告日志 `profile_routine_agent_missing`；任务照常同步。`syncProfileRoutinesToStore` 新增可选的第三个参数 `{ agents }`。

- 8e34118: `zhin schedule resume` 被投递目标拒绝（403 `schedule_target_forbidden`）时说明原因（你没有权限向该任务的投递目标发消息，需要哪个账号上的 `endpoint.operate`）并以非零状态退出；`add` / `set-agent` 遇到 `schedule_agent_not_found` 时列出实例返回的可用 Agent（`data.available`）并提示如何改选（zhinjs/zhin#1250 第 61 批）。

  `/assistant/jobs` 的 `schedule_target_forbidden` 对没有指明账号（缺 `scene.platform` / `scene.endpointKey`）的投递目标不再拼出「需要 undefined / undefined 上的 endpoint.operate」，改为与 Console RPC 一致的「投递目标需要指明账号」。

- Updated dependencies [dff78e6]
- Updated dependencies [23eb6ef]
- Updated dependencies [19eeb90]
  - @zhin.js/host-http@1.7.1
  - @zhin.js/core@1.13.1
  - @zhin.js/console-protocol@1.8.0

## 1.8.0

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

### Patch Changes

- 83ab59d: Console 群聊插话状态（`plugin.root.ambient` RPC）返回值新增可选字段 `judgeToday`（`YYYY-MM-DD`）：实例时钟在 `judgeTimeZone` 下的今天，与 `judgeDaily` 按同一 `dayKeyOf` 切天，没有任何判断调用时也返回（#1250 第 48 批）。Console 的「最近 7 天」窗口应以它为准（保留截止日 = `judgeToday` 往前 6 天），不再用浏览器时钟推算，避免浏览器与实例时钟有偏差时漏掉实例上的今天、或把已清理的日期显示成 0。
- 7131501: 出站 / 入站媒体下载只连默认端口（#1250 第 48 批，第 46 批安全审查 L3；**行为变化**）。

  - `fetchPublicMediaBytes()`（kernel）与 `fetchOutboundMedia()`（core）默认只接受 https 的 443，以及 `allowHttp` 时 http 的 80（URL 不写端口或写默认端口都算）；其他端口（如 `https://public-host:22/`、`:8443`、`:0`）一律拒绝，重定向的每一跳同样检查，防止借实例对任意公网主机和端口发起 TLS 握手做端口探测。
  - 被拒时沿用 `blocked` / `outbound_media_url_blocked`，附 `reason: 'port'`（`PublicMediaFetchResult` 与 `OutboundMediaFetchError` 新增可选 `reason`，日志行带 `reason=port`）；说明文字和日志只含主机名，不含完整 URL。
  - 新增可选参数 `allowedPorts?: readonly number[]`（`PublicMediaFetchOptions` / `OutboundMediaFetchOptions`）用于注入额外端口；只对首个 URL 的 origin（scheme、host、port 都相同，`allowHttp` 时的 http 同样）生效，重定向到其他 origin 仍只允许默认端口；默认不放开，不提供配置项。
  - `ai.imageStorage.publicBaseUrl`（R2）带非默认端口时，启动时直接报错（`imageStorage.publicBaseUrl must use the default HTTPS port 443`），不再等到发布的图片逐张被拒。
  - 入站识图 `fetchUrlAsBase64()`（agent）与语音转写下载随之生效；语音下载失败日志的 `reason` 为 `blocked:port`。

  **可能出现回退的场景**：公网部署的协议端（OneBot / Satori / Milky 等）在非默认端口上提供语音或文件服务；自建图床使用非默认端口；R2 `publicBaseUrl` 带了端口。这些下载现在会被拒绝。排查：媒体下载日志里出现 `reason=port`（`outbound_media_url_blocked`），或语音下载日志里出现 `blocked:port`。协议端可信来源（为平台自带地址放行端口）的支持会在后续 PR 补上。

- 1414572: 协议端自己端口上的媒体地址不再因端口限制被拒（#1250 第 48 批端口限制的后续）。

  - 端点的 `inboundMedia` 新增可选 `origins()`：声明 Endpoint 配置的协议端地址（`http(s)://` 或 `ws(s)://`，后者按同主机同端口的 `http(s)://` 处理）。`roots()` 改为可选，只声明 `origins()` 的端点同样有效。
  - `fetchPublicMediaBytes()`（kernel）新增 `trustedOrigins`：URL 本身就在其中某个 origin 上（scheme、主机、端口完全相同）时，这个 origin 内的各跳不受默认端口限制；从别处重定向进来、或重定向到别的端口，仍只认默认端口。私网 / 回环、scheme 与 DNS 固定检查照旧。
  - 适用范围：协议端部署在**公网**主机的非默认端口上。协议端与实例同机或在内网时，地址因私网规则被拒，与本次无关；识图下载仍只走 https，平台语音链接允许 http。
  - 入站识图与平台语音转写会带上产出端点声明的 origin；用户输入的地址（`[audio:URL]`、`voice_stt`）不受影响。
  - Satori、Milky 声明 `baseUrl`；OneBot11、NapCat 的正向 WebSocket 声明 `url`，NapCat 的 HTTP 方式声明 `http_url`；反向连接没有配置地址，不声明。

- Updated dependencies [7131501]
- Updated dependencies [1414572]
- Updated dependencies [c7f6285]
- Updated dependencies [257d289]
  - @zhin.js/kernel@1.5.0
  - @zhin.js/core@1.13.0
  - @zhin.js/adapter@1.5.0
  - @zhin.js/host-http@1.7.0
  - @zhin.js/console-protocol@1.7.0
  - @zhin.js/command@1.4.2

## 1.7.0

### Minor Changes

- 3b88aa7: 插话判断的「仅评估」改为可选的对照模型，一致率按「过门槛后会不会开口」比较（ADR 0066 P2）。

  - `purposes.ambient.compare` 选一个 Profile（语言或决策模型都可以）：主判断（经过备用链）照常决定；对照模型对同一份输入同时判一次，只记录、从不影响结果。两边都等结束再返回，共用同一个 15 秒预算；对照模型没有备用链，失败只记 `compare_failed`，不写全局跳过表。`mode: shadow` 时对照模型照常运行。开了对照模型，每次判断的模型调用翻倍（只发生在通过冷却、限次和判断间隔之后的判断上）。
  - `@zhin.js/agent` 新增 `CompareEngagementJudge`（取代废弃的 `ShadowEngagementJudge`）与类型 `EngagementCompareResult` / `EngagementCompareReport` / `CompareEngagementJudgeOptions`，判断结果新增 `compare`；`AgentAssistantStatusPort` 新增可选 `recordAmbientCompare()`，`recordAmbientShadow()` 废弃期内保留。日志 `ambient_compare`；`ambient_decision` 审计 payload 新增 `compare`（`engage` / `quiet` / `failed`）以及 `compareJudge` / `compareJudgeKind` / `compareJudgeProfile` / `compareJudgeModel` / `compareJudgeMs` / `compareJudgeUsage` / `compareJudgeError`，不含理由原文。
  - `zhin.js`：Console 群聊插话状态（`plugin.root.ambient` RPC）新增 `compare`：最近 24 小时一致次数、「主判断插话、对照不插」次数、「主判断不插、对照插话」次数、对照失败次数，并按给出结论的链成员（主项 / 第 N 个备用）分别列出；只有两边都给出结果才计入一致率。`decisionShadow` 废弃期内保留，填同样的数据（加上旧的陪跑记录），数值口径与旧版不同。新增导出类型 `AmbientCompareStatus` / `AmbientCompareCounts`。

- 14d752e: 群聊插话判断看得出用的是哪个模型、有没有切到备用、用了多少 token（#1250 第 47 批 `ambient-llm-judge-invisible`）。

  - 聊天模型做插话判断时，判断结果带 `source: 'language:<服务显示名>/<模型>'`（服务没有可读名称时退回驱动名或只写模型，不显示 `services:<uuid>` 这类内部 id）；另带 `ref: { kind, profile, model, fallbackFrom? }`，按 Profile id 标识模型，统计按它分组（ADR 0066 P0 结构化 `source` 的形状）；切到备用模型时 `source` 是实际作答的备用模型，并带 `fallbackFrom`（原来配置的模型）。备用信息来自用途备用层的切换观察器（`ModelFallbackLog`），切换同时记 `model_fallback` / `fallback_skipped` 日志。`ambient_engagement` 日志与 `ambient_decision` 决策审计照常带 `judge`，并新增 `fallbackFrom`；审计 payload 另带 `judgeFallbackFrom`、`judgeKind` / `judgeProfile` / `judgeModel` / `judgeFallbackFromProfile` / `judgeFallbackFromModel`、`judgeMs`、`judgeUsage`（只有模型、类别和用量，不含判断理由原文；对照判断留给 ADR 0066 P2 的 `compare` 前缀）。
  - 每次插话判断调用（聊天模型和决策模型，成功或失败）写一行 `[ai.usage] judge`，`scene: ambient`，带模型、`fallback_from`、input / output / cache token 与耗时；决策模型没有回传用量时只写次数和耗时。`calls` 是判断次数，不是模型请求次数：请求阶段切到备用时，`ms` 是两次请求的合计。
  - 判断失败（`judge_failed`）时，`ambient_engagement` 日志、`ambient_decision` 审计与 `ambient_silent` 结局写明是哪个模型、什么错误类别（如 `timeout`、`aborted`、`auth`、`safety_block`、`length`、`invalid_response`），不写原始错误全文；被调用方的超时或取消中止时，聊天模型和决策模型都只记一次，类别一致。
  - Console 群聊插话状态（`plugin.root.ambient`）新增 `judgeDaily`：最近 7 天每天的判断调用次数、失败与备用次数、按模型类型的次数、平均耗时和 token 合计（进程内存，重启后当天重新计；写入和读取时都去掉 7 天以前的数据），以及 `judgeTimeZone`。

### Patch Changes

- 49a1136: MCP 工具按聊天角色授权（ADR 0065 P0 + P1）。**行为变更：已经绑给聊天 Agent 的 MCP 服务器，升级后立刻收紧**——不写 `permit` 时，只有上游标注 `readOnlyHint: true` 的工具对所有人开放，其余工具（未标注、标注为写、`readOnlyHint` 与 `destructiveHint` 矛盾）只给全局主人 `owner@global`。迁移说明见 `docs/migrations/mcp-tool-permit.md`。

  - 接入 MCP 服务器时保留上游 `annotations`，转成 `McpToolDescriptor.hints` / `ToolCapability.mcpHints`（只接受布尔值）。标注只决定权限档位，不放宽审批：MCP 工具仍是 `on-risk`，照常走审批、文件策略、网络白名单和硬闸。
  - 配置：`ai.mcpServers[].permit`（`readOnly` / `default` / `tools`，值为 `everyone`、`deny`、一个 permit DSL 字符串或 DSL 数组），`ai.agents.<name>.mcpServers[]` 可写 `{ name, permit }`，与服务器级结果取 AND，只能收窄。`tools` 按上游原始工具名匹配：精确名优先，其次字面字符最多的 `*` 模式，并列时都要满足；非 ASCII 工具名只能被精确名命中。`everyone` / `deny` 放进数组、空数组、未知键、重复的模式、同一 Agent 里重复的服务器、DSL 写错（含已移除的 `master` 等）都会让启动报错。
  - 每轮组装工具池时按本轮发送者的聊天角色过滤：没有权限的 MCP 工具不进工具池，`discover`、`load_tool` 和 `alwaysLoaded` 里都没有。执行前按角色存储里的当前角色再判一次；会话历史里重放的旧调用、回合中被撤销的角色、子 Agent 沿用的父回合能力都会被拒绝，记 `tool_denied`，`policy: 'mcp-permit'`。
  - 定时任务按创建者当前的角色降一档运行，所以全局主人创建的任务默认也用不了「仅主人」的 MCP 工具；需要时在 `permit.tools` 里把该工具放宽到 `trusted`。A2A、zhin 自己的 MCP Server 入口同样只能用只读工具。
  - 恢复旧行为写 `permit: { default: everyone }`（不推荐：普通成员发起的写操作在 `execApprovalMode: auto` 下经自动审核即可执行）。
  - 修复：配置的 MCP 服务器投影给 Agent 的工具名带了一层多余的服务器前缀，调用上游时发送的也是带前缀的名字；现在使用上游报告的原始名。
  - 修复：合并的群聊回合（ADR 0038）此前只收窄 `roles`，聊天角色仍取第一个发言者的，permit（含 MCP 工具档位）因此把 trusted / admin 成员的工具借给了同一合并窗口里的普通成员；现在聊天角色取所有成员共同持有的最低角色，层级取最窄的。
  - 修复：`ai.agents.<name>.mcpServers`（含 Agent 层 `permit`）加入自我变更禁改名单，Agent 不能用 `self_change` 删掉收窄或给绑定加服务器。
  - 修复：跨进程 A2A Mailbox 的远端信件一律按 `user` 运行、不带聊天角色。此前对端声明的 `authority.trust`（如 `trusted`）会变成本地角色，签名正确的远端信件因此能用开放给 `trusted` 的 MCP 工具和插件工具。
  - 修复：读取上游 `annotations` 时只认工具自身的字段，继承来的 `readOnlyHint` 不算标注。
  - `@zhin.js/runtime`：配置 schema 增加上述两处字段，`ai.agents.<name>.mcpServers` 标为安全敏感。

- f5bf768: 插话判断改由一条判断器链负责切换备用模型（ADR 0066 P0，配置与行为不变）。

  - `@zhin.js/agent` 新增 `EngagementJudgeChain`：一次判断是一次操作，链成员（每个只是一个模型，语言模型或决策模型）按顺序尝试，共用整次判断的 15 秒预算；预算用完或调用方取消时立即停止。选型时跳过模型跳过表里的成员（不计失败），全部在跳过期时记 `judge_failed`（`all_unavailable`）。失败按 ADR 0066 D2 的表切换：配额用完、欠费、凭据被拒换下一个并写全局跳过表；超时、网络错误、5xx 只在本次判断内换，2 分钟内至少 2 次不同判断都这样放弃同一模型才全局跳过 5 分钟（超时与网络 / 5xx 分开计数）；回答无效换下一个但不写跳过表；单纯 403、限流、内容拦截、上下文超长不换。每次切换写 `ambient_judge_fallback` 日志并进入 `recentFallbacks`（`purpose: 'ambient'`）。新增 `createEngagementJudgeMember()`（按 Profile 的模型类型构造语言或决策判断器）、`engagementJudgeFailureAction()`、`engagementJudgeKindOf()`；`FallbackEngagementJudge` 标为废弃并改为链的薄包装。
  - 判断结果的 `source` 改为结构化的 `{ kind, profile, model, fallbackFrom? }`（与第 47 批的 `ref` 相同，`ref` 保留到废弃期结束），显示字符串移到 `sourceLabel`；审计 payload 的 `judge*` 键名不变，改从结构化 `source` 填写。整条链失败时，`judge_failed` 的 `failure.attempts`、`ambient_silent` 结局的 `detail` 和审计的 `judgeAttempts` 列出每个成员的失败类别。语言模型成员不再套用途备用层（`resolvePurposeExecution`），只有判断器链这一层切换；链里每个成员各算一次调用（`[ai.usage] judge`）。
  - `@zhin.js/ai`：`ProviderErrorKind` 新增 `invalid_response`（驱动以 `code: 'invalid-response'` 报告无法使用的回答），`ModelFallbackReason` 新增 `invalid_response`，`ModelFallbackEvent.purpose` 可为 `ambient`；新增导出 `classifyFallbackFailure()`。
  - `@zhin.js/service-typesafe`：请求失败保留 HTTP 状态、`Retry-After` 与响应体的错误码（不含正文），连接失败标为网络错误，SDK 超时标为 `timeout`，`classifyProviderError` 可以据此分类。

- 5cfb5d7: 「旁听」用途和决策「旁听参与判断」合成一项「插话判断」`purposes.ambient`，旧配置自动迁移（ADR 0066 P1，行为变更）。

  - 新的配置形状 `purposes.ambient: { profile, fallbacks, compare, minConfidence, mode, timeoutMs }`：主判断与备用链可以混排语言模型和决策模型（判断器按 Profile 的模型类型分派），`compare` 是只记录的对照模型，`minConfidence`（默认 0.7）是唯一的门槛，`mode: shadow` 是唯一的「只记录不插话」，`timeoutMs` 是决策模型成员的单次超时。字符串写法 `ambient: <profile>` 仍然有效；写入总是整项替换，`null` 清除。没写 `profile` 时继承部署聊天的主项和备用链（此时不能单独写 `fallbacks`）。只允许这 6 个键，Profile 必须存在、属于 Host、不能是图像模型，链内不能重复、不能包含 `profile`，`compare` 不能在链内；错误带路径（如 `purposes.ambient.fallbacks[1]`）。
  - **行为变化**：旧配置在 Host 加载模型配置时自动迁移一次（一个 CAS 事务，同时写迁移记录，`before` 保存迁移前完整的 `purposes`）。原来决策「启用」并单独配置了旁听语言模型的部署，该语言模型成为第一个备用：决策模型超时、网络错误、5xx、回答无效或配额用完时由它接手插话（以前直接不插话）。门槛取原来两道门槛中较大的值，插话不会因此变多。决策「仅评估」迁移为对照模型，主判断与插话行为不变；决策「关闭」的 Profile 不迁移。`zhin.config.yml` 的 `ai.trigger.ambient.minConfidence` / `mode` 在迁移时读入一次，之后不再生效（每个 generation 启动时警告一次）。迁移失败时不写数据库，本次按同一张表在内存里转换后运行，记 `ambient_judge_migration_failed`，下次加载重试。
  - **降级前必须先回退**：新增 `zhin ai purposes revert ambient-judge`（只能经本机网关执行），在 `purposes.ambient` 自迁移后没被修改时恢复迁移前的旧写法；旧版本读不了含 `purposes.ambient` 的模型配置。回退后当前版本仍按旧写法换算运行，不会自动再迁移。
  - `DecisionEngagementJudge` 不再设内部门槛（`DecisionEngagementJudgeOptions` 新增 `timeoutMs` / `mode`，`policy` 废弃），`AmbientEngagement` 只按 `purposes.ambient` 的门槛判一次，语言模型与决策模型都是 `engage && confidence ≥ minConfidence` 才插话。`DecisionPurpose` / `DECISION_TASKS` 去掉 `ambient`（决策用途剩五类）。
  - 废弃期（本 minor 和下一个 minor）：导入 `purposes.decisions.ambient` 时按迁移表合并进 `purposes.ambient`，导入结果带警告（`warnings`，路径 `purposes.decisions.ambient`）；导出只写新形状。自我变更和聊天里的 `config set` 不能再写 `ai.trigger.ambient.minConfidence` / `mode`。
  - 新增 `GET {base}/agent/inference/ambient-judge`（生效的插话判断与迁移记录，Host 管理员）、`POST …/ambient-judge/migration/noticed`、`POST …/cli/purposes/revert-ambient-judge`（本机 CLI）。
  - `@zhin.js/runtime`：配置 schema 中两键的描述改为「已废弃」。

- c86e2f6: Console 只显示真正生效的插话判断，`zhin doctor` 检查插话判断迁移与废弃配置项（ADR 0066 P3）。

  - 管理视图（`GET {base}/agent/inference`）的 `purposeEffects` 新增 `ambient`：实际使用的判断器链（成员与模型类型，跟随聊天时标 `inheritedFrom: 'chat'`）、对照模型，以及插话根本不运行时的忽略原因 `ambient-not-configured`（配置里没有 `ai.trigger.ambient`）/ `no-conversations`（没有任何群开启、也没有功能开关打开）；新增 `decisions.<task>`，关闭的决策用途标 `mode-off`。`PurposeIgnoredReason` 新增这三个值（新增类型 `AgentPurposeIgnoredReason`、`AmbientDeploymentView`，导出 `ambientPurposeEffects()`）。
  - Console 群聊插话状态的 `judges` 改为实际判断器链（决策模型判断时不再显示从未被调用的语言模型），新增结构化的 `judgeChain`（成员、类型、角色、是否在跳过期）和 `minConfidence`；`mode` 读 `purposes.ambient.mode`。`HostInference.ambientModels()` 返回 `AmbientJudgeStatusView`，新增导出 `ambientJudgeStatusView()`。
  - `zhin doctor`：迁移结果只提示一次（`--verbose` 可再看），迁移失败报错并给出要修正的位置，`ai.trigger.ambient.minConfidence` / `mode` 给出警告并可用 `--fix` 删除（其他键和注释保留），`purposes.ambient.minConfidence < 0.5` 时提示它对决策模型不起作用。
  - 文档：`docs/ai/index.md` 的「群聊旁听」改为「插话」，「判断模型」改写为「插话判断」（含切换表和置信度说明）；结构化决策改为五个用途；`provider-upgrade` 补废弃键；新增迁移说明 `docs/migrations/ambient-judge.md`（含英文版）。

- 8c0d262: 插话判断（ADR 0066）审查修复：yml 的「只观察」和门槛在所有路径上都不丢，回退能完整还原。

  **BREAKING（已批准的 minor）与迁移路径**

  - `EngagementJudgment.source` 由字符串改为对象 `{ kind, profile, model, fallbackFrom? }`：读显示文字改用 `sourceLabel`，判断模型类型改用 `source.kind`，按模型分组改用 `source.profile` / `source.model`。无法在不破坏类型的前提下同时保留字符串；`ref`（与 `source` 同一对象）和字符串 `fallbackFrom` 保留到废弃期结束。`EngagementJudgeCall` / `EngagementJudgeFailure` 的字符串 `source` 不变。
  - `DecisionPurpose`、`InferencePurpose` 的 `decision:ambient`、`DecisionTask` / `DECISION_TASKS` 去掉 `ambient`：改用 `PurposePolicy.ambient`（插话判断）。存储里的旧 `decisions.ambient` 仍会读取并自动迁移。
  - 联合类型新增成员：`PurposeIgnoredReason`（`ambient-not-configured` / `no-conversations` / `mode-off`）、`ProviderErrorKind` 与 `ModelFallbackReason`（`invalid_response`）。对这些类型做穷举（`switch`、`Record<…>`）的代码需要补上分支。

  **行为变更**

  - 判断结果没有 `gate`（自定义判断器）时，`AmbientEngagement` 回退读已废弃的 `ai.trigger.ambient.minConfidence` / `mode`，不会比以前多插话；直接构造 `DecisionEngagementJudge({ policy: { minConfidence } })` 时仍在判断器内按它把关（判断器链不设，门槛只判一次）。
  - 迁移完成后再写 `ai.trigger.ambient.mode` / `minConfidence`（旧版 Console、手工编辑、导入的配置）会在下次加载时转到 `purposes.ambient`，记 info 日志 `ambient_trigger_write_converted`，不再静默失效。
  - 空库首次启动从 `ai.plan.yml` seed 的 `purposes.ambient`，以及旧键仍生效时（未迁移、迁移失败、已回退）写入的 `purposes.ambient`，都会补上 yml 里仍生效的 `mode` / `minConfidence`；管理视图、`purposeEffects`、导出和插话状态按实际生效的值显示。
  - 废弃期内的旧写法：`purposes.decisions.ambient` 的 `off` / `null` 撤销决策模型与原「仅评估」的对照模型，恢复原来的旁听语言模型；字符串写法 `purposes.ambient: <profile>` 只替换语言模型，保留 `mode`、`compare`、`minConfidence`。
  - `zhin doctor`：只有运行中实例的迁移记录为 `migrated`、键已被迁移读入且值未再改动时，才提示 `ai.trigger.ambient.minConfidence` / `mode` 不再生效并允许 `--fix` 删除；实例未运行、未迁移、迁移失败或已回退时只给警告，拒绝 `--fix`。启动日志 `ambient_trigger_keys_retired` 只在已迁移时出现。
  - `zhin ai purposes revert ambient-judge`：先经配置写锁把迁移读入、之后被删掉的 yml 旧键写回，写不回则不回退并给出手工步骤，回退被拒时撤销写回；旧形状已不成立时拒绝并给出路径。
  - 迁移记录的 `noticedAt` 用 CAS 写入，与回退并发时回退优先。`FallbackEngagementJudge`（已废弃）恢复原有退避：成功清除退避，取消不记退避。插话状态的判断器链读请求所在 generation 的模型配置。判断器链和对照模型使用合并了 generation 停止信号的 `signal`。
  - `@zhin.js/service-typesafe`：失败请求只保留 `Retry-After` 响应头。`@zhin.js/scaffold-wizard`：决策用途检查改为五个，`purposes.decisions.ambient` 提示已废弃。
  - 复审修复：yml 里写回迁移时读入的原值（或已处理过的值）不再被当成新写入，`purposes.ambient` 不变、回退仍可成功；回退命令执行期间在迁移记录上标记 `revertPending`（CAS 写入，10 分钟后失效），期间暂停转换，结束时无论成败都清除。迁移前 seed 过的 `purposes.ambient` 回退时按 D5 表反向换成旧字段，门槛和模式写入 yml；旧版本表达不了的部分逐条列出，此时 CLI 不再提示「可以降级」并以非零状态退出。`zhin doctor` 比较 yml 值时两边都按运行时规则规范化，并按 `triggerSeen` 判断是否已处理。新增路由 `POST {base}/agent/inference/cli/purposes/revert-ambient-judge/pending`（本机 CLI）。
  - 第三次复审修复：旧 Console 先关「只观察」再打开时，写回的原值按新写入转换，最终仍是 shadow（只有存储的插话判断该键仍是迁移写下的值时，原值才不算新写入；`zhin doctor` 同样判断）。回退顺序改为：取得 `revertPending` 标记 → 干跑（`dryRun`，返回 yml 应有的值和旧版本表达不了的项）→ 写 yml（与现有值不同时以当前实际运行的值为准覆盖，并列出覆盖项；写不了就不回退）→ 提交回退（被拒时撤销 yml 写入）→ 清除标记；取不到标记时中止。回退相关路由写审计。
  - 第四次复审修复：回退时如果配置文件里有实例还没转换的旧键写入，拒绝回退（`pending-trigger-writes`，列出键），提示先重新加载实例，避免用迁移原值覆盖新写入；CLI 写入前再按同一规则检查一次文件。已从 yml 转换的门槛 / 模式不阻止回退，回退后按当前值运行。回退请求没有回应时先重读迁移状态再决定保留还是撤销 yml，读不到时不动 yml 并给出手工步骤；提交返回的 yml 与干跑不一致时撤销；撤销失败时列出原值和恢复步骤。回退进行中 `zhin doctor --fix` 不删旧键。
  - 第五次复审修复：回退已提交但返回的 yml 与干跑不一致时，按最终结果更新配置文件并报告已回退（写不进去时列出手工修改的值）；提交无回应时两次查询都仍是已迁移才撤销 yml；因配置文件里缺少已生效的门槛 / 模式而拒绝回退时，提示把哪一项改回什么值后就可以回退。

- 4ff83f3: 命名空间下的参数指令、超过 10 项的选择、猜谜与地牢远征的入口（#1250 第 37 批）。

  - `command-namespace-param-commands-swallowed`：路由顺序原先是「所有静态路由先于所有带参数段的路由」，于是只要有一条更短的静态路由（例如另一个插件或根项目里的 `60s`）能匹配开头，`60s fanyi 你好`、`60s douyin`、`60s fuel 四川` 就会被它吃掉，无参数的指令又会忽略多出来的词，日志照样是 `command_replied | executed`。现在按字面路径长度优先：字面词更多的路由先匹配，字面长度相同时静态路由仍先于参数路由。`<命名空间>` 与 `<命名空间> --help`（以及任意指令组的 `<组> --help`）列出该组下发送者能用的全部指令；某条指令的 `--help` 也列出它下面（至少多一个字面词）的子指令，参数指令不会把自己列进去。插件的 `commandNamespace` 与它自己的指令同名（命名空间 `60s` + 指令 `60s` → `60s 60s`）时，实例启动时记一条 `command_namespace_collision` 警告。
  - `select-over-10-options-no-buttons`：core 不再只给 ≤10 项的 `select` 生成按钮，所有选项都交给端点；选择提示改为「回复序号或选项名称。」，不再声称「可以点击按钮」。适配器能力画像新增可选的 `segments.interactiveLimits.maxButtons`（`@zhin.js/adapter` 新增类型 `AdapterInteractiveLimits`）：原生按钮的端点超过上限时，前 N 项保留按钮，其余选项改成紧挨按钮的序号列表（回复序号或名称照常生效；整块键盘一起登记序号，列出的序号接在按钮之后，回复「1」仍是第一个按钮）；纯文本端点照旧降级为序号列表。QQ 官方、Discord、Slack 声明 25，Telegram 声明 100；Sandbox 不设上限，按钮较多时在气泡内滚动。`@zhin.js/core` 新增导出 `resolveOutboundMaxButtons()` / `applyOutboundButtonLimit()`。该字段与 Sandbox 全能力 ADR 草案 P3 的 `interactive` 对象形式（`{ buttons: { maxTotal } }`）对应：`maxButtons` 将折进 `maxTotal`，字符串形式的 `interactive` 继续作为简写有效；本批不新增 `select` 段。
  - 猜谜（字谜 / 猜成语）：直接回复「提示」「跳过」「结束」（以及 hint / skip / end）按对应操作处理，卡片上写明可以这样回复。提示给出真实信息：成语给第 1 个字，字谜给包含答案的 4 个候选字；提示扣 3 分（分数不会低于 0）、不再清零连击，每局最多 3 次（分数为 0 时提示也不是无限免费）。「结束」（按钮或 `猜谜 quit`）公布当前题的答案并结算本局（已答题数、得分、最佳连击）。题库去掉重复的标点（「……活下去。。」）。
  - `dungeon-entry-unhelpful`：`dungeon` / `地牢远征` / `地牢` 不带参数且当前频道没有队伍时显示帮助与开局方式（`dungeon start`）；指令新增别名「地牢」。群里的卡片是整个频道共用的，所以所有人看到同一套按钮、同样的序号（大厅：加入队伍 / 准备 / 开始远征 / 解散队伍），非队长点「开始」或「解散」会收到明确的拒绝；大厅里提示其他人回复「加入队伍」入队。结束远征先要求队长确认：确认请求记录在新的会话版本上，只有这张确认卡（或队长在它仍是最新状态时回复「确认结束」/ 序号）能结束远征，队伍之后有任何动作或选择「继续远征」都会让它失效；结束后给出结算（到达层数、清理房间数、队伍金币）。「你是不是想用」在指令名都不相近时也和插件显示名比对（带指令前缀时 `地牢探险` → 显示名为「地牢远征」的插件）；没有前缀（私聊、@机器人）时只按前一半逐字相同放宽的匹配要求这一半至少 4 个字，`天气不错`、`天气` 这类聊天不会被显示名「天气预报」截走。
  - `60s-gold-currency-mixed`：金价按接口返回的单位写货币符号（美元用 `$`、人民币用 `¥`，其他币种不加符号）。

- a8377d4: 已连接却没有任何 Agent 绑定的 MCP 服务器会被明确提示（zhinjs/zhin#1250 第 41 批 `mcp-connected-but-unbound`）：

  - 原因：每一轮的 MCP 工具只取当前 Agent 在 `ai.agents.<name>.mcpServers` 里点名的服务器，`ai.mcpServers` 只负责连接。项目配了 `ai.mcpServers` 的 GitHub MCP、`zhin status` 显示「已连接，49 个工具」，但 `ai.agents.zhin: {}` 没写 `mcpServers`，Agent 一个 GitHub 工具都拿不到，只能默默改走网页搜索；文档和配置说明却写成「连接成功后进入工具池」。
  - 文档与配置说明：中英文 `ai/index`、`configuration/index`、`ai/agent` 写清「`ai.mcpServers` 只负责连接，在 `ai.agents.<name>.mcpServers` 里绑定才能用」，并给出连接 + 绑定的完整示例；`ai.mcpServers` 与 `ai.agents.<key>.mcpServers` 的配置说明（Host 配置 Schema 与 `AgentStartupConfig` / `AgentBindingConfig` 注释）同步改写，`docs/configuration/generated.md` 由 `pnpm docs:config` 重新生成。
  - `GET /introspection/mcp` 的每一行新增 `boundAgents`（`ConsoleMcpServerRow.boundAgents`，绑定该服务器的 Agent；运行中的 Agent 优先，没有时读配置文件；绑定项写成服务器名或 `{ name, … }` 对象都算绑定，ADR 0065 的对象写法落地后不会误报未绑定）。
  - Console「需要你处理」新增 `mcp.unbound`（已登记到 `CONSOLE_ATTENTION_KINDS` 与 `CONSOLE_ATTENTION_KIND_PERMISSIONS`，权限 `status.view`）：已连接但没有任何 Agent 绑定的服务器列为「MCP 服务 github 已连接但没有 Agent 能用」，说明在 `ai.agents.<name>.mcpServers` 里绑定（例如 `ai.agents.zhin.mcpServers: [github]`）；实例运行时 `zhin doctor` 经同一个列表列出它。
  - `zhin status` 的 MCP 行对这种服务器标 `!` 并注明「已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定」，已绑定的服务器列出绑定它的 Agent。
  - Agent 就绪日志的 `mcp:` 段只列这个 Agent 真正绑定的服务器，没绑定的另起一段写成 `未绑定: github(待连接)`（如 `ready | zhin | mcp: - | 未绑定: github(待连接) | …`），不再像是已经绑给了它；调试日志相应写成 `mcp configured:`。
  - MCP 工具本身的权限过滤不变。

- 14bf59c: 语音转写和内容审核不再替远端用户请求内网地址（#1250 第 45 批 `speech-url-ssrf`）。

  - Speech Host 下载语音（入站语音段的地址、`metadata.audio_url`、Sandbox 手写的 `[audio:URL]`）和 `voice_stt` 的 `audio_url` 改走新增的 `fetchPublicMediaBytes()`（`@zhin.js/agent/security`）：只下载公网 HTTPS 地址；主机名解析出的地址只要有一个是私网、回环、链路本地或云元数据地址就拒绝，连接时只连已校验的地址（防 DNS 重绑定）；重定向逐跳重新校验；单个语音最大 25 MB、整次下载 30 秒。原先任意 `http(s)` 地址都会被直接 `fetch`。
  - 被拒的地址不发出任何请求，这一轮照常继续：`transcribeUrl` 返回 `{ status: 'refused', code: 'speech_url_blocked' }`，模型看到「[语音地址不可用，未转写（speech_url_blocked）]」，`voice_stt` 返回同样原因的 `{ error }`。日志记 `op: speech_url_blocked`（下载失败为 `speech_url_fetch_failed`）和主机名，不记完整地址。转写器抛错时回合也不再中断。没有内网主机白名单配置。
  - 内容审核 HTTP 源在 `forceUpload` 时下载聊天图片，改为只连公网地址（私网、回环、链路本地、元数据地址及解析到这些地址的域名、重定向的每一跳都拒绝），单张最大 20 MB、超时用该源的 `timeoutMs`；被拒时按该源的 `onError` 处理。
  - 共用的私网地址判定（`isBlockedIpAddress`，`TurnNetworkClient`、`fetchPublicMediaBytes` 和入站媒体下载都用它）把 IPv6 改为白名单：只认全局单播 `2000::/3`，并排除 Teredo、6to4、文档和基准测试段；NAT64（`64:ff9b::/96`、`64:ff9b:1::/48`）、IPv4 兼容地址 `::/96`、站点本地 `fec0::/10`、丢弃段 `100::/64` 这类能映射到内网 IPv4 的地址此前会被放行，现在一律拒绝。IPv4 另外拒绝 Azure WireServer `168.63.129.16`、6to4 中继段和文档段。
  - 内容审核、RSS、短链接、链接海报共用的 `public-fetch` 以前校验时解析一次域名，`fetch` 连接时再解析一次，DNS 重绑定可以在两次之间换成内网地址；现在连接直接连校验过的那个地址（TLS 的 SNI 与 `Host` 仍是原主机名，不经环境代理），压缩的响应在本机解压后再按上限计数；重定向到其他源时不再带上 `Authorization` / `Cookie` / `Proxy-Authorization`。
  - 平台自带的语音地址允许 HTTP（所有者决定）：适配器根据平台数据产出的语音段（`media.value`、`data.url` / `src` / `file`、`metadata.audio_url`，例如 QQ 的语音 CDN 链接）也可以是公网 `http`，地址校验、只连已校验的 IP、逐跳重定向校验、大小和超时限制都不变，且从 https 重定向到 http 一律拒绝。消息里手写的 `[audio:URL]`、`voice_stt` 的 `audio_url`，以及声明 `runtime.sandbox` 的端点（Sandbox 的客户端自己拼语音段）或读不到能力画像的端点上的语音段，都按用户提供的地址处理，仍只认 https。`fetchPublicMediaBytes()` 新增选项 `allowHttp`（默认关闭），`InboundAudioUrlTranscriber` 新增可选第二个参数 `{ origin: 'platform' | 'user' }`（新增导出类型 `InboundAudioUrlOrigin`），`preprocessInboundTurn()` 新增可选第 4 个参数 `{ platformSegments }`。

- Updated dependencies [9ce43fe]
- Updated dependencies [661cc7c]
- Updated dependencies [c2cc4ba]
- Updated dependencies [4ff83f3]
- Updated dependencies [1dc5324]
- Updated dependencies [000bec6]
- Updated dependencies [5027ab1]
- Updated dependencies [a8377d4]
- Updated dependencies [4760a96]
- Updated dependencies [4bd5b64]
- Updated dependencies [2534b1d]
  - @zhin.js/core@1.12.0
  - @zhin.js/adapter@1.4.0
  - @zhin.js/plugin-runtime@1.4.1
  - @zhin.js/command@1.4.1
  - @zhin.js/feature-kit@1.1.20
  - @zhin.js/host-http@1.6.1
  - @zhin.js/harness@1.1.1
  - @zhin.js/console-protocol@1.6.1
  - @zhin.js/kernel@1.4.0
  - @zhin.js/component@1.2.1
  - @zhin.js/middleware@1.1.21
  - @zhin.js/permission@1.2.4
  - @zhin.js/prompt-section@1.1.20
  - @zhin.js/schedule-feature@1.1.20

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

### Patch Changes

- a460a46: 修复 `zhin trace --engagements` 报 `this[#db].select is not a function`（#1250 第 21 批 `trace-engagements-crash`）：协作事件日志改为通过数据库模型读写，与 Agent Host 的接法一致。
- f370ec5: 认领码（ADR 0060 §3.3，zhinjs/zhin#1250 第 23 批）：

  - 在私聊中直接发送「认领 <码>」/「claim <码>」即可认领，不再需要适配器的命令前缀（带前缀的 `#认领 <码>` 仍然有效）。此前配了 `commandPrefix` 的账号上，按提示发送的消息没有匹配到命令，被当作普通聊天交给了 AI。
  - 认领开启期间（尚无全局 owner），含有当前认领码的消息（不论写法）在入站最早处由认领处理器接手：不交给 AI，不写入会话历史、trace、日志与诊断（日志与消息事件里只显示 `认领 ***`）；群聊里的码立即作废；被丢弃的带码消息（其他机器人贴出、会话未就绪）也作废码；含码的原生 `platform.receive` 事件不派发给原生 Handler。只有整条文本恰好代表一个码时才授予（`认领 <码>`、`认领:码`、`認領 码`、全角、码被空格或 `-` 拆开、末尾标点都算）；含码但还带了别的文字（`认领 码 谢谢`、码藏在长单词里）只作废码并提示，不授予，这样一条消息只比较一个候选，错误次数限制仍然有效。私聊里「认领 <一个词>」但码不对时回复错误并计次。不含当前码的消息（如群聊「claim it」）照常进 AI；已有 owner 后完全不拦截。
  - 会话记录（`conversation_events`、Agent 会话消息）与 trace 的写入端加了兜底：只把当前开启的认领码写成 `***`，没有开启的认领时不做替换。
  - `zhin status`、启动日志、「需要你处理」与自助提示的用法改为「在私聊中直接发送」。
  - 新增公开导出：`@zhin.js/kernel` 的 `matchChatOwnerClaimText()` / `containsChatOwnerClaimCode()` / `registerChatOwnerClaimCode()` / `redactChatOwnerClaimText()`；`@zhin.js/core/runtime` 的 `InboundSecretGuard`（`match` / `inspectNative`）/ `InboundSecretMatch`（`handle` / `discard`）与 `ImRuntimeOptions.inboundSecret`。

- 48dc650: 认领码入站保护加固（ADR 0060 §3.3，zhinjs/zhin#1250 第 24 批，#1289 复审建议）：

  - 自己账号发出的带码消息（`origin === 'self'`，自回声）被丢弃时也作废认领码，与会话未就绪、其他机器人、成员账号、去重失败几条丢弃分支一致。
  - 写入端兜底登记表改为挂在 `globalThis` 的 `Symbol.for('zhin.kernel.chat-owner-claim-codes')` 上：项目里装了两份 `@zhin.js/kernel` 时，一份登记的码另一份也能脱敏。
  - `redactChatOwnerClaimText()` 只替换命中的那一段：只有 NFKC 形式命中时（全角码）不再把整条文本换成 NFKC 形式，其它字符保持原样。
  - 码比较时忽略的字符扩为空白、`-`、格式字符 `\p{Cf}`（U+2061–2064、U+200E/200F、U+180E 等）与组合符号 `\p{M}`（U+034F、U+FE0F 等）；认领的精确比较使用同一口径（新增 `foldChatOwnerClaimText()`），码中间夹着可见标点（`ABCD.2345`）时两边都不认作该码，能授予的文本一定会被识别为含码。
  - 原生事件检查扩大到 `message.receive` 以外的所有 Endpoint 事件（`platform.receive` 及其它原生侧边事件、通知、请求附言、系统事件），含码则不记录、不派发。检查不再截断：读遍字符串、数字、字节缓冲（按 UTF-8）、数组、对象、Map 与 Set，超出预算（深度 32、5 万个值、400 万字符）、读取抛错或字节缓冲（含 `SharedArrayBuffer` 及其视图）无法解码时按含码处理（fail-closed），并按事件名限频记 warn（同一事件名 10 分钟至多一条，不带载荷内容）。被扣下的通知、请求、系统事件确实含码时还会作废码（新增 `InboundSecretGuard.discardNative`）：平台上其他人（如看入群附言的管理员）已经看到；`platform.receive` 只扣下不作废。每个字符串只折叠一次，仅非 ASCII 时做 NFKC（新增 `createChatOwnerClaimCodeScanner()`）。

- 2386370: 不同插件的命令或别名重名不再让实例启动失败（#1250 duplicate-command-route-crashes-instance）。以前 Command 索引遇到重名路由直接抛 `Duplicate Command route`，实例退出、被网关反复拉起，所有适配器下线。现在：

  - 命令名称冲突时，先声明的插件保留（按插件在配置里的声明顺序），后来的那条命令连同它的别名、快捷方式不注册，它的子命令仍然可用；
  - 只有别名或快捷方式冲突时，只跳过这个别名或快捷方式，命令本身照常注册；命令名称优先于别的插件的别名；
  - 同一插件内部的冲突仍然在加载时报 `Duplicate Command route`，插件自己的测试能发现；
  - 插件热重载替换自己的命令不算冲突，热重载也不会改变由谁保留路由；
  - 插件按适配器、账号或会话关闭时，在保留方被关闭的端点上，原来被跳过的命令会生效。

  **升级注意**：后声明的插件如果有与前一个插件的别名同名的命令（例如 A 的 `admin` 带别名 `ban`，B 有命令 `ban`），升级后 `ban` 由 B 处理，而不是像以前那样启动失败。用户熟悉的指令换了处理方，所以这种冲突在「需要你处理」里标为严重（`danger`），升级后请检查并处理。

  每处冲突在启动（及热重载）日志里打一条 warn（`op=command_route_conflict`），并作为 `command.conflict` 列在 Console「需要你处理」和 `zhin doctor` 的运行状态里，写明两个插件名、命令名或别名，以及建议：让其中一个插件改名（或配置 `commandNamespace`），或在配置里用 `disabledCommands` 禁用其一。`CommandIndex` 新增 `conflicts()`；`@zhin.js/console-protocol` 的 attention 新增 `command.conflict`（需要 `feature.view`）与 `subject.pluginId` / `commandRoute` / `command` / `commandKind`。

- 81d5fda: 技能与知识库的可发现性（#1250 第 27 批）：

  - `skill-catalog-drops-triggers`：系统提示的 `## Available skills` 目录不再每条只留描述第一句的前 40 个字符。每条保留第一句、`Use when …` 句、`Triggers:` 触发词和 SKILL.md frontmatter 的 `keywords`（格式 `- name: 说明 | Use when … | Triggers: …`；单个触发词 / 关键词超过 32 字符丢弃）；截断改为整个目录共用约 4000 字符预算（单条最多 320 字符），超出时先截说明，再截 `Use when`，触发词最后截。toolSearch 编排层的技能目录（`skillsSummaryXML` / 技能注册表）用同一格式和预算，XML 里可选的 `<keywords>` 也会列出。脚手架的 `github` 技能此前在目录里只剩 `Prepare GitHub issues, pull requests,…`，「帮我写一个 PR 描述」现在能在目录里对上 `PR 描述`。
  - 公开技能的 `keywords` 命中当前消息时，在本条消息的运行时尾部加一句「建议加载技能 X」（`## Suggested skill`），只是提示，不自动激活：按关键词自动激活仍只用于 Agent 私有技能，因为公开技能是第三方说明，激活会注入正文并解锁它的工具。缓存前缀不变。为防关键词堆砌，只看每个技能前 12 个关键词、按命中的最长一个计分，忽略单字、不足 3 个字符的英文词、常见寒暄与虚词。新增 `suggestPublicSkillsForIntent()`，`buildCapabilityContext()` 新增可选参数 `intent`。
  - `knowledge-search-not-advertised`：配置了 `ai.knowledge.baseDir`、且本回合的 `knowledge_search` 对所有发送者都可用（没有权限或机器人角色限制）时，系统提示附一段知识库索引（`## Knowledge base`：文件名与一、二级标题，约 1500 字符以内，先舍二级标题再舍文件），并写明关于本机器人、本项目的问题先查知识库。索引排在稳定段末尾、scene 之前（知识库变化只让它之后的缓存失效），段上限 2000 字符；只放标题和路径，去掉 Markdown 与尖括号、逐项截断，放在 `<knowledge_index>` 里标注为数据；与检索共用缓存，目录文件变化时失效。上下文预算新增 `knowledge_index` 段（`zhin trace` 显示为「知识库索引」，网关用量统计计入固定段）。`KnowledgeIndex` 新增可选 `outline()`。
  - `knowledge_search` 的工具描述与 `query` 参数说明改写；不带空格的中文问题按字的二元组部分匹配，计分前去掉「怎么、可以、这个、一下、知道、我想……」等虚词，不会靠虚词命中无关文档。标题抽取按 CommonMark 处理围栏（闭合围栏后面只能有空白）。
  - 知识库目录视为 owner 可信内容：与 `skills/` 一样列入受保护目录，Agent 的文件写入工具写到这里每次都要真人批准。
  - 脚手架模板（`create-zhin-app`）：技能的中文触发词同时写进 `keywords`，`skill-creator` 说明了目录保留哪些部分。

- a7f3a7c: MCP 状态口径与安装预览（zhinjs/zhin#1250 第 28 批）：

  - `mcp-status-not-loaded-contradicts-agent`（根因）：Plugin Runtime 下 `ai.mcpServers` 的服务作为本代（generation）的 MCP 特性运行，在代激活时连接；Agent 的内省却只读自己的 `resourceHub.mcps` 注册表，而这些服务从不进入该表，于是 Console「运行时能力 → MCP 服务」、`zhin status` 都把已连接的 github 显示成「未加载」（`not_loaded`），「需要你处理」也报「未连接」。现在由 `HostMcpStatusBoard` 记录每个配置服务客户端的实际连接结果（跨代保留：被沿用的代仍算已连接，候选代连接失败不影响旧代），内省按它报告：已连接（含工具数）/ 连接失败（附分类原因）/ 尚未连接（`idle`，显示为「待连接」：配置的服务在代激活时就连接，这是激活前的短暂状态）。发布新的一代时清掉已从配置删除的服务的失败记录，删掉再加回来不会显示旧原因。
  - 「需要你处理」只列连接失败的 MCP 服务并附失败原因，标题改为「MCP 服务 … 连接失败」；尚未连接、未加载的服务只在 MCP 页显示。`zhin status` 中 `idle` 显示为「待连接」。
  - 启动日志 `ready | … | mcp:` 改为与状态一致的写法（如 `github(待连接)`；日志写出时客户端尚未连接），连接结果另记 `mcp_connected`（工具数）/ `mcp_connect_failed`（分类与原因）。
  - 新增 MCP 连接测试：`POST {base}/introspection/mcp/test`（body `{ name }`，权限 `agent.configure`，已登记到 `CONSOLE_HTTP_PERMISSIONS`）用一次性客户端连接、列工具后断开，不改变 Agent 自己的连接与行状态；未配置的名字返回 404，同一服务测试进行中返回 409，Agent 未运行返回 503；全局最多同时 2 个测试，同一服务每次测试后冷却 5 秒，超出返回 429 并带 `Retry-After`；每次测试写入 Console 审计日志（`mcp.test`：操作者、服务名、结果与失败分类，不含失败消息）。注意：对 `stdio` 服务，测试会在 Agent 已有进程之外再启动一个同名命令，独占资源（锁文件、固定端口）的服务测试时可能冲突。新增导出：`@zhin.js/console-protocol` 的 `CONSOLE_MCP_TEST_PATH` / `ConsoleMcpConnectTestResult`；`@zhin.js/host-http` 的 `ConsoleAgentIntrospection.testMcp()`（Agent 不可用时返回 `'agent-unavailable'`）与 `ConsoleRestPagesOptions.mcpTestMaxConcurrent` / `mcpTestCooldownMs`；`@zhin.js/agent/runtime` 的 `HostMcpStatusBoard`（`probe()`）及相关类型，`AgentHostIntrospectionPort.testMcpServer()`。
  - `install-dry-run-dumps-whole-config`：`zhin install … --dry-run` 的配置预览改为 unified diff，只含改动的行和上下 3 行，由真正写入时（逐键补丁、保留注释与顺序）会产生的文本计算，不再重新序列化打印整份配置（此前注释几乎全部丢失，看起来像安装会抹掉注释）。
  - 安装插件时跟随项目的精确版本写法：项目 `dependencies` / `devDependencies` / `optionalDependencies` 里的 `zhin.js` / `@zhin.js/*` 注册表依赖全部是不带 `^` / `~` 等范围的精确版本（`=1.5.0` 也算精确）（`workspace:`、`link:`、`file:`、`catalog:`、`npm:` 别名、git / 路径来源与 `latest` 这类标签不参与判断；至少要有一条注册表依赖）时，`pnpm add` 加 `--save-exact`（npm `--save-exact`，yarn / bun `--exact`）。只对 npm 注册表包生效，请求本身写了范围（如 `foo@^1.2.0`）时按原样安装、不加；`--dry-run` 显示的命令同样带上。`@zhin.js/gateway/plugin-management` 新增 `projectPinsExactZhinVersions()`、`isRegistryPackageRequest()`、`installSavesExact()`。
  - 预览的 diff 也显示行尾差异：文件末尾无换行输出 `\ No newline at end of file`；只有行尾不同的单行标出 ` (CRLF)` / ` (LF)`；整个文件换了行尾时在文件头后用一行 `# line endings: CRLF -> LF` 说明。

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

- 19526a6: 没回复、被拒绝、离线都说清原因（zhinjs/zhin#1250 第 31 批）：

  - `self-service-unknown-conversation-opaque`（回退的根因）：第 9 批（ADR 0060 P3，b6ec01464「Sandbox speaks as the linked chat identity; typed ids are simulated and role-less」）起，Sandbox 里手填的发送者以 `~sim:<id>` 进入运行时，而 `chatRoleMessageContext()` 把这种保留 id 当成「无法识别」，`功能` / `角色` / `认领` / `绑定` 都只回「无法识别当前会话。」；之前同一个群里 `功能 关闭 repeater` 能用，是因为当时手填的 id 还会被当成真实身份。现在 `@zhin.js/core` 新增 `resolveChatRoleMessageContext()`，返回 `{ ok: false, reason }`（`no-conversation` / `unknown-endpoint` / `no-adapter` / `no-sender` / `simulated-sender` / `invalid-sender`），实例侧再加 `unkeyed-conversation`（适配器没有提供可用的会话类型或会话 id）；四个指令按原因回复下一步（如「你正以模拟身份发言……请在 Sandbox 打开『以我的身份发言』，或在 Console『功能』/『聊天角色』页设置」）。不带参数的 `功能` / `角色` 直接列出。
  - 被拒绝或失败的自助指令不再记成 `command_replied | executed`：`UserFacingError` 新增闭合的拒绝码 `reason`，指令派发结果带 `refusalReason`，入站结局记 `refused` 与该码（如 `simulated-sender`、`not-admin`、`usage`、`locked`、`self-service-disabled`），回复文字不变。没有码的 `UserFacingError` 仍记 `user_facing_error`。
  - `unaddressed-message-no-record`（复测失败的根因）：第 18 批之后，没被 @、不是指令的群消息其实已经记了 `not_addressed`，但未点名的静默结局一律只写 debug 日志，Console 的运行日志看不到；结局只存在进程内，Sandbox 和轨迹页也没有入口，看起来就像「什么都没记」。现在每个会话每分钟第一条 `not_addressed` 写 info（`inbound_outcome | … | sampled: first_per_minute`），其余仍为 debug；新增 `GET {base}/conversations/outcomes`（`endpoint.view`，只限当前 Sandbox 连接绑定的会话、且只列该连接 owner 本人或其模拟身份发出的消息；只返回结局码和面向发送者的文案，不含插件名、阶段等运维文案），Sandbox 发消息后读取这条消息的结局，没有回复时显示原因（如「这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。（not_addressed · no_command_not_ambient）」）。`ConsoleMessageDiagnostic` 补上已有的 `outcome` 字段。
  - `console-offline-no-reason`：适配器不上报连接状态（如 GitHub 这类 Webhook 适配器）且没有失败记录的已启动账号，不再显示「离线 · 连接状态：未知」，改为「未上报连接状态」（提示级），并说明常见原因与检查方法；确实离线时附上最近一次失败的原因、失败时间与自动重试次数 / 下次重试时间。这些只改显示文字：条目的 revision 与之前相同，已忽略的待办不会重新出现（「已从配置导入聊天角色」的 revision 也仍按原始条目数计算）。
  - `principal-link-attention-ids`：「人员名单或身份链接等待确认」按人分组，每个身份写出适配器与账号（`qq·bot-a`），平台 id 只显示后 4 位（`尾号 1234`），数量按去重后的 (adapter, endpoint, userId) 计算；查看者本人显示为「你（显示名）」，其他 Console 用户显示 id 前 8 位，条目新增 `links`（`ConsoleAttentionItem.links`）供 Console 按 `iam.users.list` 换成用户名。

- cbe2c3f: CLI 与插件作者流程（zhinjs/zhin#1250 第 32 批）：

  - `zhin packages status <插件>` 不再把框架字段 `commandNamespace`、`disabledCommands`（以及 `overrides`）报成「不支持的字段」（`missing-config`）：网关校验插件配置时和 Runtime 使用同一份带框架字段的 schema，`additionalProperties: false` 的插件也能写这些字段；Console 保存、安装 / 启用前的配置检查同样生效。`@zhin.js/runtime` 新增 `withFrameworkPluginConfigFields()`。
  - `zhin preview`：组件的渲染上下文有了 `use()` / `has()`（此前报 `context.use is not a function`）。组件可以用新的可选字段 `previewServices: [{ token, value }]` 为插件服务提供预览替身；没有替身的 token 会报「预览环境没有提供 <token>，可在组件的 previewServices 里给一个替身」。实例运行时始终使用真实服务。`@zhin.js/component` 新增类型 `ComponentPreviewService`。
  - 新增 `zhin ai account list [--json]`：列出 Host 模型账号的 id、名称、服务、引用的环境变量名（不含值）与状态。模型服务管理接口的每个错误码都有中文说明；Host 管理员传入不存在的账号 id 时返回 `account-not-found`，把服务 id 当账号 id 传入时返回 `account-id-is-service`（HTTP 404，此前为笼统的 403 `forbidden`）。
  - `zhin watch` 按进程分别显示内存：instance（`/system/status` 的同一次采样）与 gateway（经本机网关套接字读取 `gateway.instance.status`，与 Console 首页「进程与资源」同源），每个数字都标明所属进程；同一次采样中 rss 小于 heapUsed 时给出说明（部分堆内存被系统压缩或换出）。
  - `zhin schedule list`：多行内容逐行缩进，超过 2 行截断并提示用新增的 `--json` 查看完整内容。日期时间在 `LANG=en_US` 等任何系统区域下都是 `YYYY-MM-DD HH:mm:ss`（第 22 批的 `formatDateTime()`，本批补了在美国区域与其他时区下运行的测试）。
  - `zhin new --help` 说明非交互环境（CI、脚本、无 TTY）必须给出 `--type`；普通插件模板的示例子命令改为 `commands/<name>/echo/[text]`（`<name> echo <文本>`），不再是平级的 `commands/<name>-echo/[text]`。

- 2ab7fb9: 协作 id 跨重启唯一，并修复 `zhin trace --engagements` 读错数据库（#1250 第 35 批）。

  - `engagement-id-reused-across-restarts`：Engagement、信件与预算授权 id 原先是每次启动从头计数的 `m1`、`m2`……（授权 `g1`……），重启后重复，一个 `engagement_events` id 下混进几次重启里互不相干的协作（Workroom `?engagementId=m17`、`zhin trace --engagements` 都会混在一起）。现在 id 形如 `m-<运行 id>-<序号>` / `g-<运行 id>-<序号>`：运行 id 在每次实例启动时由启动时间（base36）加随机字符生成，Agent 的 Harness 与预算账本共用同一个运行 id。id 对 Console 协议、Workroom 与 CLI 仍是不透明字符串，格式没有对外约定。`@zhin.js/harness` 新增 `createRunId`、`createRunScopedIdFactory`、`isLegacyCounterId`，`createHarness` / `InMemoryBudgetLedger` 未传 `newId` / `idFactory` 时也改用运行 id。
  - 一次性数据迁移：新增 `migrateEngagementEventIds`（标记表 `engagement_event_migrations`），只由实例在启动后于后台执行，把同一个旧 id 下的记录按 `seq` 顺序、在每条 `engagement_opened` 处拆成各自的 Engagement，换上新 id，并改写记录里的信件 id（`mailId`、`rootMailId`、`causationId`、`mails` 等）、授权 id（`grantId`、`rootGrantId`、`parentId`）以及协作之间的 `carriedBy` 引用。分批执行，每批一个事务、按主键读写：读者看到的每个旧 id 要么完整未拆、要么已全部拆完；每批核对行数，不丢行；中途停止或崩溃时已提交的批次保留，下次启动接着做；全部完成后写标记，之后再运行是空操作。迁移不阻塞实例启动（大表在远程数据库上可能超过网关的就绪超时），进行中协作日志照常读写。只含一次协作的旧 id 不变。支持 SQLite、MySQL、PostgreSQL（与协作事件日志相同）；失败只记日志，下次启动重试。`zhin trace` 等 CLI 只读：不执行迁移、不建也不写标记表；库里还有未拆分的旧 id 时照常展示，并在标准错误输出提示「旧版协作记录尚未拆分，重启实例后会自动整理」（先查标记，有标记就不再检测）。Console SQL 不能写这张标记表。
  - `trace-engagements-crash` 复测：1.5.0（2cf215e0）里 CLI 仍把数据库 Host 直接交给日志，修复在第 21 批（a460a46f0）才合入、晚于 1.5.0，当前版本已不再报 `this[#db].select is not a function`。另外修复 `zhin trace --engagements --cwd <dir>`（以及 `zhin usage report` 的服务名查找）把相对的 SQLite 路径按当前目录解析、打开一个新的空库的问题：现在按项目根目录解析，与网关一致（绝对路径、`:memory:` 与 `file:` URI 原样使用）；数据库文件不存在时（拼错的 `filename`、从未启动过的项目）CLI 不再新建空库，而是报告无法打开。`zhin trace --engagements <id>` 与 `zhin trace <id>` 都优先精确匹配，再按前缀匹配。
  - 文档（第 33 批的无人值守自动审核）：`execApprovalMode` 默认就是 `auto`，所以定时任务等无人值守回合里需要审批的工具默认交给审核 Agent 判断；不想要时设 `ai.agent.execApprovalMode: ask`（人工审批），无人值守时这些调用直接拒绝（没有只关掉无人值守审核的单独开关）。只要 `confirmHighRisk` 保持默认的 `external_content`，任何模式下读取外部内容之后的高危动作在无人值守时一律拒绝，审核 Agent 也不能放行。`docs/ai/index.md` 示例里把默认值误写成 `ask`，已改正。

- Updated dependencies [a460a46]
- Updated dependencies [d216b84]
- Updated dependencies [f370ec5]
- Updated dependencies [48dc650]
- Updated dependencies [2386370]
- Updated dependencies [e929d34]
- Updated dependencies [7288cd1]
- Updated dependencies [a7f3a7c]
- Updated dependencies [f145963]
- Updated dependencies [19526a6]
- Updated dependencies [cbe2c3f]
- Updated dependencies [f1affdd]
- Updated dependencies [2ab7fb9]
  - @zhin.js/harness@1.1.0
  - @zhin.js/plugin-runtime@1.4.0
  - @zhin.js/kernel@1.3.0
  - @zhin.js/core@1.11.0
  - @zhin.js/command@1.4.0
  - @zhin.js/console-protocol@1.6.0
  - @zhin.js/host-http@1.6.0
  - @zhin.js/component@1.2.0
  - @zhin.js/adapter@1.3.3
  - @zhin.js/feature-kit@1.1.19
  - @zhin.js/middleware@1.1.20
  - @zhin.js/permission@1.2.3
  - @zhin.js/prompt-section@1.1.19
  - @zhin.js/schedule-feature@1.1.19

## 1.5.0

### Minor Changes

- 816c3f3: #1250 第 18 批：入站消息结局与群聊插话（ADR 0061 P1/P2/P5、ADR 0062 §23）。

  - 每条入站消息在处理结束时恰好得到一个结局（`InboundOutcomeLedger`，`finally` 提交）：命令、中间件、处理器、交互态、准入、去重、近似指令、发送失败与 Agent 入口都上报候选，按优先级取主结局，其余记为 facets；抛错记为 `internal_error` 并带错误号（`err_` + 12 位十六进制，`createErrorId` 移入 `@zhin.js/logger`），原样重新抛出。结局不存消息正文，管理员补充 ≤ 200 字并按决策审计同一套规则脱敏（`redactDecisionPayload` 下移到 `@zhin.js/kernel`，Agent 原名再导出）。
  - 结局保存在进程内（2000 条 / 24 小时，静默结局每会话每分钟超过 30 条时聚合），附在消息诊断记录上（`RuntimeMessageDiagnostic.outcome`），并写一行实例日志 `op=inbound_outcome`。
  - 没被 @、不是指令、本群又没开插话的群消息记 `not_addressed`（`unaddressed-message-no-record`）；旁听判定不插话记 `ambient_silent`；控制面 / 禁言记 `filtered_by_policy`。
  - 群插话纳入功能开关：`ai.trigger.ambient.conversations` 是全局默认值，适配器 / 账号 / 会话层开关存进 `feature_overrides`；群管理员可在群里发「功能 关闭 / 开启 / 重置 插话」（`ambient-allowlist-only`）。
  - 交互态：提问可声明 `answeredBy: 'target' | 'anyone'`（默认 `target`）；回答无效时提示最多重发一次。提醒插件的确认步骤只接受「确认」/「取消」，期间的闲聊不再让整段确认提示反复出现（`reminder-confirm-captures-chat`）。
  - group-suite：`mypoints` 增加中文别名「积分」「我的积分」，`rank` 增加「排行」「积分排行」（`group-suite-zh-alias-partial`）。

- 0e6a82f: 普通插件启停热生效，不再重启实例（zhinjs/zhin#1250 `toggle-plugin-restarts-instance`，ADR 0054 修订 2026-11-15）：实例运行时 `zhin enable` / `zhin disable` 与 Console 全局开关先写 `disable_plugins`，再经控制通道 `plugins.apply` 让实例按该修订换代（退役或装配该插件实例的全部能力），实例不重启、适配器不重新登录。插件声明 `package.json#zhin.toggle: "restart"`、含原生模块、实例启动后依赖有变化、实例不支持或热应用失败时，自动回退为停止 → 启动实例（启动失败照旧恢复配置并启动原实例），结果的 `plugin.apply` / `restartReason` / `restartDetail` 与新阶段 `apply-hot` 说明生效方式和原因；Console RPC 的 `restartRequired` 只在实例确实重启时为 true；CLI 输出「已热生效，实例未重启」或重启原因。

### Patch Changes

- 941d534: `definePage()` 新增 `keywords`（ADR 0063 决策 3）：命令面板搜索别名，可以是一组，也可以按 `zh-CN` / `en` 分语言（例如 `{ 'zh-CN': ['抽奖'], en: ['lottery'] }`）；`definePage` 校验并去重，`@zhin.js/page` 原样透传。`keywords` 和 `section` 走同一路径：register 包装与 `@zhin.js/client` 的 `resolveEntryRegister` 写进路由 `meta.keywords`，Host 的 `/entries` 在每条 entry 顶层与 `meta` 中都带上 `keywords`；每条 entry 另带所属插件的 `packageName` 和 `pluginDescription`（插件 package.json 的 `description`），供 Console 命令面板按插件名与说明搜索插件页面。
- 941d534: Console 共享模块版本核对（ADR 0063 D3）：`@zhin.js/console-ui` 与 React 一样由 Console 提供单例，插件页面打包时不再打进去（`@zhin.js/console-ui/cn` 并入根导入，`styles.css` / `tokens.css` 的导入变为空模块）。页面的 `/esm/@zhin.js~console-ui.mjs` 地址带上插件 `peerDependencies` 中的范围、插件包名和用到的具名导出；代理模块拿 Console 在 `globalThis.__ZHIN_CONSOLE_SHARED_MODULE_VERSIONS__` 登记的版本比对：主版本不兼容时明确报错，版本偏低时在控制台告警并记录到 `__ZHIN_CONSOLE_SHARED_MODULE_ISSUES__`（同时派发 `zhin:console-shared-module-issue` 事件），缺少的具名导出按名字报出、调用时抛错，不再静默给出 `undefined`。`zhin.js` 的 `/esm/*` 把查询参数交给 pagemanager。
- efa87bf: 失败原因看得见（#1270 第 14 批）：实例把账号准备、模型调用、账号启动与 MCP 连接的最近一次失败原子写入 `.zhin/runtime-failures.json`（随机临时文件名、`wx` 独占创建、权限 0600，拒绝符号链接），成功后清除，重启后标为「重启前记录」；暂时从列表消失的账号或 MCP 服务保留 10 分钟宽限期；失败原因脱敏加强（URL query、JSON 键、`Cookie:`、裸 `sk-…` / `AIza…` 与长串）；「需要你处理」新增模型账号（需重新登录 / 已断开 / 结果未知 / 准备失败）与无效配置（子 Agent 的模型选择被忽略）条目，MCP 未连接条目给出原因；实例启动中 `attention.list` 返回「启动中」，不再逐个来源记 WARN。模型服务接口的失败都带 `details` 与 `nextStep`；Antigravity 开通被上游拒绝（`UNSUPPORTED_CLIENT`）时保留这一原因并提示填写 `projectId`。
- e7cf228: 模型服务连接测试的限流（`/api/agent/inference/probe`、`/account/test`）只统计已存在的 Profile，未知的 Profile ID 不再占用计数；限流表最多记录 1024 个键，超出时丢弃最久未测试的键，内存不再随请求增长（zhinjs/zhin#1250）。
- d21754f: 日志写法统一（zhinjs/zhin#1250 第 19b 批）：Agent 的存储与清理失败日志由 `op=usage_persist status=failed; 说明` 改为与其余日志相同的 `usage_persist | status: failed | detail: 说明`，备用模型切换日志改为 `model_fallback | purpose: … | from: … | to: … | reason: … | phase: …`。实例的 Console 系统日志改用 `@zhin.js/logger` 的 `parseLogLine`，带日期的新格式与旧格式的行都能落库。
- Updated dependencies [efa87bf]
- Updated dependencies [816c3f3]
- Updated dependencies [d21754f]
- Updated dependencies [92e6c1e]
- Updated dependencies [0e6a82f]
  - @zhin.js/console-protocol@1.5.0
  - @zhin.js/core@1.10.0
  - @zhin.js/logger@1.3.0
  - @zhin.js/im-contract@1.3.0
  - @zhin.js/host-http@1.5.0
  - @zhin.js/database@1.2.2
  - @zhin.js/adapter@1.3.2
  - @zhin.js/command@1.3.1
  - @zhin.js/harness@1.0.1

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

- 39db402: AI 账号与 Host 环境变量（#1250）：Console 账号可以引用 Host 环境变量（账号来源 `env://NAME`，或在设置密钥中填写 `${NAME}` / `${NAME:-}`），规则为：仅全局 owner（owner 本就能读写 `.env`），且变量名以 `_API_KEY` 结尾（避免把无关机密发往任意地址）；服务地址不限，自定义中转地址可用（其他 Console 用户与不合规的变量名返回明确中文原因 `reason`）；新增本机命令 `zhin ai account add / rename-env / test`（只经网关控制套接字，写审计，不回显值）及对应实例路由 `POST {base}/agent/inference/cli/account/add`、`/cli/account/rename-env`；新增 `POST /agent/inference/probe` 与 `/account/test` 连通性探测（带 tools 的最小请求，成功时激活凭据）。账号状态新增 `environment`（`env://` 账号无凭据时的环境变量就绪情况）与 `lastCall`（本进程最近一次真实调用结果）。`@zhin.js/host-http` 导出 `isLocalSocketPrincipal`、`isGlobalOwnerPrincipal`、`LOCAL_SOCKET_USER_ID`、`LOCAL_SOCKET_CREDENTIAL_ID`。
- 603b892: #1250 安全复核修复：配置补丁把敏感字段的值移入 `.env` 需要 `ops.env.write`，否则以 `env-write-required` 拒绝（聊天自助与 Agent 自改同样拒绝），且只更新字段自己的规范变量、绝不覆盖字段仅仅引用的其他变量；CLI 的 `/pub/health` 项目核对在探测失败时按"未验证"处理（默认拒绝，`--allow-unverified-host` 时警告后继续），本机判定覆盖 `0.0.0.0`、`::ffff:127.x`、`*.localhost` 与本机网卡地址，`hostFetch` 不再以明文 HTTP 向非回环地址发送令牌；模型连接测试（`/probe`、`/account/test`）按账号限流（每分钟 6 次，超出返回 429 与 `retryAfterMs`）。
- 07f9d01: 所有用途支持备用模型（#1250 chat-purpose-no-fallback）：聊天、摘要、旁听、Agent 角色（`purposes.agents`）以及 Adapter / Endpoint / 场景的聊天覆盖都可以写 `{ profile, fallbacks }`。额度用完、余额不足或密钥被拒（单纯的 403 不算）时按顺序换下一个备用模型；同一模型连续 2 次超时后下一次尝试也换（#1270）。只换到能接得住这次请求的模型（输入媒体、上下文窗口、工具循环协议），从当前对话继续、不重放已执行的工具；失败的模型在恢复前跳过（有供应商提示按提示，日配额到太平洋时间午夜，其他固定冷却）。用了备用模型的回合在 trace 中标记「本轮由备用模型回答」，Console 管理视图可读取跳过中的模型与最近切换；配置校验错误指明出错的链路径（如 `purposes.adapters.qq.chat.fallbacks[1]`）。
- da9dc8a: 聊天角色引导文案（ADR 0060 P0）：需要 zhin 角色的命令被拒绝时，回复说明去哪里获得角色（联系主人 / Console「聊天角色」页），不点名缺哪个角色或谁持有；发言者是群主 / 群管理员时另说明平台身份不等于 zhin 角色。`功能` / `角色` 的拒绝回复同样指向 Console，尚无全局 owner 时提示认领码；Agent 信任档位的限制说明改为「联系主人授予 trusted 角色」。Sandbox 页把模拟的「Master」改称「群主（平台身份）」，并显示服务端解析的 zhin 角色与 Agent 信任档位（入站回显帧新增 `senderChatRole` / `senderTrustLevel`）。ICQQ README 去掉已不读取的 `master`「必填」写法。
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

- 39d5b88: 独立 Sandbox 页面（`/sandbox`）在 Console 初始化后不再「看起来能用、发了却没反应」（#1250）：

  - 未连接时禁用输入框、发送按钮和快捷指令，并在输入框上方说明原因：需要有「操作账号」权限的 Console API 令牌（顶栏用户名 →「个人设置」`/account` 签发，粘贴到右上角后重连），初始化之前才可用 `.env` 的 `HTTP_TOKEN`，或者直接用 Console 的「会话 → 沙盒」。连接中途断开时单独提示；未连接时按回车不再清空输入、不再静默丢弃。
  - 页面右上角的令牌框占位文字改为「Console API 令牌」，不再写 `HTTP_TOKEN（可选）`；`--standalone` 启动时打印的 Sandbox 提示同步改写。
  - README 与快速开始文档（中英）第 2 / 3 步改为优先在 Console 的「会话 → 沙盒」里发 `/hello`，并说明独立页面在初始化后需要 API 令牌。

- 00ca418: 没装或没启用 AI 时，Console 读取不再显示「暂时无法读取」（#1250）：`GET /api/assistant/jobs` 与 `GET /api/conversations/results` 在功能关闭时返回 200 `{ success: true, data: { status: 'disabled', reason, message, …空列表 } }`，`reason` 为 `agent-not-installed`（未安装 `@zhin.js/agent`）、`agent-disabled`（已安装但 AI 未启用）或 `assistant-disabled`（`assistant.enabled` 为 false），替代原来的 404 `assistant.enabled is false` 与 503 `result_store_unavailable`（存储损坏等真实读取失败仍是 503）。任务写入（`POST /api/assistant/jobs*`）仍返回 404 与旧的 `error: 'assistant.enabled is false'`（兼容旧 CLI），新增 `code: 'unavailable'` 与 `data`（同样的 `ConsoleFeatureDisabled`）。`@zhin.js/console-protocol` 新增 `ConsoleFeatureDisabled`、`ConsoleFeatureDisabledReason`、`consoleFeatureDisabled()`、`isConsoleFeatureDisabled()`；`zhin schedule` / `zhin watch` 识别新形状并打印原因。
- e690123: 功能矩阵不再只有适配器一行（#1250）：`feature.matrix` 在项目根插件提供了命令 / 组件 / 工具时加一行 `kind: 'root'`、`plugin: ''`、`readOnly: true` 的「本项目」行（始终启用，不可开关），列出 `capabilities: { commands, components, tools }`（如 `hello`、`card`）；其他行新增 `kind: 'plugin' | 'adapter'` 与各自的 `capabilities`，按 根插件 → 插件 → 适配器 排序。`feature.list` 的条目同样带 `kind` 与 `capabilities`（不含根插件行）。`@zhin.js/console-protocol` 新增 `ConsoleFeatureKind`、`ConsoleFeatureCapabilities`，`ConsoleFeatureSummary` / `ConsoleFeatureMatrixRow` 新增可选字段。
- 817b2bf: `http.port` 校验与默认端口（#1250）：

  - `http.port` / `http.listeners[].port` 只接受 1–65535 的整数，或展开后为该范围整数的 `${VAR}` 引用（`0` 保留原含义：由系统分配空闲端口，供测试与嵌入使用）。Host 配置 Schema 收紧（`integer` + `minimum`/`maximum` + 只允许整串 `${VAR}` 的 `pattern`），`zhin config set`、Console 保存与 `plugin:validate-config` 一致拒绝并给出中文原因（如「字段 port 只接受数值或 ${VAR} 形式的环境变量引用」「字段 port 不能大于 65535」）；`zhin config check` 报 `http.port_invalid` 错误（含引用展开后的值）。
  - 启动时非法端口直接报错退出，不再悄悄监听默认端口；`${PORT}` 展开得到的数字字符串现在会被正确使用（此前被忽略而回退到默认端口）。
  - **未配置 `http.port` 时的默认端口从 8086 改为 8068**，与脚手架写入、文档和 Console 链接一致（8086 常被 InfluxDB 等占用）。已在配置中写了端口的项目不受影响；依赖旧默认值的项目请显式写 `http.port: 8086`。
  - `zhin doctor` 按启动方式解析端口（展开 `.env` 中的 `${VAR}`），检查真实生效的端口；无法解析或非法时报错并给出 `zhin config set http.port 8068 --offline`，不再悄悄检查 8086。
  - 配置里的端口已损坏且网关未运行时，CLI 配置命令给出离线修复提示，而不是 `Invalid URL`；网关运行时经本地 socket 照常工作。
  - `@zhin.js/host-http` 新增导出 `DEFAULT_HTTP_PORT`、`parseHttpPort`、`describeInvalidPortValue`、`InvalidHttpPortError`、`ENVIRONMENT_REFERENCE_PATTERN`。

- b2ed753: Endpoint 的传输状态有了可读文字（#1250）：`endpoint.list` / `endpoint.info` 的每行在原始 `transportState` 旁新增 `transportLabel`（如 `open` → `已连接`、`reconnecting` → `重连中`）；「需要你处理」中离线账号的说明改用这段文字（不再显示「连接状态：closed」）。`@zhin.js/console-protocol` 新增 `ConsoleEndpointTransportState` 类型与 `endpointTransportLabel(state, locale)`，`ConsoleEndpointSummary` 新增可选字段 `transportLabel`。
- Updated dependencies [39db402]
- Updated dependencies [8bf8dfa]
- Updated dependencies [603b892]
- Updated dependencies [da9dc8a]
- Updated dependencies [bc31cd3]
- Updated dependencies [760e9f5]
- Updated dependencies [5d90159]
- Updated dependencies [73475bd]
- Updated dependencies [5c7f9c5]
- Updated dependencies [9d3f50b]
- Updated dependencies [35e5d89]
- Updated dependencies [809c6ee]
- Updated dependencies [00ca418]
- Updated dependencies [e690123]
- Updated dependencies [817b2bf]
- Updated dependencies [9cd764a]
- Updated dependencies [b2ed753]
  - @zhin.js/host-http@1.4.0
  - @zhin.js/console-protocol@1.4.0
  - @zhin.js/logger@1.2.0
  - @zhin.js/core@1.9.0
  - @zhin.js/database@1.2.1
  - @zhin.js/adapter@1.3.1
  - @zhin.js/harness@1.0.1

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
