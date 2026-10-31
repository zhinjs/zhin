# @zhin.js/plugin-roulette

## 0.1.8

### Patch Changes

- a9f4e48: PATCH COMPATIBILITY CUTOVER: this batch intentionally changes plugin APIs. The maintainer explicitly chose patch releases with declared version boundaries. Upgrade the complete tested dependency set; patch numbering does not promise compatibility with the removed interfaces.

  The first planned floors are zhin.js 1.1.19, Core 1.1.54, Adapter 1.1.26, FeatureKit 1.1.10, Plugin Runtime 1.1.18, Runtime/Isolate 1.1.16 and Agent 1.1.45. Keep old-interface plugins with the earlier locked stack until they are migrated. Adapter's independent Feature API changes from 1.0.0 to 2.0.0; official consumers declare ^2.0.0. Existing Feature API admission rejects explicitly incompatible ranges; omitted API metadata keeps its existing behavior and does not certify compatibility. Runtime engine and patch-only release gates remain unchanged.

  Use the native-Client Adapter target contract, canonical FeatureKit AdapterRegistry augmentation and named Endpoint control/management requests. Route message controls from canonical message/conversation refs; retain exact source authority and propagate caller/account/explicit-Root-stop cancellation. Replace removed Agent activity feedback exports with source-bound feedback. HMR pause/resume belongs to concrete plugin instances; plugins choose accepted-work policy without changing Controller commit/rollback authority. Cooperative worker/process control cancellation does not kill an isolate or reopen retired business admission.

  Provide authenticated historical-data preview, exact selected binding, transactional application, authoritative inspection and explicit resumption, including active games. Preserve before-images and journals; never replay an unconfirmed effect, infer an account from an alias, or reuse historical permission grants. Owner V2 approvals remain inactive legacy data, while new writes use V3. Rollback requires matching software, lockfile and verified data; installing old code alone cannot read a new V3 approval file. Conflicting after-images are never overwritten.

  See docs/plans/adapter-operation-version-boundaries.md and the Chinese/English upgrade guide for the complete version inventory, custom-plugin changes, acceptance and recovery sequence. These code and metadata changes do not authorize merging, publication, deployment, login, production migration or removal of installed workspace patches.

- Updated dependencies [2c3610a]
- Updated dependencies [a9f4e48]
- Updated dependencies [f8505b0]
  - @zhin.js/core@1.1.54
  - @zhin.js/game-kit@1.1.19

## 0.1.7

### Patch Changes

- Updated dependencies [c58c589]
  - @zhin.js/core@1.1.53
  - @zhin.js/game-kit@1.1.18

## 0.1.6

### Patch Changes

- Updated dependencies [f67883e]
- Updated dependencies [4d728c0]
- Updated dependencies [24a2b71]
- Updated dependencies [3771f7a]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/game-kit@1.1.17

## 0.1.5

### Patch Changes

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 官方工具插件与游戏支持中英文反馈、帮助和配置标签；提醒增加与中文对应的有限英文时间语法。聊天后台任务记录创建者当时语言，管理员任务记录项目语言，旧任务保持中文；多轮选择与游戏使用开始时语言，保留第三方内容和已生成报告。
- Updated dependencies [18296cf]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [53bc6a0]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
  - @zhin.js/core@1.1.51
  - @zhin.js/game-kit@1.1.16

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
