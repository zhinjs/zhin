---
title: "@zhin.js/adapter-telegram"
package: "@zhin.js/adapter-telegram"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/telegram/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/telegram/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=7e3ec215bf2fd57a -->

# @zhin.js/adapter-telegram

Zhin.js Telegram Bot API 适配器（Plugin Runtime），默认通过 **长轮询 `getUpdates`** 收发消息（无需 host）。

## 功能

- 长轮询 `getUpdates` 入站（默认；无需公网 IP / host-http）
- 解析 text / image / video / audio / voice / document / sticker / location / callback_query
- 支持私聊与群组
- 出站 `send({ conversation, payload })` → Bot API（Markdown→安全 HTML / media / keyboard）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Webhook 模式通过 `httpHostToken` 注册回调路由，支持 secretToken 校验

## 安装

```bash
pnpm add @zhin.js/adapter-telegram
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/telegram.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **无需** `@zhin.js/host-http`（polling 路径）

入站：`gateway.receive({ conversation, message, content, sender, metadata })`（`conversation` 为 ConversationRef，由 `telegramInboundConversation` 归一化）  
出站：`send({ conversation, payload })` → Telegram Bot API

### 平台权限（platform permit）

- sender role 已恢复：群消息入站时经 `getChatMember`（60s 缓存）解析，写入 `metadata.senderRole` / `metadata.senderPermissions`。
- `plugin.ts` 在 generation setup 注册 checker，并在 dispose 注销；Plugin Runtime CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费 `permissions`。

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | 通过 [@BotFather](https://t.me/botfather) 创建并获取 Token |
| **Polling（默认）** | 本地/生产均可；主动拉取更新，无需公网 HTTPS |
| **网络** | 出站可访问 `api.telegram.org` |
| **host-http** | Polling **不需要**；Webhook **需要** CLI HTTP Host |

必填字段（`endpoints[i]`）：`id`、`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  telegram:
    # polling: true   # 默认
    endpoints:
      - id: my-telegram-bot
        token: ${TELEGRAM_TOKEN}
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-telegram`（`instanceKey: telegram`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_TOKEN` / `TELEGRAM_BOT_TOKEN` | Bot Token |
| `TELEGRAM_BOT_NAME` | 可选，默认 endpoint 名 |

## Webhook

配置 `polling: false`，启用 CLI HTTP Host，并提供公网 HTTPS 回调地址。
`webhook.path` 必须与反向代理转发路径一致，多账号使用不同路径。

```yaml
http:
  host: 127.0.0.1
  port: 8086
plugins:
  telegram:
    polling: false
    endpoints:
      - id: my-telegram-bot
        token: ${TELEGRAM_TOKEN}
    webhook:
      domain: https://bot.example.com
      path: /telegram/webhook
      secretToken: ${TELEGRAM_WEBHOOK_SECRET}
```

启动时注册 Host 路由并调用 `setWebhook`；停止时释放路由。
配置 `secretToken` 后，回调须携带匹配的 `X-Telegram-Bot-Api-Secret-Token`，否则返回 403。

## 稳定化范围

当前为 **Advanced / 首批升档候选**，完整适配器测试已纳入 `pnpm check:stable`。
长轮询停止会中止请求与退避；即使传输层在中止后返回更新，也不会派发或推进 offset。
轮询 offset 仅保存在当前 Endpoint 内存中，不承诺跨重启去重或业务处理恰好一次。
Webhook 接收确认不等于业务处理完成；需要幂等性的业务应自行持久化去重。
详见[平台稳定验收](https://github.com/zhinjs/zhin/blob/main/docs/contributing/platform-acceptance.md)。

## 消息类型映射

| Telegram | 入站 content（文本摘要） | 出站 wire |
|----------|--------------------------|-----------|
| text | 原文 | sendMessage |
| markdown | 原文 | sendMessage（`parse_mode: HTML`） |
| photo | `[image]` / caption | sendPhoto（`file_id` / `url`） |
| video | `[video]` | sendVideo |
| audio / voice | `[audio]` / `[voice]` | sendAudio / sendVoice |
| document | `[file: name]` | sendDocument |
| sticker | `[sticker: …]` | sendSticker |
| location | `[location: lat,lon]` | sendLocation |
| callback_query | `[action: data]` | — |

## AI tools

| Kind | Path |
|------|------|
| Platform tools (10) | `agent/tools/`（invite / pin / admins / sticker / poll 等） |
| Skill doc | `agent/skills/telegram.md` |

## 故障排查

| 现象 | 排查 |
|------|------|
| 收不到消息 | Token 是否正确；进程已 `open()`；同一 Token 勿多进程同时 polling |
| Polling 报错 | 检查能否访问 `api.telegram.org`；查看日志 `op: poll` |
| Webhook 配置报错 | 检查 HTTP Host、公网 HTTPS、反向代理路径与 secretToken |
| 发送失败 | Token 是否被撤销；查看 Bot API 错误描述 |

## Documentation

- [Telegram adapter on zhin.js.org](https://zhin.js.org/adapters/telegram)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT
