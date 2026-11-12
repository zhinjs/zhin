# 钉钉 DingTalk Platform Permits

## 入站字段

| 字段 | 来源 |
|------|------|
| `$sender.role` | `isAdmin` → `admin`；`owner` 需业务侧创建群时指定 |
| `$sender.permissions` | `chat_owner` · `chat_admin` |

## Permit 词汇表

| `platform-permission:…` | 含义 |
|------------------------|------|
| `chat_owner` | 群主（创建群等） |
| `chat_admin` | 群管理员 |

## 工厂映射

场景治理工具默认要求 `platform:admin` / `platform:owner`（归一地位，ADR 0056 §5）；本适配器把它们映射为下列平台权限：

`platform:admin` → `chat_admin` · `platform:owner` → `chat_owner`
