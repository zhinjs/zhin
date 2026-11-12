# 飞书 Lark Platform Permits

## 入站字段（ADR 0056 §1）

群聊消息经 `chat.get`（按群缓存 60s）比对 `owner_id` / `user_manager_id_list`：

| 字段 | 取值 |
|------|------|
| `sender.platform.standing` | `owner` · `admin` · `member` |

`chat.get` 失败时地位未知（不上报，负缓存 10s）；未返回 `owner_id`（如群主是机器人应用）时只能确认管理员，其余发送者未知。飞书群没有原生角色与权限位。机器人自身：群主为本应用 → `owner`，在 `bot_manager_id_list` → `admin`，有 `owner_id` 且都不是 → `member`，否则未知。

## Permit 词汇表

| Permit | 含义 |
|--------|------|
| `platform:owner` / `platform:admin` | 群主 / 群管理员（含群主） |
| `bot:owner` / `bot:admin` | 同上，判定机器人应用自身 |

平台身份与机器人身份都按**当前会话**判定，因此群管理工具只作用于当前群（不接受 `chat_id` 入参）。
