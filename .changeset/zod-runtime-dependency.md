---
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-60s": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-code-runner": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-nettools": patch
"@zhin.js/plugin-qrcode": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-short-url": patch
---

`zod` 改为运行时依赖（原为可选对等依赖）：插件运行时在启动时就会加载这些包的约定目录（Agent 工具、命令等），其中静态导入了 `zod`；生成的项目里没有安装可选对等依赖，启动会报 `Cannot find package 'zod'`。范围为 `^4.6.7`（已修复的版本）。
