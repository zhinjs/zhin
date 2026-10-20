# @zhin.js/plugin-bilibili

订阅 B 站（哔哩哔哩）UP 主的**开播提醒**和**新动态**，推送到订阅所在的私聊、群聊或频道。与平台无关：任何接入了 OutboundHost 的适配器都可以用。

Subscribe to Bilibili live starts and UP dynamics per conversation. Platform-agnostic: works with any adapter that exposes the OutboundHost. English below.

## 安装

```bash
pnpm exec zhin install @zhin.js/plugin-bilibili
```

对应的 `zhin.config.yml`：

```yaml
configVersion: 2
plugins:
  bilibili: "@zhin.js/plugin-bilibili"
bilibili:
  pollCron: "0 * * * * *"   # 每 60 秒一轮
  jitterMs: 15000            # 每轮随机延迟 0–15 秒
  # cookie: ${BILIBILI_COOKIE}  # 可选，风控严格时再配
```

推送需要 Runtime 提供 Schedule（定时任务）和 Outbound（主动发消息）；订阅持久化需要配置数据库，没有数据库时订阅只保存在内存里，重启即丢失。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `pollCron` | `0 * * * * *` | 轮询频率（6 段 Cron），默认每 60 秒 |
| `jitterMs` | `15000` | 每轮开始前的随机延迟上限，避免整点并发 |
| `requestGapMs` | `1500` | 同一轮里相邻两个 UP 主的动态请求间隔 |
| `maxBackoffMinutes` | `30` | 失败后指数退避（1、2、4… 分钟）的上限；风控响应退避更久 |
| `maxPerChannel` | `20` | 每个会话最多订阅多少个 UP 主 |
| `timeout` | `10000` | 单次 HTTP 请求超时（毫秒） |
| `live` / `dynamic` | `true` | 分别开关开播轮询和动态轮询 |
| `cookie` | `""` | 可选 Cookie（如 `SESSDATA=...`）。写成 `${BILIBILI_COOKIE}`，把值放进 `.env`，不要提交到仓库 |

## 命令

| 命令 | 说明 |
| --- | --- |
| `bili sub <uid> [all\|live\|dynamic]` | 订阅 UP 主，`uid` 也可以是空间链接；类型默认 `all`（开播 + 动态），也可写 `直播` / `动态`。对已订阅的 UP 主再执行一次可修改类型 |
| `bili unsub <uid>` | 取消当前会话的订阅 |
| `bili list` | 查看当前会话的订阅，以及正在退避的请求 |
| `bili live <房间号>` | 查询直播间状态，支持 `https://live.bilibili.com/...` 链接 |

订阅按「适配器 + 机器人账号 + 会话」隔离，不同群互不影响。

### 权限

- 群聊和频道里，`bili sub` / `bili unsub` 只有**群主、群管理员或机器人主人**（`role(owner,admin,master)`）能用，其他成员会收到提示，订阅不会改动。
- 私聊里任何人都可以订阅、取消自己这个私聊会话。
- `bili list`、`bili live` 是只读命令，不限制。

角色来自适配器给出的平台无关身份 `sender.role`（如 icqq / OneBot 的 `owner`、`admin`，以及主人账号的 `master`），判断用的是命令路由同一套内置 permit 检查。适配器拿不到群角色时，群里只有机器人主人能管理订阅。

## AI 工具

技能 `bilibili` 提供两个只读工具：

- `bili_live_status`：按直播间号或 UID 查询是否在播。
- `bili_list_subscriptions`：列出全部订阅。

订阅的增删只走聊天命令。

## 工作原理

- **开播**：所有被订阅的 UP 主合并成一次批量请求（`get_status_info_by_uids`，无需登录）。从「未开播 / 轮播」变为「直播中」，或者开播时间变化（说明是新的一场）时推送一次。
- **动态**：逐个请求 UP 主空间动态（`x/polymer/web-dynamic/v1/feed/space`，带 WBI 签名和匿名 `buvid3`），按发布时间和已推送 ID 双重去重；置顶的旧动态不会推送，单个 UP 主每轮最多推 3 条。直播推荐类动态交给开播提醒处理。
- **首次观察只记基线**：新订阅或重启后的第一轮不推送历史内容。
- **降级**：接口返回格式变了、风控（`-352`、`-412`、`-799`、HTTP 412）或网络错误时，不会让定时任务失败，只在日志里提示并对该来源指数退避，`bili list` 里能看到恢复时间。风控时会丢弃缓存的 WBI 密钥和设备 ID，下次重新获取。

## 数据库

| 表 | 用途 |
| --- | --- |
| `bilibili_subscriptions` | 订阅：`uid`、`uname`、`kinds`、会话地址、创建人 |
| `bilibili_watch_state` | 每个 UP 主的开播状态、动态游标、最近推送过的动态 ID |

取消最后一个订阅时会清掉对应 UP 主的游标。

## 注意事项

- 这些都是 B 站网页端的非公开接口，随时可能变化。动态接口对匿名请求和机房 IP 风控很严：可能返回 412 / -352，也可能悄悄返回空列表。插件把空列表当成「本轮没拿到」，不会据此建立基线或推送旧内容；超过 6 小时的动态只记为已读、不推送。长期拿不到动态时，可以配置登录后的 `cookie`，或只开 `live`。
- 请保持保守的轮询频率，不要把 `pollCron` 调到几秒一次。

---

## English

### Install

```bash
pnpm exec zhin install @zhin.js/plugin-bilibili
```

```yaml
configVersion: 2
plugins:
  bilibili: "@zhin.js/plugin-bilibili"
bilibili:
  pollCron: "0 * * * * *"
  # cookie: ${BILIBILI_COOKIE}
```

Pushing needs the Schedule and Outbound hosts; persistence needs a configured database (otherwise subscriptions are kept in memory).

### Commands

- `bili sub <uid> [all|live|dynamic]`: subscribe the current conversation (uid or space URL). Running it again changes the kind.
- `bili unsub <uid>`: unsubscribe.
- `bili list`: list subscriptions and sources currently backing off.
- `bili live <room>`: show a live room's status (room id or URL).

**Permissions:** in groups and channels, `bili sub` / `bili unsub` are limited to the group owner, group admins and the bot master (`role(owner,admin,master)`); other members get a notice and nothing changes. In private chat anyone can manage their own conversation. `bili list` and `bili live` are read-only and unrestricted. Roles come from the adapter's platform-agnostic `sender.role` and are checked with the same built-in permit checker the command router uses; if an adapter does not report group roles, only the bot master can manage group subscriptions.

### Configuration

`pollCron` (default every 60s), `jitterMs` (random delay before each poll), `requestGapMs`, `maxBackoffMinutes`, `maxPerChannel`, `timeout`, `live`, `dynamic`, and an optional `cookie` that should be referenced as `${BILIBILI_COOKIE}` from `.env`.

### How it works

Live status is polled in one batched, unauthenticated request; a push happens on the offline→live transition or when a new session start time appears. Dynamics are fetched per UP from the WBI-signed space feed with an anonymous `buvid3` cookie, deduplicated by publish time and pushed IDs; old pinned items are ignored and at most 3 items per UP are pushed per tick. The first observation only records a baseline. Payload changes, risk control (`-352`, `-412`, `-799`, HTTP 412) and network errors never fail the scheduled job: the affected source backs off exponentially and `bili list` shows when it will retry.

### Caveats

These are undocumented Bilibili web endpoints and may change. The dynamic feed is aggressively risk-controlled for anonymous and datacenter clients: it may answer 412 / -352 or silently return an empty list. Empty answers are never used as a baseline, and dynamics older than 6 hours are marked seen without being pushed. Configure a logged-in `cookie`, or enable `live` only, if dynamics keep failing.

## AI tools

`bili_live_status` and `bili_list_subscriptions` (skill `bilibili`), both read-only.

## License

MIT
