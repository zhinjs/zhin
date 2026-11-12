# KOOK Platform Permits

## 入站字段

| 字段 | 来源 | 取值 |
|------|------|------|
| `$sender.role` | `permission` / `isAdmin` / `isGuildOwner` | `owner` · `admin` · `channel_admin` · `member` |
| `$sender.permissions` | 归一化 + `roles[]` | `guild_owner` · `guild_admin` · `channel_admin` · `manage_roles` · `role:{id}` |

KOOK `permission`：1=成员，2=管理员，4=频道主，5=频道管理员（子频道场景为 `channel_admin`）。

## Permit 词汇表

| `platform-permission:…` | 含义 |
|--------------------|------|
| `guild_owner` | 服务器主 |
| `guild_admin` | 服务器/频道管理员 |
| `channel_admin` | 子频道管理员 |
| `manage_roles` | 可管理身份组 |

## 工厂映射

场景治理工具默认要求 `platform:admin` / `platform:owner`（归一地位，ADR 0056 §5）；本适配器把它们映射为下列平台权限：

`platform:admin` → `guild_admin` · `platform:owner` → `guild_owner`
