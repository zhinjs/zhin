---
"@zhin.js/im-contract": patch
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"@zhin.js/feature-kit": patch
"@zhin.js/command": patch
"@zhin.js/permission": patch
"@zhin.js/agent": patch
"zhin.js": patch
"@zhin.js/testing": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-roulette": patch
---

平台身份归一（ADR 0056 §1）：`@zhin.js/im-contract` 新增 `PlatformStanding`（`standing` 为 `owner` / `admin` / `member` / `guest`，可选平台原生 `roles` 与 `permissions`）及 `normalizePlatformStanding`，入站消息的发送者身份挂在 `sender.platform` 上；能力画像新增 `scene.platformStanding`，声明适配器上报其中哪些字段。适配器不再能通过 `sender.roles` 上报身份：入站时框架只保留发送者的 `id`、`name` 与校验后的 `platform`，`sender.roles` 只含框架角色（主人 / 信任）。权限检查（`scene_admin` / `scene_owner`、`role(admin)` 等）、群规豁免、内容审核豁免、发言门控、参与者标签与聊天角色映射改为读 `sender.platform.standing`，不再读取元数据里的 `senderRole` / `role` / `roles` / `senderPermissions`；`OperationSession.sender.platformRoles` 改为 `platform`，群规违规上报的 `memberRoles` 改为 `memberStanding`。
