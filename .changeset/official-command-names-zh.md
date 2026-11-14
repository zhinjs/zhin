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

官方插件指令补中文名与本地化说明，并统一子命令写法（#1250）：游戏指令新增中文别名（猜数字、石头剪刀布、游戏 / 游戏列表、二十一点、骰子对决、地牢远征、成语接龙、文字冒险、井字游戏、猜谜语、俄罗斯轮盘），中文菜单显示中文名，说明改为中文并附英文 `descriptionI18n`；连字符指令新增空格子命令写法并在菜单中显示（`rss add` / `rss list` …、`lottery today` …、`keyword add` / `stats week` …、`ledger add` …、`repeater status`、`process status`、`game stats` / `game ranking`、`bili draft list` / `bili login status` …、`juejin draft list` …），旧的连字符名称继续可用。`teach-list` 因 `teach <问题> <答案>` 接收自由文本而保留原名。

过于通用的顶层指令增加带插件名的形式（旧名保留为别名）：二维码 `qrcode gen` / `生成二维码`、`qrcode scan` / `识别二维码`；短链 `short <url>` / `短链 <url>`、`short expand <url>` / `还原短链 <url>`，菜单显示新形式。
