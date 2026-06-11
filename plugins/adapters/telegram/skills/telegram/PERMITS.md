# Telegram Platform Permits

## 入站字段

群/超级群消息经 `getChatMember`（TTL 60s）写入：

| 字段 | 取值 |
|------|------|
| `$sender.role` | `creator` · `administrator` · `member` |
| `$sender.permissions` | `chat_creator` · `chat_administrator` · `restrict_members` · `pin_messages` · `manage_chat` · … |

## Permit 词汇表

| `platform(telegram,…)` | 含义 |
|------------------------|------|
| `chat_creator` | 群主 |
| `chat_administrator` | 管理员 |
| `restrict_members` | 可禁言成员 |
| `pin_messages` | 可置顶 |
| `manage_chat` | 可改群默认权限 |

## 工厂映射

`group_admin` → `chat_administrator` · `group_owner` → `chat_creator`
