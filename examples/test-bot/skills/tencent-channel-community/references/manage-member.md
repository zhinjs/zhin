# 成员管理（manage-member）

> **参数用 `tencent-channel-cli schema manage.<action>` 查，示例用 `--help` 看。本文档只写 schema 不体现的规则。**

## 意图→命令速查

| 意图 | 命令 | 注意 |
|------|------|------|
| 成员列表 / 找管理员 / 查机器人 | `get-guild-member-list` | 返回 owners / admins / robots / members 四类，自动去重 |
| 按昵称搜成员 / 查 tiny_id | `guild-member-search` | **优先用这个**，比翻页遍历快 |
| 个人资料 | `get-user-info` | 见参数组合 |
| 禁言/解禁 | `modify-member-shut-up` | time_stamp=0 解禁，见陷阱 |
| 踢成员 | `kick-guild-member` | 高风险，需 --yes |
| 设置/移除管理员 | `add-admin` / `remove-admin` | 支持批量 tiny_ids；remove 高风险 |
| **频道类任务** | **→ manage-guild.md** | |
| **帖子类任务** | **→ feed-reference.md** | |

### 分流误区

- 只是找某人的 tiny_id → **优先** `guild-member-search`，不要翻页遍历成员列表
- `get-user-info` 查个人资料，`get-guild-member-list` 查频道成员列表，别混淆

## get-user-info 参数组合

| 传参 | 效果 |
|------|------|
| `{}` | 查自己全局资料 |
| `{guild_id}` | 查自己在频道内资料 |
| `{guild_id, tiny_id}` | 查他人在频道内资料 |

> `isGuildAuthor` = 频道创作者，**不是**帖子发布人也**不是**频道主

## 时间戳展示

原始秒级字段（如 `joinTime`、`shutupExpireTime`）自动附带 `{字段名}_human` 可读值，向用户展示 `_human` 字段，不展示原始时间戳。禁言时间戳为 `0` 时显示"无禁言"。

## 陷阱（schema 不体现）

| 陷阱 | 说明 |
|------|------|
| 禁言 time_stamp | 必须传**绝对 Unix 时间戳**（当前时间 + 时长秒数），不是时长。`0` = 立即解禁 |
| 批量踢人 | `tiny_id`（单个）和 `member_tinyids`（⚡JSON 批量）二选一 |
| 成员搜索翻页 | `--next-pos` 原样传回上一页返回值 |
| 成员列表翻页 | `next_page_token` 不透明令牌，必须原样传回 |
