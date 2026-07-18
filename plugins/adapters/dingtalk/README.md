# @zhin.js/adapter-dingtalk

Zhin.js 钉钉适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` POST + HMAC-SHA256 签名验证）
- Access Token 自动刷新
- Session Webhook 优先回复 / `/robot/send` 主动发送
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-dingtalk
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式薄入口 `adapters/dingtalk.ts`（`defineAdapter`）
- 实现：`src/endpoint.ts`（生命周期/出站/OpenAPI）、`src/webhook.ts`（验签入站）、`src/protocol.ts`
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: conversationId, content: text, sender, metadata })`  
出站：`send({ target, payload })` → sessionWebhook 或 `/robot/send`

## 前置条件

1. 在 [钉钉开放平台](https://open.dingtalk.com/) 创建企业内部应用 / 机器人
2. 获取 **AppKey**、**AppSecret**（可选 RobotCode）
3. 设置消息接收 URL 为 `https://your-domain/dingtalk/webhook`
4. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段：`appKey`、`appSecret`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  dingtalk:
    name: my-dingtalk-bot
    appKey: ${DINGTALK_APP_KEY}
    appSecret: ${DINGTALK_APP_SECRET}
    robotCode: ${DINGTALK_ROBOT_CODE}   # 可选
    webhookPath: /dingtalk/webhook       # 可选，默认 /dingtalk/webhook
    apiBaseUrl: https://oapi.dingtalk.com # 可选
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-dingtalk`（`instanceKey: dingtalk`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DINGTALK_APP_KEY` | 应用 AppKey |
| `DINGTALK_APP_SECRET` | 应用 AppSecret |
| `DINGTALK_BOT_NAME` | 默认 endpoint 名称（可选） |

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

`agent/` 目录保留（get_user、部门、群聊、工作通知等）。Endpoint 在 `start` 时自注册到 `dingtalk-agent-deps`。

## 平台权限（platform permit）

`src/platform-permit.ts` 的 checker 保留并从 `src/index.ts` 导出，`plugin.ts` 暂无注册点；新 Runtime Tool 链路（`@zhin.js/tool` / capability-ingress）亦不消费 `permissions` / permit 声明，待工具权限模型定义后接线。`agent/tools` 中的 `platformPermit(...)` 声明目前不产生门禁效果。

## 测试

```bash
pnpm --filter @zhin.js/adapter-dingtalk build
pnpm --filter @zhin.js/adapter-dingtalk test
```
