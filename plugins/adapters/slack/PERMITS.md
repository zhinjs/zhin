# Slack Platform Permits

## 入站字段

频道消息异步 enrich（`users.info` + `conversations.info`，TTL 60s）：

| 字段 | 来源 |
|------|------|
| `$sender.role` | `owner` · `admin` · `channel_admin` · `member` |
| `$sender.permissions` | `workspace_owner` · `workspace_admin` · `channel_manager` |

`channel_manager`：频道 `creator === user` 或 workspace 管理员。

## Permit 词汇表

| `platform-permission:…` | 含义 |
|---------------------|------|
| `workspace_owner` | Workspace 主 |
| `workspace_admin` | Workspace 管理员 |
| `channel_manager` | 频道管理者 |

## 工厂映射

场景治理工具默认要求 `platform:admin` / `platform:owner`（归一地位，ADR 0056 §5）；本适配器把它们映射为下列平台权限：

`platform:admin` → `channel_manager` · `platform:owner` → `workspace_owner`
