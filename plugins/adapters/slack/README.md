# @zhin.js/adapter-slack

Zhin.js Slack 适配器（Plugin Runtime），优先 Socket Mode，也可经 Runtime Host HTTP Events API 收发消息。

## 功能

- **Socket Mode**（默认）：WebSocket 长连接，无需公网 URL
- **HTTP Events API**：`httpHostToken` POST（签名验证），**非** legacy host-router/Koa
- 入站经 `Endpoint.emit(...)`；出站 `send({ conversation, payload })` → `chat.postMessage` / Block Kit
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Block Kit 按钮、斜杠命令、消息编辑、表情反应等（见 `tools/`）

## 安装

```bash
pnpm add @zhin.js/adapter-slack
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/slack/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — 仅 HTTP 模式需要 `httpHostToken` 注册 Events 路由
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation, message: { conversation, id }, content: text, sender, metadata })`（`conversation` 为 ConversationRef：`channel_type: im` → kind `private`，其余 → kind `group`；线程根 ts 进 `threadId`）  
出站：`send({ conversation, payload })` → Web API（`conversation.id` 为 channel，`conversation.threadId` 为 thread_ts）

### 平台权限（platform permit）

- `plugin.ts` 已注册 checker，Runtime Tool 权限统一经 Core `canAccessTool()`；当前 Slack 入站没有可靠 sender role 时，受限工具按 fail-closed 拒绝，不会静默放行。

## 模式对比

| 模式 | `socketMode` | 适用场景 | 额外字段 |
|------|--------------|----------|----------|
| **Socket Mode**（默认） | `true` | 本地/内网，无需公网 URL | `appToken`（`xapp-...`） |
| **HTTP Events** | `false` | 生产环境有公网 HTTPS | `signingSecret` + Runtime Host |

## 前置条件

1. 创建 Slack App，安装到 Workspace，并授予收发消息所需 OAuth scopes。
2. Socket Mode 创建 `connections:write` App-Level Token；HTTP 模式配置 Signing Secret 与 Events URL。
3. 订阅需要的 bot events，并把应用加入目标频道。

## 最小配置（Socket Mode）

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  slack:
    socketMode: true          # 默认 true，可省略
    endpoints:
      - id: my-slack-bot
        token: ${SLACK_BOT_TOKEN}
        appToken: ${SLACK_APP_TOKEN}
```

多 workspace：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`id` 必填）：

```yaml
plugins:
  slack:
    endpoints:
      - id: team-a
        token: ${SLACK_BOT_TOKEN_A}
        appToken: ${SLACK_APP_TOKEN_A}
      - id: team-b
        token: ${SLACK_BOT_TOKEN_B}
        appToken: ${SLACK_APP_TOKEN_B}
```

## HTTP Events 配置

```yaml
plugins:
  slack:
    socketMode: false
    webhookPath: /slack/events   # 可选，默认 /slack/events
    endpoints:
      - id: my-slack-bot
        token: ${SLACK_BOT_TOKEN}
        signingSecret: ${SLACK_SIGNING_SECRET}
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-slack`（`instanceKey: slack`）。  
HTTP 模式下 Runtime Host（`http`）须已 listen；Slack App 的 Event Subscriptions / Interactivity / Slash Commands Request URL 指向 `https://your-domain/slack/events`。

## 环境变量

| 变量 | 说明 |
|------|------|
| `SLACK_BOT_TOKEN` | 示例中由 YAML `${SLACK_BOT_TOKEN}` 引用的 Bot User OAuth Token；变量名可自行定义 |
| `SLACK_APP_TOKEN` | 示例中由 YAML `${SLACK_APP_TOKEN}` 引用的 App-Level Token；变量名可自行定义 |
| `SLACK_SIGNING_SECRET` | 示例中由 YAML `${SLACK_SIGNING_SECRET}` 引用的 Signing Secret；变量名可自行定义 |

## 消息格式

### 出站（Markdown → mrkdwn）

通用 Markdown（如 `**粗体**`）会转换为 Slack mrkdwn，并通过 Block Kit `section` 发送。

### 入站（mrkdwn → Markdown）

| Slack mrkdwn | 通用 Markdown |
|--------------|---------------|
| `*bold*` | `**bold**` |
| `_italic_` | `*italic*` |
| `~strike~` | `~~strike~~` |
| `<url\|text>` | `[text](url)` |

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `PERMITS.md` |
| 平台工具 | `tools/`（邀请、话题、反应、置顶、编辑等） |
| 技能说明 | `agents/slack/skills/slack-channels/SKILL.md`、`agents/slack/skills/slack-messages/SKILL.md` |

## 限制

- 入站 mrkdwn → Markdown 为启发式转换
- Modals / Select menus — 暂不支持
- OAuth 安装流程 — 暂不支持
- 旧 `usePlugin` / `extends Adapter` / host-router 生产入口已删除

## 故障排查

| 现象 | 排查 |
| --- | --- |
| Socket Mode 无法连接 | 检查 `xapp-` Token、Socket Mode 与 `connections:write` scope |
| HTTP Events 返回 401 | 检查 Signing Secret、原始请求体、服务器时钟与反向代理 |
| 频道消息未触发 | 确认事件订阅、OAuth scopes，并邀请 App 进入频道 |
| 线程回复跑到主频道 | 检查入站 `thread_ts` 是否保留为 Conversation `threadId` |

## 许可证

MIT

## 发送失败与回执

成功发送返回平台 `ts` 组成的消息引用，不以本地时间替代缺失回执。
文件上传失败会让本次发送失败；分段消息中某段缺少有效回执时，停止后续分段。
前面已成功的文件或分段不会自动回滚；发送失败可能表示部分已送达，请先核对目标会话再重试。
# Socket Mode 可控断线验收

`streamProxy: { port: 18443, serverName: "实际网关域名" }` 使用 SDK 合法 `clientOptions.agent`。配置网关的 WSS 仅改 TCP 路由为 `127.0.0.1:18443`，保留真实 URL、Host、TLS SNI、证书链和域名校验。SDK 的 discovery API 仍用标准 HTTPS Agent 直连 `slack.com`；其他网关及 WebSocket Upgrade 到 API 域名均明确拒绝，不绕代理。日志仅包含安全 hostname，不打印完整 URL/query/token。

验收项目通过 `SLACK_STREAM_PROXY_PORT` / `SLACK_STREAM_PROXY_SERVER_NAME` 进程变量临时覆盖，需同时填写，留空直连。未知域名可先设占位值，从拒绝日志获取真实 hostname，再启动 `scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host 实际网关域名 --upstream-port 443 --port 18443 --control-port 18444`；将 serverName 同步为此域名。不要覆盖已有 `.env`。平台更换动态网关时停止验收并更新固定上游，不能直连继续取恢复证据。

Socket SDK 的自动重连已关闭；start/stop/reconnect 由统一 Endpoint lifecycle 管理，SDK 保留协议心跳。断线销毁当前 Agent/Socket，重连新建实例；旧实例回调不进入消息链，stop 取消待重连。可观察 Endpoint `transportState` 的 open/重连/stopped。

先验证正常消息，再 POST 代理 `/cut`，观察 Socket 关闭和生命周期退出 open；POST `/recover`，观察新连接 open，再发送唯一新 probe 验证真实入站及可见回复。切断只覆盖 Socket 入站，普通 Web API 出站仍直连，不代表所有网络恢复或离线消息无损。完成后停止代理、移除临时覆盖。实际 SDK 的本地 TLS/hello 握手、断线恢复与防绕过回归通过，真实平台结果另记。

### 出站失败与重试边界

默认 WebClient 禁用 SDK 网络/5xx 自动重试，并以 `rejectRateLimitedCalls: true` 返回 429，不在后台排队重发。平台明确返回拒绝记为 rejected；连接中断、408、5xx、缺少真实时间戳记为 unknown，调用者不得把 unknown 当成“未发送”盲目重试。实机 WSS 故障代理只控制入站长连接，不能作为 Web API 故障证据。本地真实 SDK HTTP fixture 已验证每种故障只出现一个 POST；不代表真实租户已通过。

SDK 官方选项依据：[Slack Web API 文档](https://docs.slack.dev/tools/node-slack-sdk/web-api/)。若需 API 专用故障入口，应在专用测试实例 WebClient 的正式 `agent` 选项注入固定 loopback TCP 路由，保留真实 slack.com URL、SNI 和证书校验；验收项目现提供独立 `webApiProxy` / `SLACK_WEB_API_PROXY_PORT`，不能用 WSS proxy 冒充 API proxy。

### 专用 Web API 故障入口

可选 endpoint `webApiProxy: { port: 18560 }` 仅作用于该实例的 JSON Web API 客户端。目的地固定 `slack.com:443`，真实 HTTPS URL/SNI/证书校验保留，TCP 只路由到 `127.0.0.1:18560`；错误域名拒绝、不回退直连。默认关闭，与 Socket `streamProxy` 独立；SocketModeClient 的连接发现和 WSS 不走此代理。停止 endpoint 会销毁专用 agent。上传使用其他域名，此专用代理明确拒绝，故只用于 JSON消息/引用/按钮/链接探针，不据此验收文件上传。

使用现有透明TCP故障代理：

```bash
node scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host slack.com --upstream-port 443 --port 18560 --control-port 18561
SLACK_WEB_API_PROXY_PORT=18560 pnpm --filter platform-acceptance-bot dev:slack
```

启动代理 forwarding 后先发新的 `/acceptance probe:slack-api-baseline`，确认真实回执；control `POST /cut` 只切 API TCP，WSS保持连接，再发独立新样本并确认报告 unknown且无后台重发。`POST /recover` 后先确认旧样本没有补发，再发新样本验证恢复。每个未知样本都保留并检查平台可见消息；禁止因为 unknown 重发同一业务。TCP cut 发生在请求前不能证明“平台已接收但回执丢失”，这一情况已有本地 TLS fixture 在服务收到 POST 后切断覆盖，实机未单独证明。
