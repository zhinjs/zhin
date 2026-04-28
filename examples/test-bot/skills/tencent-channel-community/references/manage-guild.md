# 频道管理（manage-guild）

> **参数用 `tencent-channel-cli schema manage.<action>` 查，示例用 `--help` 看。本文档只写 schema 不体现的规则。**

## 意图→命令速查

| 意图 | 命令 | 注意 |
|------|------|------|
| 我的频道列表 / 列出频道 / 查看已加入的频道 | `get-my-join-guild-info` | 返回三类：created / managed / joined（列表级摘要） |
| 频道详情 / 频道详细信息 / 频道资料 / 成员数 / 公告 | `get-guild-info` | 返回成员数、公告、设置等详情；缺 guild_id → 先 `get-my-join-guild-info` 定位 |
| 子版块列表 | `get-guild-channel-list` | 只查版块，不查帖子 |
| 跨频道搜索频道/帖子/作者 | `search-guild-content` | scope: channel(默认) / feed / author / all；搜帖子用 scope=feed，频道内搜帖子用 feed 域 `search-guild-feeds` |
| 频道分享链接 | `get-guild-share-url` | 仅频道链接，帖子链接用 feed 域 |
| 解析分享链接 | `get-share-info` | 仅限 pd.qq.com 域名链接 |
| 加入频道 | `join-guild` | 内部自动预检，见下文 |
| 修改头像 | `upload-guild-avatar` | 需本地图片路径 |
| 修改名称/简介 | `update-guild-info` | 可只改其一 |
| 修改频道号 | `modify-guild-number` | 10~14 位英文/数字，需频道主权限；别和 `guild_id` 混淆 |
| 创建频道 | `create-theme-private-guild` | 未指定私密则默认公开 |
| 创建/删除/修改版块 | `create-channel` / `delete-channel` / `modify-channel` | delete 不可逆，高风险 |
| 查看加入设置 | `get-join-guild-setting` | 返回加入方式类型及验证问题 |
| 修改加入设置 | `update-join-guild-setting` | 6 种加入方式，高级类型需 stdin JSON |
| 发送频道私信 | `push-group-dm-msg` | 对方未回复前只能发 1 条 |
| 退出频道 | `leave-guild` | 不可逆，高风险，需 --yes |
| **帖子类任务** | **→ feed-reference.md** | |
| **成员类任务** | **→ manage-member.md** | |

### 分流误区

- "看频道有哪些帖子" → **feed-reference.md**，不是 manage
- "查成员/禁言/踢人" → **manage-member.md**
- "找频道"区分：搜未知频道 → `search-guild-content`，查已加入 → `get-my-join-guild-info`
- **帖子搜索**区分：跨频道全局搜索帖子 → `search-guild-content scope=feed`；已知频道内搜索帖子 → feed 域 `search-guild-feeds`
- **频道列表 vs 频道详情**：「列出我的频道」「我加入了哪些频道」→ `get-my-join-guild-info`（只返回名称、ID 等摘要）；「查看某个频道的详细信息」「频道有多少成员」「频道公告是什么」→ 先定位 guild_id 再调 `get-guild-info`（返回成员数、公告、设置等完整详情）。**拿到列表后不要停下来**，如果用户意图是看详情，必须继续调 `get-guild-info`

## 频道创建规则

- `community_type`：`public`（默认）或 `private`，仅用户明确要求时传 `private`
- 频道名称 ≤15 字；公开频道仅中英数，私密无限制；简介 ≤300 字符
- 需 `theme` 或 `guild_name` 至少其一
- 补取分享链接失败不回滚频道，在返回中给出告警

## 加入频道规则

`join-guild` 内部自动预检加入设置，**无需**手动分两步。

| JoinGuildType | 含义 | AI 行为 |
|---------------|------|---------|
| 1 (DIRECT) | 直接加入 | 自动完成 |
| 2 (ADMIN_AUDIT) | 管理员验证 | 返回 `need_verification` → 向用户收集附言 `join_guild_comment` → 再次调用 |
| 3 (DISABLE) | 不允许 | 报错 |
| 4/5 (QUESTION*) | 回答问题 | 返回问题 → 收集答案填入 `join_guild_comment` → 再次调用 |
| 6 (MULTI_QUESTION) | 多题 | 返回问题列表 → 收集 `join_guild_answers`(⚡JSON) → 再次调用 |
| 7 (QUIZ) | 测试题 | 返回选择题 → 收集 `join_guild_answers`(⚡JSON) → 再次调用 |

> **收到 `need_verification` 必须先展示问题给用户、收集答案后才能再次调用。禁止自行编造答案。**

## 查询规则

- `get-my-join-guild-info` 返回 `created_guilds` / `managed_guilds` / `joined_guilds` 三类，用户说"我的频道"展示全部；前 10 个自动补取分享短链
- `search-guild-content` 的 `author` scope 搜的是「频道创作者」，**不是**帖子发布人也**不是**频道主；搜频道结果 ≤10 自动补取资料和短链

## 加入设置规则

### get-join-guild-setting

返回频道当前的加入方式（`joinType`）及对应验证问题/答题配置。可用于 `join-guild` 前判断需要提供哪些验证信息。

### update-join-guild-setting

修改频道加入方式，需频道主/管理员权限。

| join-type 枚举 | 含义 | 是否需要 stdin JSON |
|---------------|------|-------------------|
| `JOIN_GUILD_TYPE_DIRECT` | 无需审核，直接加入 | 否，CLI flag 即可 |
| `JOIN_GUILD_TYPE_ADMIN_AUDIT` | 发送验证消息，管理员审核 | 否 |
| `JOIN_GUILD_TYPE_DISABLE` | 不允许任何人加入 | 否 |
| `JOIN_GUILD_TYPE_QUESTION_WITH_ADMIN_AUDIT` | 回答问题 + 管理员审核 | 是，需 `setting.question.items` |
| `JOIN_GUILD_TYPE_MULTI_QUESTION` | 正确回答问题 | 是，需 `setting.question.items`（含 answer） |
| `JOIN_GUILD_TYPE_QUIZ` | 答题（选择题） | 是，需 `setting.quiz` 完整结构 |

> 高级类型（后三种）必须通过 stdin JSON 传入完整 `setting` 对象，CLI flag 仅支持前三种基础类型。

Windows / PowerShell 推荐写法：

```powershell
$body = @{
  guild_id = "123456"
  join_type = "JOIN_GUILD_TYPE_MULTI_QUESTION"
  setting = @{
    question = @{
      items = @(
        @{ title = "问题1"; answer = "A" },
        @{ title = "问题2"; answer = "B" }
      )
    }
  }
} | ConvertTo-Json -Depth 8 -Compress
$body | tencent-channel-cli manage update-join-guild-setting
```

## 频道私信规则

`push-group-dm-msg` 发送普通私信消息到指定用户。支持两种模式：

**⚠️ 模式选择决策规则（必须遵守）：**
- 用户**引用了一条私信通知**并说"回复私信" → 使用**模式 2**（`--ref`）
- 用户说"给某人发私信"/"发私信给某人"（**没有引用私信通知**） → 使用**模式 1**（先查 `tiny_id`，再直接发送）
- **严禁**在主动发私信场景使用 `--ref`，`--ref` 仅用于回复已收到的私信通知

**模式 1：直接发送（主动发私信）**
1. 先通过 `guild-member-search` 或 `get-guild-member-list` 查到目标用户的 `tiny_id`
2. 确定来源频道的 `guild_id`（即你和目标用户共同所在的频道）
3. 调用：`tencent-channel-cli manage push-group-dm-msg --peer-tiny-id <tiny_id> --source-guild-id <guild_id> --text "内容" --json`

**模式 2：回复私信通知（通过 --ref 自动填充）**
- `ref`：通知编号（如 #1），CLI 自动从本地通知记录查找私信会话信息，并通过消息漫游获取对方 tinyId 和 sourceGuildId
- 调用：`tencent-channel-cli manage push-group-dm-msg --ref <编号> --text "内容" --json`

- **限制**：对方未回复之前只能发送 1 条消息（retCode `100707`）
- **严禁**在未获取用户同意的情况下批量发送私信

## 退出频道规则

`leave-guild` 退出指定频道，**不可逆**操作。退出后需要重新加入，且如果频道有验证设置，需重新通过验证。高风险操作，需 `--yes` 确认。

## 陷阱（schema 不体现）

- **频道号 ≠ guild_id**：用户可见的频道号（如 `pd20589127`）是展示层标识，不能当作 `guild_id` 使用。获取真实 guild_id 的方式：通过 `get-share-info` 解析分享链接，或从 `get-my-join-guild-info` 返回中提取。修改频道号用 `modify-guild-number --guild-id <ID> --guild-number <新频道号>`（10~14 位英文/数字）
- `get-share-info` 仅限 `pd.qq.com` 域名链接
- `join-guild` 的 `join_guild_answers` 和 `join_guild_comment` 仅 stdin JSON 可传
- `push-group-dm-msg` 的 `source-guild-id` 不是目标用户所在频道，而是发送者所在的来源频道
- `update-join-guild-setting` 高级类型未传 `setting` 对象会直接报错
- Windows / PowerShell 下不要直接照抄 bash 的 `echo '{...}' | ...`；复杂对象优先用 `ConvertTo-Json`
