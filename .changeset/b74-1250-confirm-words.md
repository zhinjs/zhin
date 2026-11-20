---
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": minor
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-music": patch
---

确认 / 取消词统一为一套词表，中英文都认、不分语言（zhinjs/zhin#1250 第 74 批）。之前至少 6 处各有一份词表，有的按提问语言分开（中文提问回 `yes` 不算确认），有的中英混收，有的只认一个词。

- 新增导出（`@zhin.js/core`，经 `zhin.js` 再导出）：`isConfirmWord(text, options?)`、`isCancelWord(text, options?)` 与类型 `ReplyWordOptions`。匹配先做 NFKC（全角转半角）、去首尾空白、去掉末尾标点（`！!。.？?` 等）、不区分大小写，再整句比对——`我不确定`、`取消了吗` 都不是取消词。
- 基础确认词：`确认` / `确定` / `同意` / `confirm` / `yes` / `y` / `ok` / `agree`；基础取消词：`取消` / `退出` / `算了` / `cancel` / `quit` / `exit`。是非答语 `是` / `好` / `true` 与 `不` / `否` / `拒绝` / `no` / `n` / `reject` / `false` 只在明确的是非问答里算（`{ yesNo: true }`：`confirm` 提问、布尔列表），普通对话里一句「不」或「no」不会被当成取消。选项序号 `1` / `2` 只在 `confirm` 提问与布尔列表里局部认。
- 行为放宽：`confirm` 提问不再按提问语言区分回答（中文提问回 `yes`、英文提问回 `取消` 都有效；提问与提示文案仍用流程固定的语言），并新增 `确定`、`好`、`不`、`ok`、`算了` 等；`select` / `multiselect` / `number` / `list` / `text` 的取消词新增 `算了`，并接受全角、大小写与末尾标点；选项的名称与别名比对也做同样的规范化（`生产。` 选中「生产」）。普通 `select` / `multiselect` 只按名称、别名与序号匹配，不会因为选项名或别名在词表里就接受同类词（选项「好」不认 `ok`，选项 `N` 不认 `no`）。
- 审批（`purpose: 'approval'`：普通审批、`humanOnly`、需主人、一次性确认）更严，只认明确答语，中英文不分提问语言：批准是 `确认` / `同意` / `批准` / `confirm` / `approve` / `yes`，拒绝是 `拒绝` / `否` / `no` / `deny` / `reject`，以及选项名与序号。`好`、`是`、`ok`、`y`、`true`、`确定`、`agree` 不再批准（之前英文审批认 `y`），按无效回答重问；`不`、`n` 也不再算拒绝。别名不再按语言分开，统一显示 `否 / no` 与 `确认 / yes`。回复 `取消` / `cancel` 等取消词仍算拒绝（现在与其他提问一样按取消离开，并回复「已取消。」）。
- Agent 停止当前回合：`取消` 之外也认 `退出`、`算了`、`quit`、`exit` 及全角、大小写、末尾标点；`@zhin.js/agent/turn` 的 `isCancelIntent(text, commandPrefix?)` 新增可选参数，带命令前缀的取消词（如前缀为 `/` 时的 `/cancel`、前缀为 `#` 时的 `#取消`）按会话真实的命令前缀剥离后识别，不再写死 `/cancel`——命令前缀不是 `/` 的会话里，`/cancel` 不再停止回合（发 `cancel` 或带本会话前缀即可）。
- 聊天重启 `restart` 的确认参数、功能自助 `功能 确认 <码>` 的确认子命令认所有基础确认词（如 `restart 确定`、`restart ok`、`功能 OK 123456`），仍需同一个人在同一会话、在时限内确认；`是` / `no` 等是非答语不算。
- 插件：提醒创建（`@zhin.js/plugin-reminder`）只对等待中的补问回复判断取消，不再把命令参数当取消（之前 `remind create 十分钟后 取消` 会直接取消；现在 `remind create 明天9点 退出` 按正文「退出」创建）。提醒的补问与点歌选择（`@zhin.js/plugin-music`）之前只认当前语言的一个取消词（`取消` 或 `cancel`），现在不分语言都认上述取消词；回复文案仍用流程固定的语言。
