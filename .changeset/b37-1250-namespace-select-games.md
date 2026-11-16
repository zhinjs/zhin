---
"@zhin.js/command": patch
"zhin.js": patch
"@zhin.js/adapter": minor
"@zhin.js/core": minor
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-60s": patch
---

命名空间下的参数指令、超过 10 项的选择、猜谜与地牢远征的入口（#1250 第 37 批）。

- `command-namespace-param-commands-swallowed`：路由顺序原先是「所有静态路由先于所有带参数段的路由」，于是只要有一条更短的静态路由（例如另一个插件或根项目里的 `60s`）能匹配开头，`60s fanyi 你好`、`60s douyin`、`60s fuel 四川` 就会被它吃掉，无参数的指令又会忽略多出来的词，日志照样是 `command_replied | executed`。现在按字面路径长度优先：字面词更多的路由先匹配，字面长度相同时静态路由仍先于参数路由。`<命名空间>` 与 `<命名空间> --help`（以及任意指令组的 `<组> --help`）列出该组下发送者能用的全部指令；某条指令的 `--help` 也列出它下面（至少多一个字面词）的子指令，参数指令不会把自己列进去。插件的 `commandNamespace` 与它自己的指令同名（命名空间 `60s` + 指令 `60s` → `60s 60s`）时，实例启动时记一条 `command_namespace_collision` 警告。
- `select-over-10-options-no-buttons`：core 不再只给 ≤10 项的 `select` 生成按钮，所有选项都交给端点；选择提示改为「回复序号或选项名称。」，不再声称「可以点击按钮」。适配器能力画像新增可选的 `segments.interactiveLimits.maxButtons`（`@zhin.js/adapter` 新增类型 `AdapterInteractiveLimits`）：原生按钮的端点超过上限时，前 N 项保留按钮，其余选项改成紧挨按钮的序号列表（回复序号或名称照常生效；整块键盘一起登记序号，列出的序号接在按钮之后，回复「1」仍是第一个按钮）；纯文本端点照旧降级为序号列表。QQ 官方、Discord、Slack 声明 25，Telegram 声明 100；Sandbox 不设上限，按钮较多时在气泡内滚动。`@zhin.js/core` 新增导出 `resolveOutboundMaxButtons()` / `applyOutboundButtonLimit()`。该字段与 Sandbox 全能力 ADR 草案 P3 的 `interactive` 对象形式（`{ buttons: { maxTotal } }`）对应：`maxButtons` 将折进 `maxTotal`，字符串形式的 `interactive` 继续作为简写有效；本批不新增 `select` 段。
- 猜谜（字谜 / 猜成语）：直接回复「提示」「跳过」「结束」（以及 hint / skip / end）按对应操作处理，卡片上写明可以这样回复。提示给出真实信息：成语给第 1 个字，字谜给包含答案的 4 个候选字；提示扣 3 分、不再清零连击。「结束」（按钮或 `猜谜 quit`）公布当前题的答案并结算本局（已答题数、得分、最佳连击）。题库去掉重复的标点（「……活下去。。」）。
- `dungeon-entry-unhelpful`：`dungeon` / `地牢远征` / `地牢` 不带参数且当前频道没有队伍时显示帮助与开局方式（`dungeon start`）；指令新增别名「地牢」。按钮按回复对象的状态给出：队员看不到「加入队伍」，队长在大厅里先看到「开始远征」，非队长看不到「结束」；大厅里提示其他人回复「加入队伍」入队。结束远征先要求队长确认，结束后给出结算（到达层数、清理房间数、队伍金币）。「你是不是想用」在指令名都不相近时也和插件显示名比对（带指令前缀时 `地牢探险` → 显示名为「地牢远征」的插件）；没有前缀（私聊、@机器人）时只按前一半逐字相同放宽的匹配要求这一半至少 4 个字，`天气不错`、`天气` 这类聊天不会被显示名「天气预报」截走。
- `60s-gold-currency-mixed`：金价按接口返回的单位写货币符号（美元用 `$`、人民币用 `¥`，其他币种不加符号）。
