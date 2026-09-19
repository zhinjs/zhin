---
'@zhin.js/feature-kit': minor
'@zhin.js/command': minor
'@zhin.js/adapter': minor
'@zhin.js/middleware': minor
'@zhin.js/handler': minor
'@zhin.js/component': minor
'@zhin.js/tool': minor
'@zhin.js/mcp-feature': minor
'@zhin.js/prompt-section': minor
'@zhin.js/page': minor
'@zhin.js/runtime': minor
'@zhin.js/agent': minor
'@zhin.js/cli': minor
'create-zhin-app': minor
'zhin.js': minor
'@zhin.js/adapter-dingtalk': patch
'@zhin.js/adapter-discord': patch
'@zhin.js/adapter-email': patch
'@zhin.js/adapter-github': patch
'@zhin.js/adapter-icqq': patch
'@zhin.js/adapter-kook': patch
'@zhin.js/adapter-lark': patch
'@zhin.js/adapter-line': patch
'@zhin.js/adapter-milky': patch
'@zhin.js/adapter-napcat': patch
'@zhin.js/adapter-onebot11': patch
'@zhin.js/adapter-onebot12': patch
'@zhin.js/adapter-qq': patch
'@zhin.js/adapter-sandbox': patch
'@zhin.js/adapter-satori': patch
'@zhin.js/adapter-slack': patch
'@zhin.js/adapter-telegram': patch
'@zhin.js/adapter-wechat-mp': patch
'@zhin.js/adapter-wecom': patch
'@zhin.js/adapter-weixin-ilink': patch
'@zhin.js/plugin-60s': patch
'@zhin.js/plugin-blackjack': patch
'@zhin.js/plugin-code-runner': patch
'@zhin.js/plugin-content-moderation': patch
'@zhin.js/plugin-dice-duel': patch
'@zhin.js/plugin-dungeon-expedition': patch
'@zhin.js/plugin-game-hub': patch
'@zhin.js/plugin-group-suite': patch
'@zhin.js/plugin-guess-number': patch
'@zhin.js/plugin-idiom-chain': patch
'@zhin.js/plugin-link-poster': patch
'@zhin.js/plugin-lottery': patch
'@zhin.js/plugin-music': patch
'@zhin.js/plugin-qrcode': patch
'@zhin.js/plugin-repeater': patch
'@zhin.js/plugin-rps': patch
'@zhin.js/plugin-rss': patch
'@zhin.js/plugin-short-url': patch
'@zhin.js/plugin-text-adventure': patch
'@zhin.js/plugin-tic-tac-toe': patch
'@zhin.js/plugin-word-riddle': patch
'@zhin.js/process-monitor': patch
---

Require `$`-prefixed files for file-convention capability entries. Unprefixed files inside convention directories are now ordinary colocated modules and are never discovered as capabilities.

Command entry names strip the marker, while `$[name].ts` and related bracket forms declare top-level dynamic parameters. A child plugin can therefore expose `namespace <value>` directly without an artificial static command segment.

Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.
