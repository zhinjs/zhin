# @zhin.js/adapter-bilibili

> **Experimental** — 基于 B 站 **非官方 Web 接口**，随时可能因平台改版失效；不进 stable smoke，接口与配置可能不兼容变更。

Zhin.js Bilibili 评论适配器（Plugin Runtime）：让 AI 辅助回复**你自己视频**下的评论。契约见 [ADR 0035：评论型平台适配器契约](https://github.com/zhinjs/zhin/blob/main/docs/adr/0035-comment-reply-adapter-contract.md)，讨论见 [#971](https://github.com/zhinjs/zhin/issues/971)。

## 先读这几条

- **以你的账号身份操作**：B 站开放平台没有评论读写权限，本适配器使用你的登录 Cookie（`SESSDATA` + `bili_jct`）。Cookie 等同于账号密码，只能用环境变量 / 密钥存储注入，**不要写进 `zhin.config.yml` 明文，不要提交到仓库，不要贴进日志或 issue**。
- **默认先审再发**：`sendMode` 默认 `review`，AI 写好的回复只进入草稿队列，**不会自动发到 B 站**；只有 master 执行 `bili-draft send <id>` 后才真正发出。不提供自动直发。
- **只管白名单视频**：只轮询 `videos` 里列出的视频（建议只填自己的稿件）。不做全站搜索、不去别人的评论区刷评论；请遵守 B 站用户协议，禁止用于营销、引流、刷屏。
- **风控即熔断**：遇到频繁 / 验证码 / 风控拦截 / 重复评论等错误码，endpoint 立即停止轮询并记录错误，不自动重试；人工确认账号状态后重启。

## 当前能力

| 能力 | 状态 |
|---|---|
| BV 号 → aid 解析 | ✅ 已实现 |
| 轮询白名单视频最新评论（`x/v2/reply`，仅视频 `type=1`） | ✅ 已实现（只读） |
| Cookie 登录态识别自身 uid、过滤自己的评论 | ✅ 已实现 |
| 一条评论楼 = 一个会话（`video:<aid>:<根评论rpid>`） | ✅ 已实现 |
| 首轮只建基线，不把历史评论灌给 AI | ✅ 已实现 |
| AI 回复进入草稿队列（`review`） | ✅ 已实现（进程内存，重启即丢） |
| master 审批后真正发出（`bili-draft send` → `x/v2/reply/add`） | ✅ 已实现（带发送间隔与风控熔断） |
| 审批前改写 / 丢弃草稿（`bili-draft edit` / `drop`） | ✅ 已实现 |
| 「回复我的 / @我的」通知（`x/msgfeed/reply`、`x/msgfeed/at`） | ✅ 已实现（需 Cookie，默认关闭，只收视频评论） |
| 新草稿主动推送给 master / Console 审批页 | 🚧 未实现（目前用 `bili-draft list` 查看） |
| 草稿持久化 | 🚧 未实现 |
| 扫码登录 / Cookie 持久化 | 🚧 未实现 |
| 动态 / 专栏评论 | 🚧 v1.1 |

## 前置条件

1. 一个你自己的 B 站账号，以及要管理的视频 BV 号（建议只填自己的稿件）
2. 浏览器登录 bilibili.com 后，从开发者工具 → Application → Cookies 取 `SESSDATA` 与 `bili_jct`
3. 把它们放进环境变量（如 `.env` 且 `.env` 已被 gitignore）：`BILIBILI_SESSDATA`、`BILIBILI_BILI_JCT`
4. Cookie 会过期；失效时日志出现 `bilibili_login_invalid`，重新获取即可

必填字段（`endpoints[i]`）：`id`。只读公开评论可不填 Cookie。

## 最小配置

```yaml
configVersion: 2
plugins:
  bilibili: "@zhin.js/adapter-bilibili"
bilibili:
  sendMode: review          # 默认；off = 完全禁止出站
  pollIntervalSec: 60       # 最小 60
  minSendIntervalSec: 30    # 审批后两次真实发送的最小间隔，最小 10
  notifications: [reply, at]  # 可选：再收「回复我的 / @我的」；默认不开
  endpoints:
    - id: my-bilibili
      sessdata: ${BILIBILI_SESSDATA}
      biliJct: ${BILIBILI_BILI_JCT}
      videos:
        - BV1xx411c7mD       # 只填你自己的视频
```

不填 Cookie 也能只读轮询公开评论，但无法识别自己的账号（无法过滤自回环），也无法发送或接收「回复我的 / @我的」。

审批命令只认 master 角色：在你平时和机器人聊天的那个适配器（QQ / Telegram 等）配置里把自己设为 `master`（`bilibili.master` 则是 B 站 uid，可在评论区里用命令）。没配置 master 时谁都不能发送。

## 会话与消息

- `conversation.kind = 'channel'`，`id = video:<aid>:<根评论rpid>`，`parent = video:<aid>`
- `message.id` = 评论 `rpid`
- `sender` = 评论作者 uid / 昵称
- `metadata`：`resource`、`rootId`、`parentId`、`via`（`video` / `reply` / `at`）、`createdAt`、`likeCount`、`isUploader`
- 来自「回复我的 / @我的」的评论带 `mentioned: true`，楼中楼回复带 `replyTo`

群聊式触发规则同样适用：评论楼是共享会话，默认需 @ / 前缀才触发 AI；「回复我的 / @我的」按 @ 机器人处理。

### 「回复我的 / @我的」

配置 `notifications: [reply, at]` 后，每轮轮询额外读一页 `x/msgfeed/reply` / `x/msgfeed/at`：

- 首轮只建基线；之后只收新通知
- 只收视频评论（动态 / 专栏通知忽略）
- 默认 `notificationScope: whitelist`，只收 `videos` 白名单视频下的通知；`all` 则收所有视频评论通知（例如你在别人视频下的评论被回复）
- 同一条评论被视频轮询和通知各看到一次时只入站一次

## 出站

`send({ conversation, payload })` 只接受评论楼会话，正文只保留纯文本（≤1000 字）。它**永远**只把回复放入 `endpoint.drafts`，并以 `EndpointDeliveryError('approval_pending', …, 'not_sent')` 告知调用方「未发送、待审批」。payload 里带 `reply` 段（评论 rpid）时回复那条楼中楼，否则回复楼主。

### 审批草稿

审批命令只有 master 能用，可以在任意已接入的聊天平台里发：

| 命令 | 作用 |
|---|---|
| `bili-draft list` | 列出待审草稿（id、被回复的原评论、拟回复内容） |
| `bili-draft show <id>` | 看一条草稿全文 |
| `bili-draft edit <id> <新内容>` | 改写草稿，改完仍需 `send` |
| `bili-draft send <id>` | 审批并发出（`x/v2/reply/add`），成功后返回评论链接 |
| `bili-draft drop <id>` | 丢弃草稿，不发送 |

发送保护：`sendMode: off`、已熔断、缺 `SESSDATA` / `bili_jct`、距上次发送不足 `minSendIntervalSec` 时直接拒绝（草稿保留，不排队、不自动重试）；发送时遇到风控错误码会熔断整个 endpoint。

程序里也可以直接调用 `endpoint.approveDraft(id)` / `editDraft(id, text)` / `discardDraft(id)`。

## 已知限制

- 非官方接口，B 站改签名 / 字段后可能直接失效
- 只轮询每个视频评论第一页（按时间倒序 20 条）；高峰期两次轮询间超过 20 条新评论会漏
- 已见评论 id、通知基线与草稿只存在进程内存，重启后重新建基线、草稿丢失
- 新草稿不会主动通知你，需要 `bili-draft list` 查看
- 「回复我的 / @我的」每轮只读第一页通知
- 只支持视频评论（`type=1`）

## 故障排查

| 现象 | 处理 |
|---|---|
| 日志 `bilibili_circuit_open` | 触发了风控（频繁 / 验证码 / 拦截 / 重复评论）。轮询已停止：去网页端确认账号状态、必要时完成验证，调大 `pollIntervalSec` 后重启 |
| 日志 `bilibili_login_invalid` | `SESSDATA` 失效，重新登录获取 Cookie |
| 日志 `bilibili_no_videos` | 没配 `videos`，适配器不会轮询任何内容 |
| AI 回复没出现在 B 站 | 预期行为：只生成草稿（`bilibili_draft_queued`），需要 master 执行 `bili-draft send <id>` |
| `bili-draft send` 说「发得太快了」 | 未到 `minSendIntervalSec`，稍后再发；草稿保留 |
| `bili-draft` 提示没有权限 | 当前账号不是 master；在聊天平台适配器配置里设置 `master` |
| 日志 `bilibili_notifications_disabled` | 开了 `notifications` 但 Cookie 无效，通知不会轮询 |
