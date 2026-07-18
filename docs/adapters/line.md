---
title: "@zhin.js/adapter-line"
package: "@zhin.js/adapter-line"
tier: Experimental
---

::: info 文档同步
本页由 [`plugins/adapters/line/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/line/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=2bec57d24652cd0e -->

# @zhin.js/adapter-line

Zhin.js LINE Messaging API 适配器（Plugin Runtime），通过 Runtime Host HTTP Webhook 收发消息。

## 功能

- Webhook 事件接收（`httpHostToken` POST + HMAC-SHA256 签名验证）
- 解析 text / image / video / audio / file / location / sticker
- 支持私聊、群组、多人聊天（room）
- Reply API（有 replyToken 时）/ Push API 发送
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-line
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/line.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — `httpHostToken` 注册 Webhook 路由（**非** legacy host-router/Koa）
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: channelId, content: text, sender, metadata })`  
出站：`send({ target, payload })` → Reply API（缓存 replyToken）或 Push API

## 前置条件

1. 在 [LINE Developers Console](https://developers.line.biz/) 创建 Messaging API Channel
2. 获取 **Channel Secret** 和 **Channel Access Token**
3. 设置 Webhook URL 为 `https://your-domain/line/webhook`
4. 在 Console 中启用 **Use webhooks** 并关闭 **Auto-reply messages**
5. Runtime Host（`http`）须已 listen，Webhook 才可达

必填字段：`channelSecret`、`channelAccessToken`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  line:
    name: my-line-bot
    channelSecret: ${LINE_CHANNEL_SECRET}
    channelAccessToken: ${LINE_CHANNEL_ACCESS_TOKEN}
    webhookPath: /line/webhook       # 可选，默认 /line/webhook
    apiBaseUrl: https://api.line.me   # 可选，调试时可改为 LINE API 沙盒地址
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-line`（`instanceKey: line`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `LINE_CHANNEL_SECRET` | Channel Secret（签名验证用） |
| `LINE_CHANNEL_ACCESS_TOKEN` | Long-lived Channel Access Token（API 调用用） |

## Webhook URL 配置

LINE 要求 Webhook URL 以 HTTPS 开头。常见方案：

- **反向代理**：Nginx/Caddy 将 `https://your-domain/line/webhook` 转发到本地 zhin 端口
- **Cloudflare Tunnel**：`cloudflared tunnel --url http://localhost:端口`
- **ngrok**：调试用 `ngrok http 端口`

设置完成后在 LINE Developers Console 点击 **Verify** 验证连通性。

## 消息类型映射

| LINE 类型 | 入站 content（文本摘要） | 出站 wire |
|-----------|--------------------------|-----------|
| text | 原文 | text |
| image | `[image]` | image（需 `url`） |
| video | `[video]` | video（需 `url`） |
| audio | `[audio]` | audio（需 `url`） |
| file | `[file: name]` | — |
| location | address 或坐标 | location |
| sticker | `[sticker: pkg/id]` | sticker |

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具（2 个） | `agent/tools/`（`line_get_profile`、`line_get_group_members`） |
| 技能说明 | `agent/skills/line.md` |

## 已知限制

- **不支持消息撤回**：LINE Messaging API 不提供撤回已发送消息的接口
- **图片/视频/音频**：收到的媒体消息仅包含 message_id，需通过 Content API 下载（未实装）
- **单次最多 5 条消息**：LINE 限制单次 Reply/Push 最多 5 条
- **文本长度限制**：单条文本消息最多 5000 字符

## 故障排查

| 问题 | 排查方法 |
|------|---------|
| Webhook Verify 失败 | 检查 HTTPS 证书、域名解析、端口是否可达；确认 host-http 已 listen |
| 签名验证 403 | 确认 Channel Secret 与 Console 一致 |
| 发送 401 | 确认 Channel Access Token 未过期 |
| 发送 400 | 检查消息格式是否符合 LINE API 规范 |
| 事件未到达 | Console 中 Webhook 是否已启用、是否关闭 Auto-reply |
