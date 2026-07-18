---
title: "@zhin.js/adapter-telegram"
package: "@zhin.js/adapter-telegram"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/telegram/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/telegram/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=a604b45850d89b3a -->

# @zhin.js/adapter-telegram

Zhin.js Telegram Bot API 适配器（Plugin Runtime），默认通过 **长轮询 `getUpdates`** 收发消息（无需 host）。

## 功能

- 长轮询 `getUpdates` 入站（默认；无需公网 IP / host-http）
- 解析 text / image / video / audio / voice / document / sticker / location / callback_query
- 支持私聊与群组
- 出站 `send({ target, payload })` → Bot API（text / media / keyboard）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Webhook 模式延期（需 `httpHostToken`）；配置 `polling: false` 会明确报错

## 安装

```bash
pnpm add @zhin.js/adapter-telegram
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/telegram.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **无需** `@zhin.js/host-http`（polling 路径）

入站：`gateway.receive({ adapter, target: chatId, content: text, sender, metadata })`  
出站：`send({ target, payload })` → Telegram Bot API

### 平台权限（platform permit）

- sender role 已恢复：群消息入站时经 `getChatMember`（60s 缓存）解析，写入 `metadata.senderRole` / `metadata.senderPermissions`。
- **TODO**：`registerTelegramPlatformPermitChecker()` 暂无注册点——Plugin Runtime 的命令分发没有 platform permit 消费端（旧 checker 只服务于 legacy Tool/Message 门禁），待 runtime 提供门禁挂钩后再在 `plugin.ts` 接线。`src/platform-permit.ts` 的 checker 与单测保留。

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | 通过 [@BotFather](https://t.me/botfather) 创建并获取 Token |
| **Polling（默认）** | 本地/生产均可；主动拉取更新，无需公网 HTTPS |
| **网络** | 出站可访问 `api.telegram.org` |
| **host-http** | Polling **不需要**；Webhook 延期至下一棒 |

必填字段：`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  telegram:
    name: my-telegram-bot
    token: ${TELEGRAM_TOKEN}
    # polling: true   # 默认
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-telegram`（`instanceKey: telegram`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `TELEGRAM_TOKEN` / `TELEGRAM_BOT_TOKEN` | Bot Token |
| `TELEGRAM_BOT_NAME` | 可选，默认 endpoint 名 |

## Webhook（延期）

`polling: false` + `webhook` 目前会抛出明确错误：

> Telegram webhook mode is deferred until httpHostToken wiring; use polling: true (default) for now

下一棒将用 `httpHostToken` 注册 POST 路由，不再使用 Telegraf 自建监听或 legacy host-router。

## 消息类型映射

| Telegram | 入站 content（文本摘要） | 出站 wire |
|----------|--------------------------|-----------|
| text | 原文 | sendMessage |
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
| Webhook 配置报错 | 当前仅支持 polling；去掉 `polling: false` |
| 发送失败 | Token 是否被撤销；查看 Bot API 错误描述 |

## Documentation

- [Telegram adapter on zhin.js.org](https://zhin.js.org/adapters/telegram)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT
