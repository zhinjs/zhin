# 钉钉 DingTalk Platform Permits

## 入站字段

| 字段 | 来源 |
|------|------|
| `$sender.role` | `isAdmin` → `admin`；`owner` 需业务侧创建群时指定 |
| `$sender.permissions` | `chat_owner` · `chat_admin` |

## Permit 词汇表

| `platform(dingtalk,…)` | 含义 |
|------------------------|------|
| `chat_owner` | 群主（创建群等） |
| `chat_admin` | 群管理员 |

## 工厂映射

`group_admin` → `chat_admin` · `group_owner` → `chat_owner`
