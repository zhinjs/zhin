# @zhin.js/adapter-douyin-live

> **Experimental · 非官方协议** — 基于抖音直播网页端 **非官方、未公开** 的弹幕 WebSocket（`webcast/im/push/v2`）与页面数据，**随时可能因平台改版、签名升级或风控而失效**；不进 stable smoke，接口与配置可能不兼容变更。使用前请自行确认符合抖音用户协议，仅用于**你自己的直播间**。

> 🚧 **当前只听不说**：`sendMode` 默认 `off`。`sendMode: direct` 尚未实现（没有稳定、可测试的发弹幕接口），发送会明确返回 `not_implemented`，回复不会出现在直播间。

账号由 `DouyinLiveAdapter` 管理。Endpoint 直接继承实际 `DouyinLiveClient`，保留原生方法与事件；框架生命周期、规范入站与发送经 `endpointSpec` 和 AdapterIndex 接入，不占用 Client 的原生方法。

`Session.event` 使用 Client 已公开的 `DouyinLiveChat`（`uid`、`nickname`、`text`、`timestamp`、可选 `id` / `roomId`）事件对象，与 `danmaku` 事件保持同一引用。网络帧经包内最小 protobuf 解码器解析，未作为公开事件 DTO。

Zhin.js 抖音直播弹幕适配器（Plugin Runtime）：让 Bot 在**你自己的直播间**里看弹幕，弹幕与 B 站直播弹幕一样进入 Agent 的弹幕窗口。设计见 [ADR 0038：连续输入合流——高热群与弹幕](https://github.com/zhinjs/zhin/blob/main/docs/adr/0038-continuous-input-merge.md) §5，讨论见 [#1049](https://github.com/zhinjs/zhin/issues/1049)、[#1135](https://github.com/zhinjs/zhin/issues/1135)。

## 先读这几条

- **非官方协议，随时会坏**：房间号解析、WebSocket 地址参数、`signature` 签名、protobuf 字段都来自对网页端的观察，平台一改就失效。失效时连接会反复失败并退避重连，请关注日志。
- **签名不内置**：平台要求 WebSocket 地址带 `signature`（由网页端混淆脚本生成）。本包**不内置、不 vendor** 任何平台脚本或第三方抓取器；可配 `signerUrl` 指向你自己部署的签名服务。不配时不带签名连接，**平台可能直接拒绝握手**。
- **一窗只回一条**：本适配器声明 `liveDanmaku` 能力。Agent 不逐条回弹幕，而是把一段时间内的弹幕收进窗口，由模型挑一条（或总结后）回一次。窗口参数见下文「弹幕窗口」。
- **弹幕回合只读**：弹幕回合按匿名观众的权限跑，只开放声明了 `readOnly: true` 的工具，不出任何审批卡，不跑 Shell / MCP / 子 Agent。
- **默认只听不说（sendMode α）**：`sendMode` 默认 `off`；`direct` 目前只做房间与内容校验，然后返回 `not_implemented`，不会调用任何平台写接口。
- **Cookie 等同账号凭据**：`cookie` 可选（不填时启动时申请游客 `ttwid`）。若填写浏览器 Cookie，**用环境变量注入，不要写进 `zhin.config.yml` 明文，不要提交到仓库，不要贴进日志或 issue**。本包从不记录 Cookie。
- **只进自己的直播间**：只连 `roomId` 指定的一个房间。禁止用于营销、引流、刷屏或采集他人直播间数据。

## 当前能力

| 能力 | 状态 |
|---|---|
| web_rid → 内部 room_id（直播间页内嵌数据），游客 `ttwid` | ✅ 已实现（每次重连重新解析） |
| 弹幕 WebSocket：10 秒 `hb` 心跳、`needAck` 回 ack、看门狗、断线退避重连 | ✅ 已实现 |
| 解 gzip `PushFrame` → `Response`，只解析 `WebcastChatMessage` | ✅ 已实现（礼物、进场、点赞、关注等忽略） |
| 按消息 id 去重（最近 500 条） | ✅ 已实现 |
| WebSocket `signature` | 🚧 不内置；可配 `signerUrl` 外部签名服务 |
| 发弹幕（`sendMode: direct`） | 🚧 未实现，返回 `not_implemented` |
| 过滤自己发的弹幕 | 🚧 暂无（本包不发弹幕，也不识别登录账号） |
| 礼物 / 进场 / 点赞 / 关注事件、扫码登录、多直播间、Console 页面 | 🚧 未做 |

## 前置条件

1. 你自己的抖音直播间 web_rid（`https://live.douyin.com/<web_rid>` 里的数字）作为 `roomId`
2. 可选：浏览器 Cookie 整串，放进 `.env`（已被 gitignore）：`DOUYIN_LIVE_COOKIE`。不填则使用游客 `ttwid`
3. 可选：自建签名服务地址 `signerUrl`（见下文「签名」）
4. Agent 已启用（`ai.agent`）：弹幕窗口由 Agent 的 `mailbox.live` 驱动

## 最小配置

```yaml
configVersion: 2
plugins:
  douyin-live: "@zhin.js/adapter-douyin-live"
douyin-live:
  sendMode: off             # 默认；direct 尚未实现（返回 not_implemented）
  maxLength: 50             # 为后续 direct 发送预留
  maxChunks: 2
  minSendIntervalSec: 5
  endpoints:
    - id: my-live
      roomId: "123456789"   # web_rid；只填你自己的直播间
      cookie: ${DOUYIN_LIVE_COOKIE}
      # signerUrl: http://127.0.0.1:8080/sign
```

必填字段（`endpoints[i]`）：`id`、`roomId`。

## 签名

连接前按网页端规则把固定的一组查询参数（`live_id`、`aid`、`version_code`、`webcast_sdk_version`、`room_id`、`user_unique_id`、`identity` 等）拼成 `k=v,k=v,...` 取 md5，得到 `X-MS-STUB`。配置了 `signerUrl` 时请求：

```text
GET <signerUrl>?stub=<X-MS-STUB>
```

响应为纯文本签名，或 JSON `{ "signature": "..." }`，结果作为 WebSocket 的 `signature` 参数。签名服务由你自行部署与维护，本包不提供实现。

## 弹幕窗口

窗口由 Agent 配置控制（不是本适配器的配置），与 `@zhin.js/adapter-bilibili-live` 相同：

```yaml
ai:
  agent:
    mailbox:
      live:
        mode: pick-one        # pick-one：挑一条回；summary：总结窗口后回一次
        windowMs: 10000       # 第一条弹幕后等多久发车
        minIntervalMs: 15000  # 两次弹幕回复的最小间隔
```

## 会话与消息

| 字段 | 值 |
|---|---|
| `conversation` | `{ kind: 'channel', id: <web_rid> }`（与配置 `roomId` 一致） |
| `message.id` | 平台消息 id（取不到时用时间戳 + uid + 序号） |
| `sender.id` | 观众 user id；取不到时为 `anon:<昵称>` |
| `metadata` | `{ roomId: <内部 room_id>, liveDanmaku: true }` |

出站（将来 `direct`）只支持纯文本：Markdown 去格式，图片等其他段不支持；抖音弹幕没有「回复」字段，`mention` 折叠进正文 `@昵称`。

## 磁盘占用

本适配器不落盘：去重表（最近 500 条消息 id）与连接状态都在内存里，重启即清空。

## 已知限制

- 平台协议非公开，字段与签名随时可能变化；不签名时可能无法连接。
- 取不到 uid 的观众按昵称区分，同名观众会被当成同一个人。
- 本切片不提供 Console 页面与 RPC。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 日志 `douyin_live_unsigned` | 未配 `signerUrl`，不带签名连接。若握手被拒，部署签名服务后配 `signerUrl` |
| `Douyin live page returned no room_id` | 直播间未开播、web_rid 填错，或页面改版。核对 `roomId` |
| `Douyin live did not issue a ttwid cookie` | 游客 Cookie 申请失败（风控 / 网络）。可在 `cookie` 里带上浏览器的 `ttwid` |
| 连接反复断开重连 | 签名失效、Cookie 失效或协议改版；看门狗 30 秒无数据也会重连 |
| 发送返回 `send_disabled` | `sendMode: off`（默认），只听不说 |
| 发送返回 `not_implemented` | `sendMode: direct` 尚未实现，改回 `off` |
