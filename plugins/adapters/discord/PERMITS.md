# Discord Platform Permits

## 入站字段（ADR 0056 §1）

| 字段 | 取值 |
|------|------|
| `sender.platform.standing` | `owner`（服务器主）· `admin`（`administrator` / `moderate_members`）· `member` |
| `sender.platform.roles` | 发送者的服务器身份组（不含 `@everyone`） |
| `sender.platform.permissions` | **服务器级**权限名（snake_case，如 `manage_roles`、`ban_members`） |

权限口径统一为服务器级：

- Gateway 模式：发送者与机器人自身都读 `GuildMember.permissions`（不含频道覆盖）。
- Interactions 模式：交互只带频道级位域（已叠加频道覆盖），因此只上报不能被频道覆盖的权限（`administrator`、`kick_members`、`ban_members`、`manage_guild`、`moderate_members`、`manage_nicknames` …），管理员上报全部权限；`manage_roles`、`manage_channels` 等在此模式下不上报。机器人自身身份取自该服务器最近一次交互的 `app_permissions`（同样口径，10 分钟内有效），否则未知。

## Permit 词汇表

| Permit | 含义 |
|--------|------|
| `platform:owner` / `platform:admin` | 服务器主 / 管理员（含服务器主） |
| `platform-permission:<name>` | 服务器级权限，如 `manage_roles`、`manage_channels`、`moderate_members` |
| `bot:*` / `bot-permission:<name>` | 同上，判定机器人账号自身 |

平台身份与机器人身份都按**当前会话**判定，因此服务器管理工具只作用于当前服务器 / 频道（不接受 `guild_id` / `channel_id` 入参）。`discord_add_role` / `discord_remove_role` 另外要求目标身份组低于发起者的最高身份组（服务器主豁免）。

不带平台 permit 的工具同样只作用于当前会话：`discord_react` / `discord_send_embed` 作用于当前频道（线程内为该线程，私信为该私信）；`discord_forum_post` 只在论坛帖子里可用，在该帖子所属的论坛中发新帖（不接受 `channel_id`）。
