# Discord Platform Permits

## 入站字段

Guild 频道消息从 `msg.member.permissions` bitfield 解析：

| 字段 | 取值 |
|------|------|
| `$sender.role` | `owner`（`guild.ownerId === author.id`）· `member` |
| `$sender.permissions` | `guild_owner` · `ADMINISTRATOR` · `MANAGE_ROLES` · `MODERATE_MEMBERS` · `MANAGE_CHANNELS` · … |

需 `GuildMembers` intent；缺失时 checker 保守拒绝。

## Permit 词汇表

| `platform-permission:…` | 含义 |
|-----------------------|------|
| `guild_owner` | 服务器主 |
| `moderate_members` | 踢人/禁言 |
| `manage_roles` | 管理身份组 |
| `manage_channels` | 管理频道/线程 |

## 工厂映射

场景治理工具默认要求 `platform:admin` / `platform:owner`（归一地位，ADR 0056 §5）；本适配器把它们映射为下列平台权限：

`platform:admin` → `moderate_members` · `platform:owner` → `guild_owner`
