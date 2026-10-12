# @zhin.js/plugin-rss

RSS/Atom 订阅推送插件 —— 订阅 feed 源，自动轮询并推送新内容到群聊或私聊。

## 安装

```bash
pnpm exec zhin install @zhin.js/plugin-rss
```

## 配置

在应用目录运行安装命令，会安装依赖并挂载到 `package.json#zhin.plugins`，实例名为 `rss`。在 `zhin.config.yml` 的实例节点修改配置：

```yaml
plugins:
  rss:
    pollCron: "0 */5 * * * *" # 六段 Cron（秒、分、时、日、月、周），每 5 分钟
    maxPerGroup: 30            # 每个会话最大订阅数（默认 30）
    maxItems: 5                # 单次推送最多展示条数（默认 5）
    timeout: 15000             # 拉取 feed 的超时时间 ms（默认 15s）
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

## 工作原理

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

**rss_seen_items** — 已推送条目（去重用）

| 字段 | 类型 | 说明 |
|------|------|------|
| feed_url | text | Feed 地址 |
| item_guid | text | 条目唯一标识 |

## 依赖

- [rss-parser](https://github.com/rbren/rss-parser) — RSS/Atom 解析
- Runtime `scheduleHostToken` — 定时轮询；未提供时只能手动检查
- Runtime `databaseHostToken` — 数据持久化；未提供时退回内存存储
- Runtime `outboundHostToken` — 新内容推送到原订阅会话

## 许可

MIT
