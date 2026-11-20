---
"@zhin.js/plugin-runtime": minor
"@zhin.js/core": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/agent": patch
"@zhin.js/testing": patch
"@zhin.js/gateway": patch
---

feat!: 出站模板占位符重组为分组字段，并按发送账号渲染命令前缀、菜单与命令写法（#1250 第 70 批）

**不兼容变更**：`TemplateContext` 字段重组，旧的顶层占位符 `${adapter}`、`${endpoint}`、`${endpointId}`、`${kind}`、`${conversationId}`、`${content}`、`${segments…}`、`${messageId}`、`${timestamp}`、`${mentioned}` 不再展开，会原样发出。所有占位符都至少两段，不再和配置加载时的环境变量引用（单个名字的 `${NAME}`）冲突。

- `@zhin.js/plugin-runtime`：`TemplateContext` 改为分组——`bot`（`adapter`、`endpoint`、`endpointId`、新增的 `prefix` 与 `menu`，新增导出类型 `TemplateBot`）、`conversation`（`kind`、`id`）、`sender`（`id`、`name`、`roles`）、`message`（`content`、`segments`、`id`、`timestamp`、`mentioned`）与新增的 `command`（发出消息的插件自己的命令在该账号下的写法，`${command.checkin}`、`${command.group.kick}`，命令名里的 `-` 写成 `_`，新增导出类型 `TemplateCommandPaths`）。由事件触发、没有入站消息的发送，由发送方插件经 `incoming.sender` 传入事件主体。
- `@zhin.js/core`：出站渲染按新结构填值；`${bot.menu}` / `${command.*}` 按这次发送的语言（`SendRequest.locale`，`$reply` 带入站消息的语言）取菜单关键词，没有时用项目语言，与入站 `message.commandMenu` / `formatCommand` 一致；`menuKeyword: false` 时 `${bot.menu}` 原样保留并按代告警一次（`reason=menu_disabled`）；`bot.prefix` / `bot.menu` 用与入站命令派发同一个 MessageDispatcher（同一个前缀解析器，含 `ImRuntime` 的 `commandPrefix` 覆盖）计算，只有文本含 `${` 时才计算，`${command.*}` 只在文本写了它时才列命令。模板仍是白名单路径替换、单次扫描；`command` 数据冻结、只有数据属性、不含其他插件的命令。
- `@zhin.js/plugin-group-suite`：**不兼容变更**——入群欢迎语与问答回答改用出站模板占位符，旧的 `{name}`、`{id}`、`{sender}`、`{sender.id}`、`{time}`、`{date}` 不再展开，会原样发出。欢迎语写 `${sender.name}` / `${sender.id}`（新成员作为数据传入，昵称里的占位符不会被展开）、`${bot.menu}`、`${bot.prefix}`、`${command.*}`；问答回答另可写 `${now.time}`、`${now.date}`（由插件按提问者语言填写），正则捕获组 `$1`–`$9` 作为不受信任内容发送，不会被当成模板。账号配置了命令前缀而欢迎语直接写「帮助」「菜单」「help」「menu」时，在该账号第一条群消息时打一条 warn（只对本插件实际负责欢迎的群：在 `welcomeConversations` 内、且未由 Agent 会话欢迎接管）。欢迎语与已存问答里的旧占位符（`{name}`、`{sender.id}`、`{time}`、单段 `${menu}` 等）首次用到时按账号与文本各告警一次并给出新写法，只告警，不兼容、不迁移。
  - 回显用户数据的命令回复不再把数据当模板展开：teach / teach-regex 的确认、teach-list、forget、keyword-add / keyword-list / keyword-remove、积分与消息排行、mypoints、mystats 里引用的问题、回答、关键词、昵称与正则错误信息作为不受信任分段发送，按存储原样显示（此前教 `你好|你好 ${sender.name}` 的确认会显示「你好 Admin」）；只有插件自己的文案是模板。
  - **公开导出的返回类型变化**：`tryTeachReply` 由 `Promise<string | null>` 变为 `Promise<SendContent | null>`；`teachAdd`、`teachList`、`teachForget`、`myPoints`、`pointsRank`、`statsRankText`、`myStatsText` 由 `Promise<string>` 变为 `Promise<SendContent>`（引用用户数据时是含不受信任分段的数组）。直接调用这些函数的代码需按 `SendContent` 处理，或交给 `$reply` / 出站链发送。
- `@zhin.js/agent`：Agent 会话入群欢迎（ADR 0037）的 `{nickname}` / `{group}` / `{rules_url}` 填入的值作为数据（`WelcomePart` 文本段新增可选 `literal: true`，发送时为不受信任分段），昵称里的 `${bot.menu}` 等不再被展开；运营者写的其余文本仍是出站模板。
- `@zhin.js/testing`：`PluginTestKit` 与 `zhin start` 一样安装出站模板 Host（测试自己提供时不覆盖）。
- `@zhin.js/gateway`：群欢迎用途页的提示改为新占位符写法。
