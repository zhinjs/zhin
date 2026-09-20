# Slack Platform Permits

## 入站字段

频道消息异步 enrich（`users.info` + `conversations.info`，TTL 60s）：

| 字段 | 来源 |
|------|------|
| `$sender.role` | `owner` · `admin` · `channel_admin` · `member` |
| `$sender.permissions` | `workspace_owner` · `workspace_admin` · `channel_manager` |

`channel_manager`：频道 `creator === user` 或 workspace 管理员。

## Permit 词汇表

| `platform(slack,…)` | 含义 |
|---------------------|------|
| `workspace_owner` | Workspace 主 |
| `workspace_admin` | Workspace 管理员 |
| `channel_manager` | 频道管理者 |

## 工厂映射

`scene_admin` → `channel_manager` · `scene_owner` → `workspace_owner`
