# @zhin.js/adapter-lark

Zhin.js 飞书 / Lark 适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` POST + 可选 verificationToken / encryptKey 签名）
- URL 验证挑战（`url_verification`）
- Tenant Access Token 自动刷新
- 支持飞书与 Lark 国际版 API 基址
- canonical `markdown` 段编码为 `interactive` JSON 2.0 卡片中的 `markdown`
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-lark
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/lark/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation, message: { conversation, id }, content: text, sender, metadata })`  
出站：`send({ conversation, payload })` → `im/v1/messages`

入站 `metadata.mentioned`：**未接线**。消息事件的 `mentions[]` 元素含 `id.open_id`，但本适配器拿不到 bot 自身的 open_id——配置（`appId` / `appSecret` / `id` 等）不含 bot open_id，代码也未调用 `bot/v3/info` 获取应用信息，故无可靠判据比对 mentions。

## 前置条件

1. 在 [飞书开放平台](https://open.feishu.cn/)（或 Lark）创建企业自建应用
2. 获取 **App ID**、**App Secret**
3. 启用机器人能力并配置事件订阅 URL：`https://your-domain/lark/webhook`
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段（`endpoints[i]`）：`id`、`appId`、`appSecret`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  lark:
    webhookPath: /lark/webhook          # 可选，默认 /lark/webhook
    isFeishu: true                      # 可选，默认 true
    # apiBaseUrl: https://open.feishu.cn/open-apis
    endpoints:
      - id: my-lark-bot
        appId: ${LARK_APP_ID}
        appSecret: ${LARK_APP_SECRET}
        # encryptKey: ${LARK_ENCRYPT_KEY}          # 可选
        # verificationToken: ${LARK_VERIFY_TOKEN}  # 可选
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-lark`（`instanceKey: lark`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `LARK_APP_ID` | 示例中由 YAML `${LARK_APP_ID}` 引用的 App ID；变量名可自行定义 |
| `LARK_APP_SECRET` | 示例中由 YAML `${LARK_APP_SECRET}` 引用的 App Secret；变量名可自行定义 |

## 消息类型映射

| 飞书类型 | 入站 content（文本摘要） | 出站 wire |
|----------|--------------------------|-----------|
| text | 原文 | text |
| markdown | 原文 | interactive（JSON 2.0 `markdown`） |
| image | `[image]` | image（需 `file_key`） |
| file | `[file: name]` | file |
| audio / video / sticker | `[audio]` / `[video]` / `[sticker]` | — |
| card | — | interactive |

## Agent 工具

`tools/` 目录提供 get_user、群聊、管理员、上传文件等 Tool。工具声明 `adapter: 'lark'` 后，通过惰性的 `context.$client` 自动取得当前操作的 `LarkClient`；无需把 Endpoint id 暴露给模型。

## 平台权限（platform permit）

`plugin.ts` 在 generation setup 注册 `src/platform-permit.ts` checker，并在 dispose 注销；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具权限。

## 测试

```bash
pnpm --filter @zhin.js/adapter-lark build
pnpm --filter @zhin.js/adapter-lark test
```

## 故障排查

| 现象 | 排查 |
| --- | --- |
| URL 验证失败 | 检查公网 HTTPS、`webhookPath`、verification token 与 encrypt key |
| Tenant Token 获取失败 | 检查 `appId`、`appSecret` 与应用版本是否已发布 |
| 群里 @机器人不触发 AI | 当前无法可靠判定 bot open_id；使用显式 AI 前缀 |
| 能收不能发 | 检查机器人消息权限、可见范围与应用是否已加入群聊 |

## 飞书长连接接收

`endpoints[].mode` 支持 `webhook`（兼容默认）和 `websocket`。长连接适用于企业自建飞书应用；开发者后台「事件与回调」选择「使用长连接接收事件」，订阅 `im.message.receive_v1`，启用机器人并发布到测试范围。

```yaml
mode: websocket
endpoints:
  - id: feishu-bot
    appId: ${LARK_APP_ID}
    appSecret: ${LARK_APP_SECRET}
```

长连接不注册 HTTP 路由，也不需要公网域名、`verificationToken` 或 `encryptKey`。出站仍走 OpenAPI。SDK 处理协议 ACK 和心跳；共享 `createEndpointLifecycle` 负责停止与重连，SDK 内建重连关闭。连接启动只在 SDK `onReady` 握手完成后成功，30 秒未完成则失败；运行中每秒读取 SDK 连接状态。每个 endpoint 对消息 ID 做 5 分钟去重（最多 10,000 项）；这是进程内平台重推防护，跨重启业务去重由应用自己的持久化记录负责。

启动到 generation 开放之间最多缓存 100 条消息，停止清空；超过上限会明确告警。事件处理不等待下游回复，保证 SDK ACK 不被回复链路阻塞。同应用多客户端是集群分发，不能用于验证两个 Bot 的账号隔离，应使用不同应用。

官方说明：[Node SDK 长连接](https://github.com/larksuite/node-sdk#long-connection)。长连接实现及发布 SDK 合同有本地回归；实机接收、断线恢复与平台权限仍需实际应用验收。

出站 canonical `reply` 段使用飞书原消息 `message_id` 调用正式回复接口，引用标记不作为正文发送。图片需授予 `im:resource:upload`（或平台兼容的 `im:resource`）并完成发布。上传被拒绝或缺失真实 `image_key` 时整次发送失败，不发送文字替代品以冒充图片成功；诊断仅输出数值 status/code。撤回仍走 DELETE message API，平台权限或业务拒绝会向调用方透传。

文本与图片混排、多图片使用原生 `post`，保留文本和图片的原始顺序；单图片仍使用原生图片消息。回复元数据可与 post 组合。

### 原生 Markdown、分享与按钮

Canonical `markdown` 使用飞书 `interactive` JSON 2.0 消息中的 `markdown` 组件；普通文字保留为 `plain_text`，图片上传后可放入同一张卡片。`share` 映射为标题、描述和打开 URL 的原生卡片按钮，不声称提供平台网页预览抓取。Canonical `keyboard` 按行映射为原生 action/button，回传 `value.zhin_payload`。

应用后台须启用 **card.action.trigger** 卡片回调，与消息接收使用同样的长连接或 HTTP 回调入口。适配器立即返回 ACK，不等待业务回复。回调映射真实 operator.open_id、context.open_chat_id 和 sourceMessageId，且只关联当前端点近 5 分钟内成功发送的卡片，保留原会话/线程信息。重启后未关联的旧卡片点击会丢弃；重复回调去重。仅本地 SDK/HTTP 合同与回归已验证，实机点击和权限配置仍需验收。

参考：[飞书卡片回调结构](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication)、[按钮组件](https://open.feishu.cn/document/common-capabilities/message-card/add-card-interaction/interactive-components/button)。

Markdown 单独卡片使用 JSON 2.0，以支持行内代码；v1 `lark_md` 的反引号实机显示为字面量，不能作为完整 Markdown 通过证据。当前 Markdown 与 share/keyboard 混排明确 unsupported，避免退回 v1 丢失代码样式。JSON2 行内代码仍须新的客户端实机验收，不因本地结构回归算通过。
# 长连接 TCP 故障验收

可选 `streamProxy: { port: 18443, serverName: "实际网关域名" }` 仅将 WSS TCP 路由到 `127.0.0.1`；已安装 SDK 的 WSClient `agent` 只传给 WebSocket，discovery/OpenAPI 不使用它。HTTP Host、私有 URL/query、TLS SNI 和证书链/域名校验仍为真实平台，不关闭验证；域名变化明确拒绝且只输出安全 hostname，不回退直连。Agent 随连接关闭销毁，重连仍由统一 Endpoint lifecycle 管理。

验收 example 支持进程覆盖 `LARK_STREAM_PROXY_PORT` / `LARK_STREAM_PROXY_SERVER_NAME`，需同时填写，留空正常直连。先用占位域名获取拒绝日志中的实际 gateway hostname，再启动 `scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host 实际网关域名 --upstream-port 443 --port 18443 --control-port 18444` 并将 serverName 同步为此域名。保留已有 `.env`，只在启动命令临时覆盖变量。

确认正常入站后 POST 代理 `/cut`，观察 WSS 关闭及 transportState 进入重连；POST `/recover` 后等待重新 open，再发送唯一新 probe并确认入站/可见回包。切断的仅 WSS，OpenAPI出站仍直连，不足以证明所有网络恢复、发送重试或离线消息无损。网关变化应停止并更新固定上游；完成后停止代理、移除临时覆盖。实机结果单独记录，本地 SDK/TLS 回归不当作平台通过。

### 出站 HTTP 故障边界

本地真实 HTTP 服务回归覆盖服务器收到请求后断连接、500、408、429、403 与成功 HTTP 中明确平台拒绝；每个样本只有一个消息 POST。408/5xx/丢失结果保持 unknown，平台拒绝为 rejected；不自动重发。现有 Stream 代理只用于 WSS，不能证明 API 故障。`apiBaseUrl` 能用于本地无凭据 HTTP fixture，但把真实 HTTPS 换成本地 HTTP 会改变 TLS 身份，不应这样做实机验收；保留真实身份的 API 专用 TLS 路由入口仍需独立实现。

### 飞书出站 API 受控故障代理（默认关闭）

可选 `webApiProxy: { port: 18094 }` 仅改变出站 API 的 TCP 连接地址为 `127.0.0.1`。API URL、HTTP Host 和 TLS SNI 仍为 `open.feishu.cn`，始终验证证书链与该域名；不支持配置 hostname、CA 或关闭 TLS 校验。仅允许官方 `https://open.feishu.cn/open-apis`，不改变 `apiBaseUrl`，不兼容 Larksuite origin。与长连接 `streamProxy` 独立。Endpoint 停止会销毁自身 dispatcher/连接，重启可建立新连接；没有自动发送重试。

隔离验收启动方式（不改 `.env`）：

```sh
node scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host open.feishu.cn --upstream-port 443 --port 18094 --control-port 18095
LARK_WEB_API_PROXY_PORT=18094 pnpm --filter platform-acceptance-bot start:lark
```

控制端使用工具指南的 cut/recover。恢复后发送新 probe；断线发生在 POST 接收后时结果保持 unknown，不自动重投旧样本。此入口适用于专用测试实例，不能用本地 TLS fixture 冒充真实飞书恢复。默认未配置时仍使用原有 global fetch 直连。代理使用同一依赖版本的 [undici fetch](https://github.com/nodejs/undici/blob/v6.28.0/docs/docs/api/Fetch.md) 与 dispatcher，避免 Node 内置版本的 handler 合同差异；采用 [undici 6.x Agent connect 合同](https://github.com/nodejs/undici/blob/v6.28.0/docs/docs/api/Agent.md)。
