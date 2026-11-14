---
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/process-monitor": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-juejin": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-short-url": patch
---

官方插件指令补中文名与本地化说明，并统一子命令写法（#1250）：游戏指令新增中文别名（猜数字、玩石头剪刀布、游戏大厅 / 游戏列表、玩二十一点、骰子对决、地牢远征、成语接龙、文字冒险、井字游戏、猜谜语、俄罗斯轮盘），中文菜单显示中文名，说明改为中文并附英文 `descriptionI18n`；连字符指令新增空格子命令写法并在菜单中显示（`rss add` / `rss list` …、`lottery today` …、`keyword add` / `stats week` …、`ledger add` …、`repeater status`、`process status`、`game stats` / `game ranking`、`bili draft list` / `bili login status` …、`juejin draft list` …），旧的连字符名称继续可用。`teach-list` 因 `teach <问题> <答案>` 接收自由文本而保留原名。

过于通用的顶层指令增加带插件名的形式（旧名保留为别名）：二维码 `qrcode gen` / `生成二维码`、`qrcode scan` / `识别二维码`；短链 `生成短链 <url>`、`short expand <url>` / `还原短链 <url>`，菜单显示新形式。未配置指令前缀时日常群聊里的高频词不会被当成指令：不使用单独的「游戏」「二十一点」（也是时间）「石头剪刀布」「短链」「short」作别名。

**升级注意**：新增的别名与项目里已有的同名指令（或其他插件的别名）冲突时，启动会以 `Duplicate Command route` 失败；可用 `disabledCommands` 停用其中一条，或用 `commandNamespace` 给插件指令加命名空间。
