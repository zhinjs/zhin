---
"@zhin.js/adapter": patch
"@zhin.js/agent": patch
"@zhin.js/core": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
---

ADR 0044 integration and C6 guard. `delivery.spool` now reproduces the pre-0044 media rule (icqq `false`, every other official adapter `true`). icqq narrows `actions.recall.others` unless the Bot is admin or owner, and declares recall for groups. Endpoint kind capabilities merge the Endpoint's `operations` (Discord reactions keep working; Discord declares reaction feedback). Adapters in the `@zhin.js/` scope are trusted: their custom prompt text is not labelled `external_content`. Core no longer keeps a telegram/discord interactive-policy table (adapters declare `segments.interactive`). New `pnpm check:no-platform-branches` blocks platform-name branches in runtime code.
