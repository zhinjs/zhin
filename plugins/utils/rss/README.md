# @zhin.js/plugin-rss

RSS/Atom 订阅推送插件 —— 订阅 feed 源，自动轮询并推送新内容到群聊或私聊。

## 安装

```bash
pnpm exec zhin install @zhin.js/plugin-rss
```

## 配置

在应用目录运行安装命令，会安装依赖并挂载到 主配置 `plugins` 映射，实例名为 `rss`。在 `zhin.config.yml` 的实例节点修改配置：

```yaml
configVersion: 2
plugins:
  rss: "@zhin.js/plugin-rss"
rss:
  pollCron: "0 */5 * * * *" # 六段 Cron（秒、分、时、日、月、周），每 5 分钟
  maxPerGroup: 30 # 每个会话最大订阅数（默认 30）
  maxItems: 5 # 单次推送最多展示条数（默认 5）
  timeout: 15000 # 拉取 feed 的超时时间 ms（默认 15s）
```

## 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `rss-add <url>` | 订阅 RSS/Atom 源 | `rss-add https://sspai.com/feed` |
| `rss-remove <url>` | 取消订阅 | `rss-remove https://sspai.com/feed` |
| `rss-list` | 查看当前会话的订阅列表 | `rss-list` |
| `rss-check [url]` | 手动检查更新 | `rss-check` |
| `rss-preview <url>` | 预览 feed 最新内容（不订阅） | `rss-preview https://rsshub.app/bilibili/hot-search` |

订阅管理命令需要真实的 IM 会话来源，不会为无会话调用创建全局订阅。当前支持不含父容器或线程信息的私聊、群聊与频道；当 `conversation.parent` 或 `threadId` 存在时，会明确提示暂不支持该地址，不会丢弃字段后订阅频道本体。

如果旧订阅记录保存了错误的端点或用户身份，系统无法可靠反推出原始会话。`rss-remove` 只删除当前 Bot、当前会话的订阅，不能清理归属不明的旧记录；需由管理员在数据库中核对插件实例和完整订阅字段，备份后按记录精确删除，再在真实会话重新订阅。不要仅凭 URL 或会话 ID 批量删除，以免影响其他 Bot。缺失或非法地址不会通过猜测进行投递；字段齐全但值错误的旧记录不会被自动识别或迁移。

## Console 管理员订阅

在 Console 的任务中心选择对应 RSS 实例的“管理员 RSS 订阅”，填写 RSS / Atom 的 HTTP(S) 地址，并选择精确的账号、会话、父容器和线程后创建。先确认页面所列的抓取与发送影响；地址不接受 URL 用户名或密码。任务保存时不会抓取源站或发送测试消息。

该入口需要持久数据库状态、支持 `sendTarget` 的 Outbound Host 和 Schedule Host 同时可用；缺少其中任一能力时不显示管理员任务 Provider，原有聊天订阅和可选内存模式继续可用。管理员操作经 Console Host 的 full scope Bearer Token 鉴权。

1. 新建后，等待下一次实例 `pollCron` 轮询。**首次成功抓取只建立已读基线，不推送历史文章**；后续新文章才发送到所选目标。
2. 在任务中心暂停订阅后可修改源地址，再恢复；恢复后的首次成功抓取同样只建立新基线，**不补发暂停期间的文章**。
3. 不再需要时取消。暂停或取消不能撤回已经开始的投递。任务状态、操作回执和每条订阅自己的去重游标随数据库持久保存，重启后仍可查看。

管理员订阅使用独立的持久池，没有伪造的聊天发送者，不读取或管理聊天订阅的表与已读记录，也不出现在 `rss-list` 中。`rss-remove`、`rss-check` 和 AI 订阅列表工具仍只处理原有聊天订阅；它们不会取消、检查或触发管理员订阅。管理员订阅可以保留完整父容器和线程，原聊天命令仍遵循上文地址限制。

### 可选静默摘要

每条管理员 RSS 订阅可在任务参数中填写三项：`quietTimezone`（如 `Asia/Shanghai`）、
`quietStart`（如 `22:00`）和 `quietEnd`（如 `08:00`）。三项全部省略或全部留空时关闭静默；
启用时必须全部填写，使用有效 IANA 时区和 `HH:mm` 的 24 小时格式，开始与结束不能相同。
不能用 `+08:00` 代替时区。

静默区间包含开始分钟、不包含结束分钟，也支持跨午夜。每次轮询按当时的当地分钟判断，
不改变实例轮询频率或 Host 调度时区。静默期间仍检查新文章并持久积累；退出静默后的首轮
轮询先发送已积累的摘要，该订阅下一轮再继续抓源。已有摘要的发送不依赖源站此时能否抓取。
如果轮询总落在静默时段，摘要会继续等到首次非静默轮询，不保证在结束时刻精确发送。

摘要仅合并当前 owner、当前订阅与完整目标下的更新，不跨源、账号、父容器或线程合并。
最多保留 **3 条短标题和安全链接**，实际展示还受实例 `maxItems` 限制，不保存文章正文；其余只累计数量并提示查看源站。
计数达到 **10000** 后仍可饱和记录，继续有更新时用“至少 10000 条”展示，不伪称精确总数。
计数沿用最新 20 条抓取窗口与最近 64 个标识的有界去重，不是源站全部文章的永久统计。

暂停会原子清空待发摘要；编辑仍须先暂停，恢复后重新建基线，不补发之前积累或暂停期间的内容。
取消同样清空待发内容，不能撤回已开始的 I/O。摘要在发送前持久领取；结果不明、进程中断或
确认无法保存时停止自动投递，不重试或自动恢复，可能需要到目标核实后取消并另建订阅。
未启用的管理员订阅、聊天创建的订阅以及定时提醒保持原行为。

状态表示实际已知的调度或投递事实：

| 状态 | 含义和可用操作 |
| --- | --- |
| 待轮询 | 等待建立基线或检查新文章；可暂停、取消。源站抓取失败尚未发生发送，会在下轮重查 |
| 已暂停 | 不再抓取；可编辑源地址、恢复或取消 |
| 投递中或未确认 | 发送前已经持久登记；没有确认消息 ID、结果不明或进程中断时均不自动重试，只能取消。先到目标会话核实，确需继续时另建订阅 |
| 失败 | 平台明确未投递或拒绝，订阅已停止；核查原因后另建 |
| 已取消 | 不再触发后续轮询 |

“待轮询”不证明账号在线或目标可发送；源站抓取成功也不等于平台投递成功。轮询遵循 Host 的实际调度时区，不猜测用户时区，不生成没有依据的“下次执行时间”。

每实例最多保存 **8 条管理员任务**。取消或失败的历史任务可在新建时被整理；未确认投递仍占配额，不能自动丢弃。最近 **32 条操作回执**用于响应丢失后的对账，完整状态上限 **60 KiB**；静默订阅会预留有界摘要、去重游标和投递登记空间，实际数量也受此限制。空间不足时先拒绝创建或变更，不覆盖已有任务，也不先推进游标再丢掉待发摘要。

每轮只检查 feed 返回顺序中的前 **20 条**，通常是源的最新内容，不翻页追溯更早文章；一次轮询间隔内更新超过这个窗口时，窗口外文章不会被补抓。首次和暂停恢复后的成功抓取，只把当轮窗口建立为基线，不发送历史。后续若当轮识别出 8 条新文章、`maxItems: 5`，只发送前 5 条明细，并附“还有 3 条，请查看源站”；8 条都会进入已检查游标，另外 3 条不会在下一轮继续补发。

每条订阅保留最近 **64 个条目标识摘要**；长期移除后重新出现在源中的文章可能再次视为新内容。这些有界游标不提供永久归档或任意断线时长的无遗漏保证。

管理员状态保存在当前插件 owner 的 `admin-rss/v1` 键，与聊天 SQL 表无需迁移。新版本只读兼容内部 v1 格式，首次实际变更或轮询后在同一键写为内部 v2，保留旧游标和操作确认。旧程序无法读取 v2，会保留数据并停止管理员操作，而不会忽略静默策略后立即推送；回滚前应备份并核对版本。格式损坏时同样停止管理员状态操作和投递，不自动清空或当作空订阅继续执行。

## 工作原理

以下说明适用于聊天命令创建的订阅；管理员订阅的基线和逐任务游标见上一节。

1. `rss-add` 时验证 feed 可达性，记录订阅关系和当前会话（适配器、Bot、群/私聊）
2. 订阅成功后标记所有已有条目为"已读"，避免立即推送历史内容
3. Cron 定时任务按配置的频率轮询所有已订阅的 feed
4. 通过 `item.guid` 去重，只推送新增条目
5. 同一 feed 被多个会话订阅时，只拉取一次，分别推送
6. 每日凌晨 4 点清理 7 天前的已读记录，防止数据膨胀

## 推荐 RSS 源

搭配 [RSSHub](https://docs.rsshub.app/) 可订阅几乎任何网站的更新：

| 源 | URL |
|----|-----|
| 少数派 | `https://sspai.com/feed` |
| GitHub Trending | `https://rsshub.app/github/trending/daily` |
| Bilibili 热搜 | `https://rsshub.app/bilibili/hot-search` |
| 微博热搜 | `https://rsshub.app/weibo/search/hot` |
| Hacker News | `https://hnrss.org/frontpage` |

## AI 工具

| 工具名 | 说明 |
|--------|------|
| `rss_list_subscriptions` | 查询所有 RSS 订阅概览 |
| `rss_preview_feed` | 预览指定 URL 的 feed 内容 |

## 数据库

有 `databaseHostToken` 时自动创建以下两张表，并按插件实例隔离表名；未配置数据库时使用实例内存存储，重启后不会保留订阅。正式使用应配置持久数据库：

**rss_subscriptions** — 订阅关系

| 字段 | 类型 | 说明 |
|------|------|------|
| url | text | Feed 地址 |
| feed_title | text | Feed 标题（自动获取） |
| adapter_name | text | 适配器名称 |
| endpoint_id | text | Endpoint ID |
| channel_type | text | 会话类型 (group/private/channel) |
| channel_id | text | 会话 ID |
| creator_id | text | 订阅创建者 ID |
| creator_name | text | 订阅创建者名称 |
| created_at | text | 订阅创建时间（ISO 字符串） |

**rss_seen_items** — 已推送条目（去重用）

| 字段 | 类型 | 说明 |
|------|------|------|
| feed_url | text | Feed 地址 |
| item_guid | text | 条目唯一标识 |
| item_title | text | 条目标题 |
| seen_at | text | 已读时间（ISO 字符串，用于过期清理） |

## 依赖

- [rss-parser](https://github.com/rbren/rss-parser) — RSS/Atom 解析
- Runtime `scheduleHostToken` — 定时轮询；未提供时只能手动检查
- Runtime `databaseHostToken` — 数据持久化；未提供时退回内存存储
- Runtime `outboundHostToken` — 新内容推送到原订阅会话

## 许可

MIT

### 事务化任务存储

提醒与管理员 RSS 的任务、认领、操作回执和文章明细使用独立数据表，在一个事务中提交；原 CAS JSON 只用于首次迁移。支持 SQLite、MySQL、PostgreSQL，升级须完整重启，不能与旧版本进程混写。`unknown` 投递仍不会自动重试。迁移和字段说明见[结构化存储](../../../docs/operations/structured-storage.md)。

## Language / 语言

命令和工具的提示使用当前操作语言，源站文章标题和正文保持原样。聊天订阅保存创建者当时的语言；管理员订阅保存项目语言。轮询按每个订阅保存的语言生成通知或静默摘要，更改个人／项目语言不会重写既有订阅；暂停、恢复和进程重启仍保持原语言。旧数据没有语言字段时保持中文。

Console 的界面语言仅影响任务列表、字段说明和操作错误；不参与 requestId 指纹，不改变任务版本或通知语言。新状态使用独立文案 key 展示，旧的文字 detail 原样保留。

Notifications use the language captured at subscription creation. Feed content remains in its original language. Changing Console language changes presentation only, including idempotent responses; it does not change delivery settings or repeat an operation.
