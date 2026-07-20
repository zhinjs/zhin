---
title: "@zhin.js/adapter-slack"
package: "@zhin.js/adapter-slack"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/slack/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/slack/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=dd8696ff943fd609 -->

# @zhin.js/adapter-slack

Zhin.js Slack 适配器（Plugin Runtime），优先 Socket Mode，也可经 Runtime Host HTTP Events API 收发消息。

## 功能

- **Socket Mode**（默认）：WebSocket 长连接，无需公网 URL
- **HTTP Events API**：`httpHostToken` POST（签名验证），**非** legacy host-router/Koa
- 入站经 `messageGatewayToken`；出站 `send({ target, payload })` → `chat.postMessage` / Block Kit
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Block Kit 按钮、斜杠命令、消息编辑、表情反应等（见 `agent/tools/`）

## 安装

```bash
pnpm add @zhin.js/adapter-slack
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/slack.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/host-http` — 仅 HTTP 模式需要 `httpHostToken` 注册 Events 路由
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: channelId, content: text, sender, metadata })`  
出站：`send({ target, payload })` → Web API（`target` 可为 `channel` 或 `channel:thread_ts`）

### 平台权限（platform permit）

- `plugin.ts` 已注册 checker，Runtime Tool 权限统一经 Core `canAccessTool()`；当前 Slack 入站没有可靠 sender role 时，受限工具按 fail-closed 拒绝，不会静默放行。

## 模式对比

| 模式 | `socketMode` | 适用场景 | 额外字段 |
|------|--------------|----------|----------|
| **Socket Mode**（默认） | `true` | 本地/内网，无需公网 URL | `appToken`（`xapp-...`） |
| **HTTP Events** | `false` | 生产环境有公网 HTTPS | `signingSecret` + Runtime Host |

## 最小配置（Socket Mode）

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  slack:
    name: my-slack-bot
    token: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    socketMode: true          # 默认 true，可省略
```

## HTTP Events 配置

```yaml
plugins:
  slack:
    name: my-slack-bot
    token: ${SLACK_BOT_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    socketMode: false
    webhookPath: /slack/events   # 可选，默认 /slack/events
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-slack`（`instanceKey: slack`）。  
HTTP 模式下 Runtime Host（`http`）须已 listen；Slack App 的 Event Subscriptions / Interactivity / Slash Commands Request URL 指向 `https://your-domain/slack/events`。

## 环境变量

| 变量 | 说明 |
|------|------|
| `SLACK_BOT_TOKEN` / `SLACK_TOKEN` | Bot User OAuth Token（`xoxb-...`） |
| `SLACK_APP_TOKEN` | App-Level Token（Socket Mode，`xapp-...`） |
| `SLACK_SIGNING_SECRET` | Signing Secret（HTTP 模式） |
| `SLACK_BOT_NAME` | 可选 endpoint 名称 |

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
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具 | `agent/tools/`（邀请、话题、反应、置顶、编辑等） |
| 技能说明 | `agent/skills/slack.md` |

## 限制

- 入站 mrkdwn → Markdown 为启发式转换
- Modals / Select menus — 暂不支持
- OAuth 安装流程 — 暂不支持
- 旧 `usePlugin` / `extends Adapter` / host-router 生产入口已删除

## 许可证

MIT
