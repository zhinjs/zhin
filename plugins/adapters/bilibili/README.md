# @zhin.js/adapter-bilibili

> **Experimental** — 基于 B 站 **非官方 Web 接口**（含扫码登录接口），随时可能因平台改版失效；不进 stable smoke，接口与配置可能不兼容变更。

Zhin.js Bilibili 评论适配器（Plugin Runtime）：让 AI 辅助回复**你自己视频**下的评论。契约见 [ADR 0035：评论型平台适配器契约](https://github.com/zhinjs/zhin/blob/main/docs/adr/0035-comment-reply-adapter-contract.md)，讨论见 [#971](https://github.com/zhinjs/zhin/issues/971)。

## 先读这几条

- **以你的账号身份操作**：B 站开放平台没有评论读写权限，本适配器使用你的登录 Cookie（`SESSDATA` + `bili_jct`）。推荐在 Console「评论审批」页**扫码登录**，凭据只存在运行机器人那台机器的数据目录里（`data/bilibili/<账号>/credentials.json`，权限 600）。也可以用环境变量注入。Cookie 等同于账号密码：**不要写进 `zhin.config.yml` 明文，不要提交到仓库，不要贴进日志或 issue**。
- **默认先审再发**：`sendMode` 默认 `review`，AI 写好的回复只进入草稿队列，**不会自动发到 B 站**；只有你在 Console「评论审批」页点「发送」，或 master 执行 `bili-draft send <id>` 后才真正发出。不提供自动直发。
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
| AI 回复进入草稿队列（`review`） | ✅ 已实现 |
| 草稿持久化（重启不丢，发送中断会提示先确认） | ✅ 已实现（`data/bilibili/<账号>/drafts.json`） |
| master 审批后真正发出（`bili-draft send` → `x/v2/reply/add`） | ✅ 已实现（带发送间隔与风控熔断） |
| 审批前改写 / 丢弃草稿（`bili-draft edit` / `drop`） | ✅ 已实现 |
| 扫码登录 / Cookie 持久化（Console 页或 `bili-login start`） | ✅ 已实现（环境变量注入仍可用且优先） |
| Cookie 失效识别：清除失效凭据、提醒重新扫码 | ✅ 已实现 |
| Console「评论审批」页：登录状态、白名单视频、待审草稿的发送 / 改写 / 丢弃 | ✅ 已实现 |
| 新草稿 / 登录失效主动推送给你（`notify`） | ✅ 已实现（可选，经统一出站链路发到你指定的聊天会话） |
| 「回复我的 / @我的」通知（`x/msgfeed/reply`、`x/msgfeed/at`） | ✅ 已实现（需登录，默认关闭，只收视频评论） |
| 动态 / 专栏评论 | 🚧 v1.1 |

## 前置条件

1. 一个你自己的 B 站账号，以及要管理的视频 BV 号（建议只填自己的稿件）
2. 登录方式二选一：
   - **扫码登录（推荐）**：启动后打开 Console「评论审批」页，点「扫码登录 B 站」，用 B 站 App 扫码确认；或私聊机器人发 `bili-login start`（只在私聊发二维码）
   - **环境变量**：浏览器登录 bilibili.com 后，从开发者工具 → Application → Cookies 取 `SESSDATA` 与 `bili_jct`，放进 `.env`（已被 gitignore）：`BILIBILI_SESSDATA`、`BILIBILI_BILI_JCT`
3. 数据目录 `data/` 不要提交到仓库（`create-zhin-app` 生成的项目已忽略；自建项目请确认 `.gitignore` 里有 `data/`）
4. Cookie 会过期；失效时页面显示「登录已失效」、日志出现 `bilibili_login_invalid`，重新扫码即可

必填字段（`endpoints[i]`）：`id`。只读公开评论可不登录。

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
  notify:                   # 可选：新草稿 / 登录失效时提醒你
    adapter: icqq           # 你平时和机器人聊天的适配器
    endpoint: my-qq         # 该适配器的 endpoints[i].id
    id: "10001"             # 你的账号（私聊）
  endpoints:
    - id: my-bilibili
      videos:
        - BV1xx411c7mD       # 只填你自己的视频
      # 不扫码而用环境变量时再加：
      # sessdata: ${BILIBILI_SESSDATA}
      # biliJct: ${BILIBILI_BILI_JCT}
```

启动后在 Console 打开「评论审批」扫码登录即可。不登录也能只读轮询公开评论，但无法识别自己的账号（无法过滤自回环），也无法发送或接收「回复我的 / @我的」。

### 登录与凭据

- **优先级**：配置 / 环境变量里的 Cookie 有效时优先使用（覆盖扫码凭据）；没配或已失效时用扫码登录存下的凭据。
- **存放位置**：`dataDir`（默认 `data/bilibili`，相对进程工作目录）下的 `<endpoint id>/credentials.json`，文件权限 600。不进 YAML、不进日志。
- **失效处理**：启动自检或发送时平台返回未登录，会删除失效的扫码凭据、页面显示「登录已失效」，并按 `notify` 提醒你重新扫码。草稿都保留。
- **退出**：Console 页「退出登录」会删除本地扫码凭据；环境变量注入的 Cookie 只能在环境变量里改。
- **二维码安全**：二维码在本机生成图片，不交给第三方二维码服务，不写日志；`bili-login start` 只在私聊里发。

### Console「评论审批」页

装了 Console 时，导航里会出现「评论审批」（地址是插件路径，如 `/bilibili`）。页面上可以：

- 看登录状态、扫码登录 / 重新扫码 / 退出登录
- 看待审回复：被回复的原评论、AI 拟的回复，点「发送」「修改」「丢弃」
- 看正在管理的视频（只读，增删请改配置）

页面每 10 秒自动刷新（扫码时 2 秒），新草稿会自动出现。

访问权限（普通用户令牌在 `http.tokens[].permissions` 里给，full 令牌不受限）：

| 权限 | 允许 |
|---|---|
| `bilibili:read` | 打开页面、看状态和草稿 |
| `bilibili:review` | 发送 / 改写 / 丢弃草稿 |
| `bilibili:login` | 扫码登录 / 退出登录 |

审批命令只认 master 角色：在你平时和机器人聊天的那个适配器（QQ / Telegram 等）配置里把自己设为 `master`（`bilibili.master` 则是 B 站 uid，可在评论区里用命令）。没配置 master 时谁都不能用命令发送。

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

在 Console「评论审批」页处理最方便；也可以用命令（只有 master 能用，可以在任意已接入的聊天平台里发）：

| 命令 | 作用 |
|---|---|
| `bili-draft list` | 列出待审草稿（id、被回复的原评论、拟回复内容） |
| `bili-draft show <id>` | 看一条草稿全文 |
| `bili-draft edit <id> <新内容>` | 改写草稿，改完仍需 `send` |
| `bili-draft send <id>` | 审批并发出（`x/v2/reply/add`），成功后返回评论链接 |
| `bili-draft drop <id>` | 丢弃草稿，不发送 |
| `bili-login start [账号]` | 扫码登录（只在私聊里发二维码） |
| `bili-login status` | 查看登录状态与待审数量 |

草稿存在 `data/bilibili/<账号>/drafts.json`，重启后自动恢复（最多保留最新 200 条）。发送过程中进程退出的草稿会标记「上次发送中断，可能已经发出」，请先到 B 站确认再决定是否重发。

发送保护：`sendMode: off`、已熔断、未登录或登录失效、距上次发送不足 `minSendIntervalSec` 时直接拒绝（草稿保留，不排队、不自动重试）；发送时遇到风控错误码会熔断整个 endpoint。

程序里也可以直接调用 `endpoint.approveDraft(id)` / `editDraft(id, text)` / `discardDraft(id)`、`startQrLogin()` / `logout()`。

### 主动提醒

配置 `notify` 后，以下情况会经统一出站链路（`OutboundHost`）发一条消息到那个会话：

- 有新草稿：原评论摘要、拟回复、审批方式
- 登录失效：提醒重新扫码（或更新环境变量）
- 扫码登录成功

不配 `notify` 时只在 Console 页和日志（`bilibili_draft_queued`）里看到。提醒发送失败只记日志，不影响草稿。

## 已知限制

- 非官方接口，B 站改签名 / 字段 / 扫码流程后可能直接失效
- 只轮询每个视频评论第一页（按时间倒序 20 条）；高峰期两次轮询间超过 20 条新评论会漏
- 已见评论 id 与通知基线只在内存里，重启后重新建基线（不会把重启期间的旧评论再交给 AI）
- 不做 Cookie 自动续期；过期后需要重新扫码
- 「回复我的 / @我的」每轮只读第一页通知
- 只支持视频评论（`type=1`）

## 故障排查

| 现象 | 处理 |
|---|---|
| 日志 `bilibili_circuit_open` | 触发了风控（频繁 / 验证码 / 拦截 / 重复评论）。轮询已停止：去网页端确认账号状态、必要时完成验证，调大 `pollIntervalSec` 后重启 |
| 日志 `bilibili_login_invalid` / 页面「登录已失效」 | Cookie 失效。扫码登录的直接重新扫码；环境变量注入的更新环境变量，或去掉后扫码 |
| 扫码提示「B 站风控拦截」 | 扫码接口被限流，稍等几分钟再试 |
| 日志 `bilibili_no_videos` | 没配 `videos`，适配器不会轮询任何内容 |
| AI 回复没出现在 B 站 | 预期行为：只生成草稿（`bilibili_draft_queued`），需要在 Console 页点「发送」或 `bili-draft send <id>` |
| Console 里没有「评论审批」 | 确认装了 Console（`@zhin.js/page`），并且令牌有 `bilibili:read` 权限 |
| 页面按钮提示「没有操作权限」 | 令牌缺少 `bilibili:review` / `bilibili:login` |
| `bili-draft send` 说「发得太快了」 | 未到 `minSendIntervalSec`，稍后再发；草稿保留 |
| `bili-draft` 提示没有权限 | 当前账号不是 master；在聊天平台适配器配置里设置 `master` |
| 日志 `bilibili_notifications_disabled` | 开了 `notifications` 但未登录，通知不会轮询 |
| 日志 `bilibili_notify_failed` | `notify` 指向的会话发不出去：检查 adapter / endpoint / id 是否正确、该适配器是否在线 |
| 日志 `bilibili_draft_persist_failed` | 数据目录不可写；检查 `dataDir` 权限。草稿仍在内存里 |

## 参考

扫码登录与整体流程参考了以下开源项目的做法（只借鉴流程，未复制代码，也不依赖它们）：[renmu123/biliAPI](https://github.com/renmu123/biliAPI)（WebQrcodeLogin）、[WittF/bilibili-qr-login](https://github.com/WittF/bilibili-qr-login)、[Ninzore/bilibili-captain](https://github.com/Ninzore/bilibili-captain)（Login.loginQR）、[Janson20/BiliCommentBot](https://github.com/Janson20/BiliCommentBot)。社区接口文档 SocialSisterYi/bilibili-API-collect 已归档，本适配器不依赖它；接口随时可能变化，见顶部 Experimental 说明。
