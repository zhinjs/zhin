# 企业微信 WeCom Platform Permits

## 入站字段

| 字段 | 来源 |
|------|------|
| `$sender.role` | 默认 `member`；需业务侧扩展企业微信可见性/管理权限 |
| `$sender.permissions` | `chat_owner` · `chat_admin` |

## Permit 词汇表

| `platform(wecom,…)` | 含义 |
|---------------------|------|
| `chat_owner` | 群主 |
| `chat_admin` | 群管理员 |

## 工厂映射

`scene_admin` → `chat_admin` · `scene_owner` → `chat_owner`
