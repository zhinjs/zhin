# 钉钉 DingTalk Platform Permits

## 入站字段（ADR 0056 §1）

| 字段 | 取值 |
|------|------|
| `sender.platform.standing` | 群聊回调 `isAdmin` → `admin`，否则 `member`；单聊不上报 |

钉钉回调不区分群主，也不提供原生角色与权限位；机器人自身身份不上报（`bot:*` 不满足）。

## Permit 词汇表

| Permit | 含义 |
|--------|------|
| `platform:admin` | 群管理员 |

平台身份按**当前会话**判定，只能为当前群的操作作保。钉钉群管理接口使用旧版 `chatid`（与回调中的会话 ID 不同，无法由当前会话推出），因此：

| 工具 | Permit |
|------|--------|
| `dingtalk_add_chat_members` · `dingtalk_update_chat`（指定 `chat_id`，可跨群） | zhin `owner` |
| `dingtalk_create_chat`（新建群，不依赖任何群内身份） | zhin `trusted`（`admin` / `owner` 亦满足） |
