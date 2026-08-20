---
'@zhin.js/cli': patch
'@zhin.js/adapter-dingtalk': patch
'@zhin.js/adapter-discord': patch
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
'@zhin.js/adapter-satori': patch
'@zhin.js/adapter-slack': patch
'@zhin.js/adapter-telegram': patch
'@zhin.js/adapter-wechat-mp': patch
'@zhin.js/adapter-wecom': patch
'@zhin.js/adapter-weixin-ilink': patch
'@zhin.js/process-monitor': patch
'@zhin.js/plugin-blackjack': patch
'@zhin.js/plugin-dice-duel': patch
'@zhin.js/plugin-dungeon-expedition': patch
'@zhin.js/plugin-guess-number': patch
'@zhin.js/plugin-game-hub': patch
'@zhin.js/plugin-idiom-chain': patch
'@zhin.js/plugin-rps': patch
'@zhin.js/plugin-text-adventure': patch
'@zhin.js/plugin-tic-tac-toe': patch
'@zhin.js/plugin-word-riddle': patch
'@zhin.js/plugin-60s': patch
'@zhin.js/plugin-code-runner': patch
'@zhin.js/plugin-content-moderation': patch
'@zhin.js/plugin-group-suite': patch
'@zhin.js/plugin-link-poster': patch
'@zhin.js/plugin-lottery': patch
'@zhin.js/plugin-music': patch
'@zhin.js/plugin-qrcode': patch
'@zhin.js/plugin-repeater': patch
'@zhin.js/plugin-rss': patch
'@zhin.js/plugin-short-url': patch
---

Declare Stable Feature packages referenced by `zhin.features` as optional `peerDependencies` on official plugins/adapters (`@zhin.js/runtime` ≥1.0.12 requires features to be declared in deps/peers). Keeps authoring via `zhin.js` facades without installing Feature implementation packages into `dependencies`, and removes the need for consumer postinstall peer-patch scripts. `zhin new` scaffolds the same peer shape.
