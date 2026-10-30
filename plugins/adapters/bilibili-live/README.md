# @zhin.js/adapter-bilibili-live

> **Experimental** — 基于 B 站直播 **非官方 Web 接口**（弹幕 WebSocket、`msg/send`），随时可能因平台改版失效；不进 stable smoke，接口与配置可能不兼容变更。

Zhin.js Bilibili 直播弹幕适配器（Plugin Runtime）：让 Bot 像主播一样在**你自己的直播间**里看弹幕、挑一条回。设计见 [ADR 0038：连续输入合流——高热群与弹幕](https://github.com/zhinjs/zhin/blob/main/docs/adr/0038-continuous-input-merge.md) §5，讨论见 [#1049](https://github.com/zhinjs/zhin/issues/1049)。

## 先读这几条

- **一窗只回一条**：本适配器声明 `liveDanmaku` 能力。Agent 不逐条回弹幕，而是把一段时间内的弹幕收进窗口，由模型挑一条（或总结后）回一次；两次回复之间至少隔 `ai.agent.inboundQueue.live.minIntervalMs`（默认 15 秒）。窗口参数见下文「弹幕窗口」。
- **弹幕回合只读**：弹幕回合按匿名观众的权限跑，只开放声明了 `readOnly: true` 的工具，不出任何审批卡，不跑 Shell / MCP / 子 Agent。禁言、拉黑等动作不走弹幕。
- **以你的账号身份发弹幕**：发弹幕需要登录 Cookie（`SESSDATA` + `bili_jct`），等同于账号密码：**用环境变量注入，不要写进 `zhin.config.yml` 明文，不要提交到仓库，不要贴进日志或 issue**。不填 Cookie 时只能匿名收弹幕（平台会把昵称打码、uid 给 0），不能发。
- **默认直接发**：`sendMode` 默认 `direct`，回复直接作为弹幕发出（弹幕是实时的，先审再发没有意义）。只想让 Bot 听不想让它说，设 `sendMode: off`。
- **只进自己的直播间**：只连 `roomId` 指定的一个房间，也只往这个房间发。请遵守 B 站用户协议，禁止用于营销、引流、刷屏。
- **风控即熔断**：发弹幕遇到频控（`10031`）/ 风控拦截等错误码，立即停止发送并记录错误，不自动重试；人工确认账号状态后重启。

## 当前能力

| 能力 | 状态 |
|---|---|
| 短号 → 真实房间号 | ✅ 已实现 |
| 弹幕服务器地址与 token（WBI 签名） | ✅ 已实现 |
| 弹幕 WebSocket：认证、30 秒心跳、断线退避重连（每次重连重新取 token） | ✅ 已实现 |
| 解压 zlib / brotli 消息、解析 `DANMU_MSG` | ✅ 已实现（礼物、进场等其他消息忽略） |
| 过滤自己发的弹幕、按弹幕 id 去重 | ✅ 已实现 |
| 发弹幕（`msg/send`）：按长度切分、至多 `maxChunks` 条、`@` 被选中观众（平台「回复」） | ✅ 已实现 |
| 两次发送最小间隔、风控熔断 | ✅ 已实现 |
| 礼物 / 上舰 / SC 事件 | 🚧 未做 |
| 扫码登录（复用 `@zhin.js/adapter-bilibili` 凭据） | 🚧 未做 |

## 前置条件

1. 你自己的 B 站直播间号（`roomId`，短号长号都行）
2. 要让 Bot 发弹幕：你的账号 Cookie `SESSDATA` 与 `bili_jct`，放进 `.env`（已被 gitignore）：`BILIBILI_SESSDATA`、`BILIBILI_BILI_JCT`。只想让 Bot 听弹幕可以不填
3. Agent 已启用（`ai.agent`）：弹幕窗口由 Agent 的 `inboundQueue.live` 驱动

## 最小配置

```yaml
configVersion: 2
plugins:
  bilibili-live: "@zhin.js/adapter-bilibili-live"
bilibili-live:
  sendMode: direct          # 默认；off = 只听不说
  maxLength: 20             # 单条弹幕字数上限，直播等级高的账号可调大
  maxChunks: 2              # 一次回复最多几条弹幕
  minSendIntervalSec: 5     # 两次发送的最小间隔（Agent 本身还有 15 秒窗口间隔）
  endpoints:
    - id: my-live
      roomId: 123456        # 只填你自己的直播间
      sessdata: ${BILIBILI_SESSDATA}
      biliJct: ${BILIBILI_BILI_JCT}
```

浏览器登录 bilibili.com 后，从开发者工具 → Application → Cookies 取 `SESSDATA` 与 `bili_jct`。

必填字段（`endpoints[i]`）：`id`、`roomId`。

## 弹幕窗口

窗口由 Agent 配置控制（不是本适配器的配置）：

```yaml
ai:
  agent:
    inboundQueue:
      live:
        mode: pick-one        # pick-one：挑一条回；summary：总结窗口后回一次
        windowMs: 10000       # 第一条弹幕后等多久发车
        minIntervalMs: 15000  # 两次弹幕回复的最小间隔
```

主人（`master`）发的弹幕不进窗口，单独一个回合。审计里 `danmaku_window_picked` 记录候选数与选中项。

## 会话与消息

| 字段 | 值 |
|---|---|
| `conversation` | `{ kind: 'channel', id: <真实房间号> }` |
| `message.id` | 平台弹幕 id（取不到时用时间戳 + uid + 序号） |
| `sender.id` | 观众 uid；匿名收弹幕时为 `anon:<打码昵称>` |
| `metadata` | `{ roomId, liveDanmaku: true }` |

出站只支持纯文本：Markdown 去格式，图片等其他段不支持；回复里的第一个 `mention` 不进正文，转成平台的「回复」字段（被选中观众会看到）。

## 磁盘占用

本适配器不落盘：去重表（最近 500 条弹幕 id）与连接状态都在内存里，重启即清空。

## 已知限制

- 未登录时平台给的 uid 是 0、昵称打码，同名打码观众会被当成同一个人。
- 平台接口随时可能改版（例如 WBI 签名、`getDanmuInfo` 风控），失效时连接会反复失败并退避重连，请关注日志。

## Console 页面

启动后打开 Console 的「Bilibili 直播弹幕」页（地址 `/bilibili-live`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 增删 `plugins.bilibili-live.endpoints`（凭据写入 `.env`，配置里只保留 `${ENV}` 引用）；

扫码登录仍复用 B 站评论适配器页面；这里只管理直播弹幕连接与 endpoint。

读取需要 `bilibili-live:read`，写操作需要 `bilibili-live:write`；管理员 full token 不受限。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 日志 `bilibili_live_anonymous` | 没配 Cookie 或 Cookie 已失效：只能匿名收弹幕，发弹幕返回 `not_logged_in`。重新取 Cookie 后重启 |
| 连接反复失败、`getDanmuInfo` 返回 `-352` | 平台风控拦截取 token 的请求。确认 Cookie 有效、配上 `buvid3` 后重启；仍失败说明接口改版 |
| `bilibili live auth rejected` | 认证包被拒（token 过期或房间号错）。核对 `roomId`；重连会重新取 token |
| 日志 `bilibili_live_circuit_open` | 发弹幕遇到频控 / 风控，已停止发送。调大 `minSendIntervalSec` 或 `inboundQueue.live.minIntervalMs`，人工确认账号状态后重启 |
| 回复被截成「…」 | 超过 `maxLength × maxChunks`。直播等级高的账号可调大 `maxLength` |
| 发送返回 `rate_limited` | 距上次发送不足 `minSendIntervalSec`，这次回复被丢弃（不排队） |
