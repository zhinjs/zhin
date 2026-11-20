---
"@zhin.js/plugin-runtime": minor
"@zhin.js/core": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/testing": patch
"@zhin.js/gateway": patch
---

feat: 出站模板按发送账号渲染命令前缀、菜单与命令写法（#1250 第 70 批）

- `@zhin.js/plugin-runtime`：`TemplateContext` 新增可选的纯数据字段 `prefix`（发送账号的命令前缀，无前缀为空串）、`menu`（该账号的菜单入口，菜单关闭时没有）与 `command`（发出消息的插件自己的命令在该账号下的写法，`${command.checkin}`、`${command.group.kick}`，命令名里的 `-` 写成 `_`），新增导出类型 `TemplateCommandPaths`。主体沿用 `sender`：由事件触发、没有入站消息的发送，由发送方插件经 `incoming.sender` 传入事件主体。
- `@zhin.js/core`：出站渲染时填这些字段，用与入站命令派发同一个 MessageDispatcher（同一个前缀解析器，含 `ImRuntime` 的 `commandPrefix` 覆盖）计算；只有文本含 `${` 时才计算，`${command.*}` 只在文本写了它时才列命令。模板仍是白名单路径替换、单次扫描；`command` 数据冻结、只有数据属性、不含其他插件的命令。
- `@zhin.js/plugin-group-suite`：**不兼容变更**——入群欢迎语与问答回答改用出站模板占位符，旧的 `{name}`、`{id}`、`{sender}`、`{sender.id}`、`{time}`、`{date}` 不再展开，会原样发出。欢迎语写 `${sender.name}` / `${sender.id}`（新成员作为数据传入，昵称里的 `${menu}` 不会被展开）、`${menu}`、`${command.*}`；问答回答写 `${sender.name}`、`${sender.id}`、`${time}`、`${date}`（时间、日期由插件按提问者语言填写），正则捕获组 `$1`–`$9` 作为不受信任内容发送，不会被当成模板。账号配置了命令前缀而欢迎语直接写「帮助」「菜单」「help」「menu」时，在该账号第一条群消息时打一条 warn。注意：配置文件里单个名字的 `${menu}`、`${prefix}` 会先被当成环境变量引用展开，配置里暂写 `${menu:-${menu}}`。
- `@zhin.js/testing`：`PluginTestKit` 与 `zhin start` 一样安装出站模板 Host（测试自己提供时不覆盖）。
- `@zhin.js/gateway`：群欢迎用途页的提示改为新占位符写法。
