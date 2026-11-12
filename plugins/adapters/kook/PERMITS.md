# KOOK Platform Permits

## 入站字段（ADR 0056 §1）

按服务器缓存 `guild/view`（服务器主）与 `guild-role/list`（角色名与权限位，TTL 60s）：

| 字段 | 取值 |
|------|------|
| `sender.platform.standing` | `owner`（服务器主）· `admin`（持有「管理员」位的角色）· `member`；无法判断时不上报 |
| `sender.platform.roles` | 发送者持有的服务器角色（id + 名称） |
| `sender.platform.permissions` | 「全体成员」（role_id 0）与所持角色权限位的并集（snake_case，如 `kick_members`、`manage_roles`）；服务器主与管理员展开为全部权限 |

机器人自身身份（`/v3/user/view` self 的角色）按同一规则计算。

## Permit 词汇表

| Permit | 含义 |
|--------|------|
| `platform:owner` / `platform:admin` | 服务器主 / 管理员（含服务器主） |
| `platform-permission:<name>` | KOOK 权限名，如 `manage_roles`、`ban_members`、`kick_members` |
| `bot:*` / `bot-permission:<name>` | 同上，判定机器人账号自身 |

平台身份与机器人身份都按**当前会话**判定，因此服务器管理工具只作用于当前服务器（不接受 `guild_id` 入参）。
