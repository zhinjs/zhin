# @zhin.js/plugin-bilibili

## 0.1.2

### Patch Changes

- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 0.1.1

### Patch Changes

- c67e43d: 取消某 UP 主的最后一个订阅时，同步清理 watcher 中该 UP 的退避记录，避免已退订 UID 的条目残留。
- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- 66fc5dd: Add `@zhin.js/plugin-bilibili`: per-conversation Bilibili live-start and UP dynamic subscriptions (`bili sub|unsub|list|live`), a conservative scheduled watcher with jitter, exponential backoff, baseline-first dedupe and WBI signing, database persistence with an in-memory fallback, and read-only agent tools `bili_live_status` / `bili_list_subscriptions`. In groups and channels `bili sub` / `bili unsub` are limited to the group owner, admins and the bot master; private chats can manage their own subscriptions.
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
  - @zhin.js/tool@1.1.8
  - @zhin.js/skill@1.1.8
