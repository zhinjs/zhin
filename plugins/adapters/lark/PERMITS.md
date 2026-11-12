# 飞书 Lark Platform Permits

## 入站字段

群聊消息经 `getChatInfo`（TTL 60s）比对 `owner_id` / `user_manager_id_list`：

| 字段 | 取值 |
|------|------|
| `$sender.role` | `owner` · `admin` · `member` |
| `$sender.permissions` | `chat_owner` · `chat_admin` · `manage_managers` |

## Permit 词汇表

| `platform-permission:…` | 含义 |
|--------------------|------|
| `chat_owner` | 群主 |
| `chat_admin` | 群管理员 |
| `manage_managers` | 可设/撤管理员 |

## 工厂映射

场景治理工具默认要求 `platform:admin` / `platform:owner`（归一地位，ADR 0056 §5）；本适配器把它们映射为下列平台权限：

`platform:admin` → `chat_admin` · `platform:owner` → `chat_owner`
