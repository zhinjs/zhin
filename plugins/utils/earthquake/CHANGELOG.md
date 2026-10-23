# @zhin.js/plugin-earthquake

## 0.1.2

### Patch Changes

- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 0.1.1

### Patch Changes

- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- 520f64b: Add `@zhin.js/plugin-earthquake`: the `地震` query plus per-conversation alert subscriptions (`地震 订阅|退订|订阅状态`) with magnitude thresholds and region keywords, merging CENC (mirror-backed, configurable URLs) and USGS with cross-source de-duplication. Every request has a timeout, jittered exponential backoff with Retry-After support, per-source cooldown and failover; the poller never throws, baselines each source before pushing, and rate-limits pushes per conversation. Includes the read-only agent tool `recent_earthquakes`.
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
  - @zhin.js/tool@1.1.8
  - @zhin.js/skill@1.1.8
