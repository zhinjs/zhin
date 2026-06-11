# QQ 官方频道 Platform Permits

> 与 QQ 群 `group_*` **分开命名**，仅用于 guild/channel 场景。

## 入站字段

`message_type === guild` 时 `getGuildMember` + `getGuildInfo`（TTL 60s）：

| 字段 | 取值 |
|------|------|
| `$sender.role` | `owner` · `admin` · `member` |
| `$sender.permissions` | `guild_owner` · `guild_admin` · `manage_roles` · `manage_channels` · 角色 ID |

## Permit 词汇表

| `platform(qq,…)` | 含义 |
|------------------|------|
| `guild_owner` | 频道主 |
| `guild_admin` | 频道管理员 |
| `manage_roles` | 管理身份组 |
| `manage_channels` | 管理子频道 |

## 工厂映射

`group_admin` → `guild_admin` · `group_owner` → `guild_owner`
