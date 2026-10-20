# 内容管理（feed）

> **参数定义用 `tencent-channel-cli schema feed.<action>` 查，示例用 `--help` 看。本文档只写 schema 不体现的规则。**

**关键提醒**：发帖/评论/回复涉及 @用户时，必须先查 `tiny_id` 填入 `at_users`，严禁在 content 中手写 `@昵称`（详见 SKILL.md 硬规则）。

## 意图→命令速查

| 意图 | 命令 | 注意 |
|------|------|------|
| 浏览频道主页帖子 | `get-guild-feeds` | **不是** `get-channel-timeline-feeds`；必须传 `get_type` |
| 浏览指定版块帖子 | `get-channel-timeline-feeds` | 需同时传 guild_id + channel_id |
| 帖子详情 | `get-feed-detail` | 自动补取分享短链 |
| 帖子评论 | `get-feed-comments` | 回复预览在 `replies_preview` 字段 |
| 评论回复翻页 | `get-next-page-replies` | 首次 attach_info 从 get-feed-comments 评论对象获取 |
| 搜索帖子 | `search-guild-feeds` | 结果补充频道名称与分享短链 |
| 互动消息 | `get-notices` | 类型: 1=顶帖 2=赞评论 3=赞回复 4=收到评论 5=收到回复 6=被@ |
| 评论帖子 / "回复帖子" | `do-comment` | **禁止**用 do-reply 替代；删除时需 --yes；支持 `--ref` 从通知自动填充 |
| 回复已有评论或回复 | `do-reply` | 需 comment_id，仅用于回复已有评论/回复；删除时需 --yes；支持 `--ref` 从通知自动填充 |
| 发帖 | `publish-feed` | 见「发帖规则」 |
| 删帖 | `del-feed` | 高风险，需 --yes |
| 编辑帖子 / 改帖 | `alter-feed` | 自动补取分享短链 |
| 帖子点赞 / 取消点赞 | `do-feed-prefer` | action: 1=点赞 3=取消 |
| 评论/回复点赞 | `do-like` | like-type: 3=赞评论 4=取消 5=赞回复 6=取消；需 comment_id |
| 精华/置顶 | `set-feed-essence` / `top-feed` | 需管理权限 |
| 推送精华通知 | `push-essence-feed` | 每天限 3 次，每帖仅 1 次，需先加精 |
| 移动帖子到其他版块 | `move-feed` | 需提供原版块 ID 和目标版块 ID |

## 核心规则

### get-guild-feeds

- `get_type` **必须显式传入**，不传或传 0 返回空数据。1=热门 2=最新，不确定时默认 2
- 用户说"全部"/"所有帖子"/"按时间" → `get_type=2`
- **翻页时必须保持相同 get_type**，游标与排序模式绑定
- 返回 retCode `20047` → 如实告知"暂无帖子数据"，不切换其他工具重试

### 发帖规则

1. **确认频道**：有 guild_id + channel_id → 直接发。没有 → **必须先问用户**是指定频道还是全局发帖；选指定频道 → 查 `get-my-join-guild-info` → 选频道 → 查 `get-guild-channel-list` → 排除非帖子类版块，找到「帖子广场」作为默认「全部」版块直接发帖。**严禁**未经确认走全局发帖
2. **全局发帖身份确认**：不传 guild_id/channel_id 时为「作者身份全局发帖」，要求账号具有「作者」角色，普通成员**无法**使用。执行前必须向用户确认其具有作者身份，确认后加 `--yes` 执行；未确认则引导用户传入 guild_id 和 channel_id 以普通成员身份发帖
3. **短贴 vs 长贴**：正文 ≤1000 加权字 → 短贴(feed_type=1)无需标题；>1000 → 长贴(feed_type=2)需标题。用户要求长贴时先索取标题。禁止未提供 title 时擅自用 feed_type=2。**加权字**：中文/中文标点=1字，英文/数字/半角=0.5字
4. **话题标签（#话题）**：仅**短贴**（feed_type=1）支持话题标签。**长贴（feed_type=2）不支持话题标签**。CLI 对长贴传入话题参数（`topic_names` / `--topic-name` / 正文中的 `#[话题]()` 语法）会直接报错拦截
5. **数量限制**：短贴 ≤1000字/≤18图/≤1视频；长贴 ≤10000字/≤50图/≤5视频；评论回复 ≤1图。超限 CLI 直接报错
6. **超限拆分**：严禁自行拆分发布，必须先告知用户 → 提出拆分方案 → 获得确认后执行
7. 正文为纯文本，不渲染 Markdown
8. 成功后自动补取分享短链，展示短链即可，**不返回 feed_id**

### 分享链接

- 帖子**列表**不自动补取短链，需要时调 `get-feed-share-url`
- `get-feed-detail` / `publish-feed` / `alter-feed` 自动补取
- 帖子分享链接用 `get-feed-share-url`，**频道**分享链接用 `get-guild-share-url`

### 链式字段：replies_preview

每条回复含：`reply_id`（删除/回复该回复时用）、`author_id`（回复时传 target_user_id）、`target_reply_id` / `target_user_id`（楼中楼关系）、`create_time_raw`

## 翻页字段速查（命令→字段名）

| 命令 | stdin JSON 字段名 | CLI flag | 注意 |
|------|-------------------|----------|------|
| `get-guild-feeds` | `feed_attach_info` | `--feed-attach-info` | |
| `get-channel-timeline-feeds` | `feed_attch_info`（少个 **a**） | `--feed-attach-info` | stdin JSON 拼写与其他命令不同 |
| `get-feed-comments` | `attach_info` | `--attach-info` | |
| `get-notices` | `attach_info` | `--attach-info` | |
| `get-next-page-replies` | `attach_info` | `--attach-info` | 首次值从 get-feed-comments 评论对象获取 |
| `search-guild-feeds` | `cookie` | `--next-page-cookie` | stdin JSON 字段名与 CLI flag 差异大 |

> **翻页安全规则**：翻页时严格用上次返回的字段名和值原样传回，不要跨命令复用翻页令牌。

### move-feed（移动帖子）

执行前必须向用户确认其在**目标频道**的身份，用户明确确认自己是该频道的 **超级管理员** 或 **频道主** 后，方可继续执行。

## 陷阱（schema 不体现）

| 陷阱 | 说明 |
|------|------|
| 图片/视频路径 | `file_paths`(JSON) 仅传图片，`video_paths`(JSON) 仅传视频，混用导致上传失败（business_type 错误）。推荐 `--image` / `--video`；**短贴**中 `--image` 与 `--video` 互斥，同时传入会被本地拦截；**长贴**（有标题 / feed_type=2）允许图片与视频同时存在 |
| alter-feed 替换媒体 | 默认**保留**原帖所有图片/视频并追加新增内容。要**替换**时必须先清除：`--clear-images` 清除原帖所有图片，`--clear-videos` 清除原帖所有视频；可与 `--image`/`--video` 连用实现"先清后加" |
| alter-feed 帖子类型 | `alter-feed` **不接受** `feed_type` 参数，帖子类型始终从原帖自动继承。不存在"编辑后变成短贴"的风险 |
| images 字段名 | 已有 CDN URL 时用 `images`，每项字段名为 `url`，**不是** `picUrl` |
| 板块置顶 | `top-feed` 的 `top_type=2/3`（板块置顶）时 `channel_id` 必填，需通过 stdin JSON 传入 |
| 删除评论必须 --yes | `do-comment --comment-type 0/2` 为不可逆操作，CLI 强制要求 `--yes`，不传直接报错 |
| 删除回复必须 --yes | `do-reply --reply-type 0/2` 为不可逆操作，CLI 强制要求 `--yes`，不传直接报错 |
| 删除回复必填字段 | 除 reply_id 外还需：`replier_id`、`feed_id`、`feed_author_id`、`feed_create_time`、`comment_id`、`comment_author_id`、`comment_create_time`、`guild_id`、`channel_id` |
| @用户 ID 格式 | `at_users[].id` 必须是 tinyid（通常 >10 位数字），**严禁**传 QQ 号（≤10 位），CLI 会直接报错拦截 |
| alter-feed @用户 | 支持 `--at-user tinyid:昵称` CLI flag（可多次指定），与 publish-feed 一致 |
| 裸 URL 写入正文 | **禁止**在 `content` 里直接拼入裸 URL（如 `https://example.com`）——裸 URL 在帖子里原样显示为纯文本，不可点击。可点击链接必须用内联语法或 `--link` / `urls` 传入 |
| 长贴不支持话题标签 | CLI 在发帖/编辑时如检测到话题参数（`topic_names` / `--topic-name` / `#[话题]()` 语法）会直接报错拦截，请改用短贴或移除话题参数 |

## 内嵌链接与 @ 语法

`publish-feed` / `alter-feed` / `do-comment` / `do-reply` 均支持两种方式混入可点击链接和 @用户，**推荐使用内联语法**，更直观且位置精确。

Windows / PowerShell 推荐写法：

```powershell
$body = @{
  guild_id = "123"
  channel_id = "456"
  content = "本周技术分享已更新，点击查看详情了解更多。"
  urls = @(@{ url = "https://example.com/weekly"; displayText = "查看详情" })
} | ConvertTo-Json -Depth 6 -Compress
$body | tencent-channel-cli feed publish-feed
```

**字段：**
### 内联语法（推荐）

直接在 `--content` / `content` 正文中使用：

| 语法 | 说明 |
|------|------|
| `[显示文字](https://url)` | 可点击超链接，链接出现在正文对应位置 |
| `@[昵称](tinyid)` | @提及用户，@出现在正文对应位置 |

两者可自由混排：

```bash
tencent-channel-cli feed publish-feed \
  --guild-id 123 --channel-id 456 \
  --content "本周技术分享见 [详情页](https://example.com/weekly)，@[张三](144115219800577368) 请查收。"
```

```bash
tencent-channel-cli feed do-comment \
  --feed-id B_xxx --feed-create-time 1700000000 \
  --content "参考 [官方文档](https://docs.example.com) 里的说明，@[李四](144115219800577369) 也看看。"
```

### 独立参数（备选）

需要批量传入、或链接/@ 出现在正文末尾时，也可用单独参数：

| 参数 | 语法 | 适用命令 |
|------|------|---------|
| `--link url\|显示文字` | CLI flag，可多次指定 | 所有写入命令 |
| `--at-user tinyid:昵称` | CLI flag，可多次指定 | 所有写入命令 |
| `urls` (stdin JSON) | `[{"url":"…","displayText":"…"}]` | 所有写入命令 |
| `at_users` (stdin JSON) | `[{"id":"tinyid","nick":"昵称"}]` | 所有写入命令 |

**注意**：独立参数中的链接/@ 被追加在正文**末尾**，位置不可控；如需精确控制位置，用内联语法。

**用户自然语言 → 参数组装规则：**

- 用户说「链接是 X，显示文本是 Y」→ 内联写 `[Y](X)` 放入 content
- 用户说「把 X 做成超链接」→ 内联写 `[X](X)` 或根据上下文取文案
- 用户说「@张三」→ 先查 `tiny_id`，再内联写 `@[张三](tinyid)` 放入 content
- `content` 字段只写正文文字和内联标记，**禁止**把裸 URL 拼入正文

## 自动化运营

以下能力通过组合已有原子命令实现，适合结合定时任务做周期性自动化。

### 内容巡检

扫描频道帖子，AI 判断是否违规，违规则删除。

**推荐路径：**
1. `get-guild-feeds`（get_type=2，最新）或 `get-channel-timeline-feeds` 拉取帖子列表
2. 逐条 `get-feed-detail` 获取完整标题和正文
3. AI 根据内容判断是否违规（水帖、广告、外链、交友、风险等）
4. 对违规帖子调 `del-feed --yes` 删除（高风险，需确认）

**参数建议：**
- 通过 `count` 控制每次扫描数量（建议 20~50）
- 可指定 `channel-id` 限定版块范围
- 定时调度间隔建议 30~60 分钟

### 问答自动回复

扫描频道帖子，识别求助帖，搜索相关内容后自动回复。

**推荐路径：**
1. `get-guild-feeds` 或 `get-channel-timeline-feeds` 拉取帖子列表
2. 逐条 `get-feed-detail` 获取完整内容
3. AI 判断是否为求助帖（含提问意图：问号、"怎么"、"如何"、"求助"等）
4. 对求助帖提取关键词，调 `search-guild-feeds` 搜索频道内相关帖子
5. 整理相关帖子内容生成回复，调 `do-comment` 发布评论
6. 无相关内容时发布礼貌提示

**参数建议：**
- `scan_count` 建议 20，每次处理适量帖子
- 每条回复引用的参考帖子建议 ≤3 条
- 支持 dry_run 模式：先分析不发布，确认后再正式运行
