---
'@zhin.js/command': patch
'@zhin.js/adapter': patch
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
'zhin.js': patch
---

Derive Command user routes only from explicit `commands/**/*/index.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/list/index.ts` and are invoked as `qq endpoint list`.
