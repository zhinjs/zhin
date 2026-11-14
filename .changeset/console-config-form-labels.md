---
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-bilibili-live": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-douyin-live": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-juejin": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/console-protocol": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-answers": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-link-poster": patch
"@zhin.js/plugin-lottery": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-nettools": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-repeater": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-runtime": patch
"@zhin.js/plugin-short-url": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
"@zhin.js/process-monitor": patch
"@zhin.js/runtime": patch
"@zhin.js/service-activity-feedback": patch
"@zhin.js/service-typesafe": patch
"zhin.js": patch
---

配置表单与插件显示名的多语言约定（#1250）：Schema 节点沿用已有的 `x-i18n`（`Schema#i18n()`），按 `zh-CN` / `en` 分别声明字段的 `title`、`description` 与 `enumLabels`；插件 `metadata`（`definePlugin` 或 `package.json#zhin.metadata`）新增可选的 `displayNameI18n: { 'zh-CN'?, en? }`，与 `displayName` 一样只能在一处声明，清单只接受这两个键且值必须是非空字符串。Console 插件列表（`/api/plugins`、插件详情）和 `feature.list` / `feature.matrix` 原样带出 `displayNameI18n`，由 Console 按界面语言选择（当前语言 → `en` → `displayName` → 实例 key）。没有这些字段时行为不变。

官方插件补齐中英文配置字段标题与说明（group-suite、repeater、roulette、answers、calendar、ledger、reminder、rss、earthquake、bilibili、content-moderation、lottery、nettools、60s、process-monitor、activity-feedback）以及全部官方插件的中英文显示名。
