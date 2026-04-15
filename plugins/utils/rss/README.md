# @zhin.js/plugin-rss

RSS/Atom 订阅推送插件 —— 订阅 feed 源，自动轮询并推送新内容到群聊或私聊。

## 安装

```bash
npm install @zhin.js/plugin-rss
```

## 配置

在 `zhin.config.yml` 中添加：

```yaml
plugins:
  - "@zhin.js/plugin-rss"
rss:
  pollCron: "*/5 * * * *"   # 轮询频率，Cron 表达式（默认每 5 分钟）
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

依赖 Zhin 数据库服务，自动创建两张表：

**rss_subscriptions** — 订阅关系

| 字段 | 类型 | 说明 |
|------|------|------|
| url | text | Feed 地址 |
| feed_title | text | Feed 标题（自动获取） |
| adapter_name | text | 适配器名称 |
| bot_id | text | Bot ID |
| channel_type | text | 会话类型 (group/private) |
| channel_id | text | 会话 ID |

**rss_seen_items** — 已推送条目（去重用）

| 字段 | 类型 | 说明 |
|------|------|------|
| feed_url | text | Feed 地址 |
| item_guid | text | 条目唯一标识 |

## 依赖

- [rss-parser](https://github.com/rbren/rss-parser) — RSS/Atom 解析
- Zhin 内置 `cron` 服务 — 定时轮询
- Zhin 内置 `database` 服务 — 数据持久化

## 许可

MIT
