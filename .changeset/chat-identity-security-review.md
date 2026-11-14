---
"zhin.js": patch
"@zhin.js/console-protocol": patch
"@zhin.js/gateway": patch
---

聊天身份安全复核（ADR 0060）：链接一个人等于拿到这个人的全局授予，因此凡是建立或扩大链接的路径，只要目标人持有角色，就必须由全局 `iam.manage` 持有者完成。

- **绑定码**：
  - Console 用户未链接、而身份所属的人持有角色时，非全局 `iam.manage` 生成的码不再建立链接（`needs-admin`）。
  - 机器人回复写明码来自哪个 Console 账号。
  - 码在兑换时复核创建者当前的全局 `iam.manage`；网关发出任何 `principal-revoked` 时作废该用户未用的码。网关在自定义角色的权限被修改或角色被删除时，也会通知持有该角色的用户。
- **`chat-identities.simulated.ensure`**：调用者链接的人持有全局角色时需要全局 `iam.manage`，否则拒绝（403）。
- **`ai.personalPrincipals`**：永不自动链接到持有角色的人；首次导入之后新增或修改的条目进入「需要你处理」，经 `chat-roles.imports.resolve` 导入或忽略。`chat-roles.imports.list` 新增 `personalPending`。
- **认领码**：
  - 日志只记哈希前缀，码只由 `zhin status` 给出。
  - 同一发送者 10 分钟内最多计 2 次错误，之后拒绝且不计数，不能反复让码轮换。
- **归并**：任一方带 Console 链接时需要全局 `iam.manage`。
- **非全局管理者**：看不到链接、暗示链接的 `linkMethod`、指向 Console 用户的 `createdBy` 与从链接得出的授予者名。
- **`chat-principals.import`**：导入的授予记为导入者授予，忽略文件里的 `grantedBy`。
