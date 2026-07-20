---
title: "@zhin.js/adapter-qq"
package: "@zhin.js/adapter-qq"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/qq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/qq/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=e58e4fd5ffe70634 -->

# @zhin.js/adapter-qq

Zhin.js QQ 官方机器人适配器（Plugin Runtime），默认通过 **WebSocket Gateway**（`qq-official-bot`）收发消息（无需 host-router / host-http）。

## 功能

- WebSocket Gateway 入站（默认；无需公网 HTTPS / host）
- 解析私聊 / 群 / 频道消息
- 出站 `send({ target, payload })` → QQ API（`private:` / `group:` / `channel:` / `direct:`）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- Webhook / middleware 模式已实现（经 `httpHostToken` 注册 POST 路由）
- AI `@` 触发标注：群消息（GROUP_AT_MESSAGE_CREATE 仅 @ 时下发）与频道 `mentions[].bot` 会在入站 metadata 标 `mentioned: true`（新 Plugin Runtime 纯文本 content 经 metadata 传递 @）

## 安装

```bash
pnpm add @zhin.js/adapter-qq
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/qq.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **无需** `@zhin.js/host-http` / `@zhin.js/host-router`（WebSocket 路径）

入站：`gateway.receive({ adapter, target: 'group:…'|…, content, sender, metadata })`  
出站：`send({ target, payload })` → `sendPrivateMessage` / `sendGroupMessage` / `sendGuildMessage`

## 前置条件

| 要求 | 说明 |
|------|------|
| **AppID / Secret** | [QQ 开放平台](https://q.qq.com/) 创建机器人应用并获取 |
| **WebSocket（默认）** | `qq-official-bot` 正向连接；无需公网回调 |
| **host-http** | WebSocket **不需要**；Webhook / middleware 模式需要（经 `httpHostToken`） |

必填字段：`appid`、`secret`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  qq:
    name: my-qq-bot
    appid: ${QQ_APPID}
    secret: ${QQ_SECRET}
    # mode: websocket   # 默认
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-qq`（`instanceKey: qq`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `QQ_APPID` / `QQ_BOT_APPID` | 应用 AppID |
| `QQ_SECRET` / `QQ_BOT_SECRET` | 应用 Secret |
| `QQ_BOT_NAME` | 可选，默认 endpoint 名 |

## Webhook / middleware

`mode: webhook` 或 `mode: middleware` 经 `httpHostToken` 注册 POST 路由（默认 `/qq/webhook`），使用 qq-official-bot Middleware 接收器验签并入站；出站仍走 QQ HTTP API。Host 需注入 `httpHostToken`。

## AI 工具（Skill）

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具 | `agent/tools/`（频道、角色等） |
| 技能说明 | `agent/skills/qq.md` |

## 平台权限（platform permit）

platform permit checker 由 `plugin.ts` 的 generation 生命周期注册；`@zhin.js/tool` descriptor 保留 `platforms` / `scopes` / `permissions`，CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 执行门禁。

## 迁移后出站能力变化

迁移到 Plugin Runtime 后，出站统一经 `messageGatewayToken` 渲染为文本后发送（`sendPrivateMessage` / `sendGroupMessage` / `sendGuildMessage`）。旧 Adapter 的富媒体出站能力（图片 / 语音 / 视频、keyboard 按钮、markdown 模板等）暂未迁移，当前出站等价于纯文本。如需富媒体，可通过 endpoint 的 QQ API 封装或直接调用 QQ HTTP API 作为逃生舱。

## 许可证

MIT License
