# Slack Platform Permits

## 入站字段（ADR 0056 §1）

Slack 适配器不上报 `sender.platform`，也不声明 `scene.platformStanding` / `scene.selfStanding`：Workspace 管理员身份需逐用户调用 `users.info`，「频道管理者」没有标准 Web API 可查。因此 `platform:*` 与 `bot:*` permit 在 Slack 会话中都不满足。

## 工具门禁

频道管理工具改用 zhin 角色，并且只作用于当前频道（不接受频道 ID 入参）：

| 工具 | Permit |
|------|--------|
| `slack_set_topic` · `slack_set_purpose` · `slack_invite_to_channel` · `slack_pin_message` · `slack_unpin_message` | `admin` |
| `slack_archive_channel` | `owner` |
| `slack_unarchive`（归档频道内无法对话，需指定频道 ID，可跨频道） | `owner@global` |

消息工具 `slack_add_reaction` / `slack_remove_reaction` / `slack_edit_message` 只作用于当前频道或私信（不接受频道 ID 入参）。
