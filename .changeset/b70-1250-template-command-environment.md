---
"@zhin.js/plugin-runtime": minor
"@zhin.js/core": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/testing": patch
"@zhin.js/gateway": patch
---

feat!: 出站模板占位符重组为分组字段，并按发送账号渲染命令前缀、菜单与命令写法（#1250 第 70 批）

**不兼容变更**：`TemplateContext` 字段重组，旧的顶层占位符 `${adapter}`、`${endpoint}`、`${endpointId}`、`${kind}`、`${conversationId}`、`${content}`、`${segments…}`、`${messageId}`、`${timestamp}`、`${mentioned}` 不再展开，会原样发出。所有占位符都至少两段，不再和配置加载时的环境变量引用（单个名字的 `${NAME}`）冲突。

- `@zhin.js/plugin-runtime`：`TemplateContext` 改为分组——`bot`（`adapter`、`endpoint`、`endpointId`、新增的 `prefix` 与 `menu`，新增导出类型 `TemplateBot`）、`conversation`（`kind`、`id`）、`sender`（`id`、`name`、`roles`）、`message`（`content`、`segments`、`id`、`timestamp`、`mentioned`）与新增的 `command`（发出消息的插件自己的命令在该账号下的写法，`${command.checkin}`、`${command.group.kick}`，命令名里的 `-` 写成 `_`，新增导出类型 `TemplateCommandPaths`）。由事件触发、没有入站消息的发送，由发送方插件经 `incoming.sender` 传入事件主体。
- `@zhin.js/core`：出站渲染按新结构填值；`bot.prefix` / `bot.menu` 用与入站命令派发同一个 MessageDispatcher（同一个前缀解析器，含 `ImRuntime` 的 `commandPrefix` 覆盖）计算，只有文本含 `${` 时才计算，`${command.*}` 只在文本写了它时才列命令。模板仍是白名单路径替换、单次扫描；`command` 数据冻结、只有数据属性、不含其他插件的命令。
- `@zhin.js/plugin-group-suite`：**不兼容变更**——入群欢迎语与问答回答改用出站模板占位符，旧的 `{name}`、`{id}`、`{sender}`、`{sender.id}`、`{time}`、`{date}` 不再展开，会原样发出。欢迎语写 `${sender.name}` / `${sender.id}`（新成员作为数据传入，昵称里的占位符不会被展开）、`${bot.menu}`、`${bot.prefix}`、`${command.*}`；问答回答另可写 `${now.time}`、`${now.date}`（由插件按提问者语言填写），正则捕获组 `$1`–`$9` 作为不受信任内容发送，不会被当成模板。账号配置了命令前缀而欢迎语直接写「帮助」「菜单」「help」「menu」时，在该账号第一条群消息时打一条 warn。
- `@zhin.js/testing`：`PluginTestKit` 与 `zhin start` 一样安装出站模板 Host（测试自己提供时不覆盖）。
- `@zhin.js/gateway`：群欢迎用途页的提示改为新占位符写法。
