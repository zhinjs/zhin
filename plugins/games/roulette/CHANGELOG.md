# @zhin.js/plugin-roulette

## 0.1.4

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [3781f1c]
  - @zhin.js/core@1.1.50
  - @zhin.js/game-kit@1.1.15

## 0.1.3

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
  - @zhin.js/core@1.1.49
  - @zhin.js/game-kit@1.1.14

## 0.1.2

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48
  - @zhin.js/game-kit@1.1.13

## 0.1.1

### Patch Changes

- e40899f: Adapters now project group owners and admins onto the canonical `sender.roles` names `owner` / `admin` (Telegram creator/administrator, KOOK guild owner and admin-permission roles, Lark chat owner/managers, QQ official guild owner/admin identities). KOOK numeric role ids moved from `roles` to `permissions` (`role:<id>`). `@zhin.js/command` exports `canManageConversation` ("private chat or owner/admin/master"), now shared by the Bilibili and earthquake subscription commands; Roulette lets owners and admins toggle the mute penalty and cancel a game.
- 84520a3: New game: Russian roulette (`轮盘` / `roulette`) for game-hub. Players join a lobby, take turns pulling the trigger on a cylinder with one bullet, and whoever is shot loses; turn and lobby timeouts are enforced by a schedule job, and results feed `战绩` / `排行 轮盘`. Groups can opt in to muting the loser; support is read from the Endpoint's declared `muteGroupMember` capability, so platforms that cannot mute only keep score.
- 37f79a1: 轮盘超时扫描：先读取禁言惩罚设置再提交状态流转，单个对局失败只记录日志并留待下次重试，结果在产生时即刻公布，不再丢失其他对局的通知或输家的惩罚。
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [53d5bd7]
- Updated dependencies [c618eb7]
- Updated dependencies [fbfefb7]
  - @zhin.js/core@1.1.47
  - @zhin.js/game-kit@1.1.12
