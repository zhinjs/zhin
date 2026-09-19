---
'@zhin.js/command': minor
'@zhin.js/adapter': minor
'@zhin.js/adapter-dingtalk': minor
'@zhin.js/adapter-discord': minor
'@zhin.js/adapter-github': minor
'@zhin.js/adapter-icqq': minor
'@zhin.js/adapter-kook': minor
'@zhin.js/adapter-lark': minor
'@zhin.js/adapter-line': minor
'@zhin.js/adapter-milky': minor
'@zhin.js/adapter-napcat': minor
'@zhin.js/adapter-onebot11': minor
'@zhin.js/adapter-onebot12': minor
'@zhin.js/adapter-qq': minor
'@zhin.js/adapter-satori': minor
'@zhin.js/adapter-slack': minor
'@zhin.js/adapter-telegram': minor
'@zhin.js/adapter-wechat-mp': minor
'@zhin.js/adapter-wecom': minor
'@zhin.js/adapter-weixin-ilink': minor
'zhin.js': minor
---

Derive Command user routes only from explicit `commands/**/$*.ts(x)` entry paths instead of prepending the plugin owner. Child plugins can now publish top-level static or dynamic commands, while duplicate routes across owners fail during generation construction. Adapter endpoint commands move to explicit paths such as `commands/qq/endpoint/$list.ts` and are invoked as `qq endpoint list`.
