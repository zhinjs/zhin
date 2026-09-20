---
'@zhin.js/cli': patch
'@zhin.js/adapter-dingtalk': patch
'@zhin.js/adapter-discord': patch
'@zhin.js/adapter-github': patch
'@zhin.js/adapter-icqq': patch
'@zhin.js/adapter-kook': patch
'@zhin.js/adapter-lark': patch
'@zhin.js/adapter-line': patch
'@zhin.js/adapter-napcat': patch
'@zhin.js/adapter-onebot11': patch
'@zhin.js/adapter-qq': patch
'@zhin.js/adapter-slack': patch
'@zhin.js/adapter-telegram': patch
'@zhin.js/adapter-wecom': patch
---

Isolate adapter Skills under platform-specific Agents and automatically select the matching platform Agent for IM ingress, preventing unrelated adapter Skills from entering another platform's prompt surface.
