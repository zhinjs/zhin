---
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/command": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-roulette": patch
---

Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
