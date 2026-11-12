# Telegram Platform Permits

## 入站字段

群/超级群消息经 `getChatMember`（TTL 60s）写入：

| 字段 | 取值 |
|------|------|
| `$sender.role` | `creator` · `administrator` · `member` |
| `$sender.permissions` | `chat_creator` · `chat_administrator` · `restrict_members` · `pin_messages` · `manage_chat` · … |

## Permit 词汇表

| `platform-permission:…` | 含义 |
|------------------------|------|
| `chat_creator` | 群主 |
| `chat_administrator` | 管理员 |
| `restrict_members` | 可禁言成员 |
| `pin_messages` | 可置顶 |
| `manage_chat` | 可改群默认权限 |

## 工厂映射

场景治理工具默认要求 `platform:admin` / `platform:owner`（归一地位，ADR 0056 §5）；本适配器把它们映射为下列平台权限：

`platform:admin` → `chat_administrator` · `platform:owner` → `chat_creator`
