---
"@zhin.js/adapter-bilibili-live": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/cli": patch
"@zhin.js/client": patch
"@zhin.js/console-contract": patch
"@zhin.js/page": patch
"@zhin.js/pagemanager": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-ledger": patch
"@zhin.js/plugin-reminder": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/process-monitor": patch
---

Unify Console page blueprints (`definePageBlueprint` / `createDeclarativePage` and `defineAdapterPage` / `createAdapterConsolePage`) into `@zhin.js/console-contract` and `@zhin.js/page`, remove `@zhin.js/client` (React 19) runtime dependencies from all 28 server-side plugins and adapters, and remove legacy Era-1 Koa `PageManager` code from `@zhin.js/pagemanager`.
