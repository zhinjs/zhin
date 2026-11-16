---
"@zhin.js/core": minor
"@zhin.js/command": minor
"@zhin.js/game-kit": patch
"@zhin.js/runtime": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
---

游戏输入与入站结局（zhinjs/zhin#1250 第 34 批）：

- `game-input-also-reaches-agent`：猜数字的数字中间件在游戏回复之后仍调用 `next()`，同一条「50」又流到 Agent，于是有两条回复。现在游戏处理过的输入就结束分发，只有没有对局时才放行。`replyGameOperation()` 返回游戏是否回复了（`boolean`），并接受可选的 `input`：传入后把消息结局记成 `handler_replied` / `game_input`。所有游戏的对局中间件都会传入它。成语接龙和猜谜的自由文本作答也改为只在游戏真正处理了输入时才结束分发。
- `inbound-outcome-middleware-reply-mislabeled`：中间件先回复（回执 `sent`）再停止分发的，结局记 `handler_replied` / `middleware_replied`。只有没有任何已送达回复的停止，才记 `filtered_by_policy` / `middleware_stopped`。入站结局端口 `InboundOutcomeSink` 新增可选方法 `replied()`。ADR 0061 已同步；没有改动已有的 reason 取值。
- `game-button-label-text-not-accepted`：游戏会话同时接受序号和按钮文字（忽略 emoji、空白与大小写），例如「要牌」「🏳️ 放弃」。`buildChoiceKeyboard()` / `buildGridKeyboard()` 统一在卡片上加一行「回复序号或按钮文字也可以」：猜数字的数字是猜测本身，所以只提示按钮文字；对局结束后没有可点按钮时不加。键盘段新增 `fallback.layout: 'inline'`，在能力画像为 `interactive: 'text'` 的适配器上，按钮渲染成一行 `1. 要牌  2. 停牌  3. 放弃`。井字棋改为按棋盘位置编号：回复 1–9 落在对应格，卡片上写明「回复 1–9 在对应位置落子（左上为 1，右下为 9）」。
- `game-command-names-mixed-language`：所有游戏的子命令都有中英两种写法，都能用（开始 / 继续 / 退出 / 认输 / 加入 / 离开 / 观战 / 人机）。帮助和提示里的写法跟命令名同一种语言，`formatGameHelp()` / `gameCommandHint()` 统一处理。井字棋的中文命令改为与标题一致的「井字棋」，旧名「井字游戏」仍可用。约定写在 `plugins/games/README.md`。
- `near-miss-suggestion-param-misleading`：指令参数新增只用于显示的 `suggestions` / `suggestionsI18n`。「你是不是想用」改为列出真实子命令（`玩石头剪刀布 开始|继续|退出`），不再显示 `[action]`。「玩石头剪刀布 石头」/「猜拳 石头」现在一步开局并出拳。
- `game-quit-means-forfeit`：会判负的退出（井字棋、成语接龙）在帮助里写「认输并结束对局」；其他游戏的退出写「结束当前对局（不计胜负）」。
- `command-menu-unreadable-in-sandbox`：指令菜单模板加了媒体查询：宽度 860px 以下为两列，560px 以下为单列，名称按词换行。Sandbox 按 HTML 段请求的 `width` 渲染，再等比缩小到聊天栏宽度，和平台实际收到的图片一致。
- `config-write-moves-inline-comment`：YAML 逐键补丁不再把写在键行上的注释（`"user:…": # …` 后接块状列表或映射）挪到下一行。补丁没有触及的顶层条目逐字节保留原文，flow 集合的空格风格也沿用原文件。`zhin disable` 现在只改 `disable_plugins`。
