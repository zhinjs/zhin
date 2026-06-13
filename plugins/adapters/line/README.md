# @zhin.js/adapter-line

Zhin.js 适配器 — LINE Messaging API (Webhook 模式)

## 功能

- 接收并解析 LINE Webhook 事件（text、image、video、audio、file、location、sticker）
- 支持私聊、群组、多人聊天（room）三种场景
- Reply API / Push API 发送消息
- HMAC-SHA256 签名验证

## 前置条件

1. 在 [LINE Developers Console](https://developers.line.biz/) 创建 Messaging API Channel
2. 获取 **Channel Secret** 和 **Channel Access Token**
3. 设置 Webhook URL 为 `https://your-domain/line/webhook`
4. 在 Console 中启用 **Use webhooks** 并关闭 **Auto-reply messages**

## 最小配置

```yaml
# zhin.config.yml
adapters:
  - context: line
    name: my-line-bot
    channelSecret: ${LINE_CHANNEL_SECRET}
    channelAccessToken: ${LINE_CHANNEL_ACCESS_TOKEN}
    webhookPath: /line/webhook       # 可选，默认 /line/webhook
    apiBaseUrl: https://api.line.me   # 可选，调试时可改为 LINE API 沙盒地址
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `LINE_CHANNEL_SECRET` | Channel Secret（签名验证用） |
| `LINE_CHANNEL_ACCESS_TOKEN` | Long-lived Channel Access Token（API 调用用） |

## Webhook URL 配置

LINE 要求 Webhook URL 以 HTTPS 开头。常见方案：

- **反向代理**：Nginx/Caddy 将 `https://your-domain/line/webhook` 转发到本地 zhIn 端口
- **Cloudflare Tunnel**：`cloudflared tunnel --url http://localhost:端口`
- **ngrok**：调试用 `ngrok http 端口`

设置完成后在 LINE Developers Console 点击 **Verify** 验证连通性。

## 消息类型映射

| LINE 类型 | Zhin.js Segment | 说明 |
|-----------|----------------|------|
| text | text | 纯文本 |
| image | image | 图片（暂不支持二次获取） |
| video | video | 视频 |
| audio | audio | 音频 |
| file | file | 文件 |
| location | location | 位置信息 |
| sticker | sticker | 贴纸 |

## 已知限制

- **不支持消息撤回**：LINE Messaging API 不提供撤回已发送消息的接口
- **图片/视频/音频**：收到的媒体消息仅包含 message_id，需通过 Content API 下载（未实装）
- **单次最多 5 条消息**：LINE 限制单次 Reply/Push 最多 5 条
- **文本长度限制**：单条文本消息最多 5000 字符

## 故障排查

| 问题 | 排查方法 |
|------|---------|
| Webhook Verify 失败 | 检查 HTTPS 证书、域名解析、端口是否可达 |
| 签名验证 403 | 确认 Channel Secret 与 Console 一致 |
| 发送 401 | 确认 Channel Access Token 未过期 |
| 发送 400 | 检查消息格式是否符合 LINE API 规范 |
| 事件未到达 | Console 中 Webhook 是否已启用、是否关闭 Auto-reply |
