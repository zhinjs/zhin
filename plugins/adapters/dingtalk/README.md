# @zhin.js/adapter-dingtalk

Zhin.js 钉钉适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` POST + HMAC-SHA256 签名验证）
- Access Token 自动刷新
- Session Webhook 优先回复 / `/robot/send` 主动发送
- canonical `markdown` 段编码为钉钉原生 `msgtype: markdown`
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-dingtalk
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式薄入口 `adapters/dingtalk.ts`（`defineAdapter`）
- 实现：`src/endpoint.ts`（生命周期/出站/OpenAPI）、`src/webhook.ts`（验签入站）、`src/protocol.ts`
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation: ConversationRef, message: { conversation, id }, content: text, sender, metadata })`  
出站：`send({ conversation, payload })` → sessionWebhook 或 `/robot/send`

## 前置条件

1. 在 [钉钉开放平台](https://open.dingtalk.com/) 创建企业内部应用 / 机器人
2. 获取 **AppKey**、**AppSecret**（可选 RobotCode）
3. 设置消息接收 URL 为 `https://your-domain/dingtalk/webhook`
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段（`endpoints[i]`）：`name`、`appKey`、`appSecret`、`webhookPath`、`robotCode`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  dingtalk:
    apiBaseUrl: https://oapi.dingtalk.com # 可选，顶层共享
    endpoints:
      - name: my-dingtalk-bot
        appKey: ${DINGTALK_APP_KEY}
        appSecret: ${DINGTALK_APP_SECRET}
        robotCode: ${DINGTALK_ROBOT_CODE}
        webhookPath: /dingtalk/webhook   # 可选，默认 /dingtalk/webhook
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-dingtalk`（`instanceKey: dingtalk`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DINGTALK_APP_KEY` | 应用 AppKey |
| `DINGTALK_APP_SECRET` | 应用 AppSecret |
| `DINGTALK_ROBOT_CODE` | RobotCode（主动发送 `/robot/send`） |

## 消息类型映射

| 钉钉类型 | 入站 content（文本摘要） | 出站 wire |
|----------|--------------------------|-----------|
| text | 原文 | text |
| picture | `[image]` | picture（需 `url`） |
| file | `[file: name]` | — |
| audio / video | `[audio]` / `[video]` | — |
| markdown | 原文或 `[markdown]` | markdown |
| link | — | link |

## Agent 工具

`agent/` 目录保留（get_user、部门、群聊、工作通知等）。工具声明 `adapter: 'dingtalk'` 后，通过惰性的 `context.$client` 自动取得当前操作的 `DingTalkClient`；无需把 Endpoint id 暴露给模型。

## 平台权限（platform permit）

`plugin.ts` 在 generation setup 注册 `src/platform-permit.ts` checker，并在 dispose 注销；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具权限。

## 测试

```bash
pnpm --filter @zhin.js/adapter-dingtalk build
pnpm --filter @zhin.js/adapter-dingtalk test
```

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 平台校验 URL 失败 | 确认公网 HTTPS 可达，HTTP Host 已监听，路径与 `webhookPath` 一致 |
| Webhook 返回 401/403 | 检查 `appSecret`、签名时间戳与服务器时钟 |
| 能收到但无法回复 | 检查 `robotCode`、应用权限与 session webhook 是否有效 |
| Endpoint 未出现 | 在日志查 Schema 或凭据错误，再到运行时能力核对 Endpoint |
