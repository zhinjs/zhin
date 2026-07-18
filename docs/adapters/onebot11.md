---
title: "@zhin.js/adapter-onebot11"
package: "@zhin.js/adapter-onebot11"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/onebot11/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot11/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=12bfa27ac8586bca -->

# @zhin.js/adapter-onebot11

Zhin.js [OneBot 11](https://github.com/botuniverse/onebot-11) 适配器（Plugin Runtime）。生产路径为正向 WebSocket 客户端（`connection: ws`）；亦支持反向 WS（`connection: wss`，经 `httpHostToken`）。

## 功能特性

- [OneBot 11 标准](https://github.com/botuniverse/onebot-11) 兼容（事件 + 动作）
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 OneBot 实现的 WS 服务器
- `access_token` 鉴权（Bearer + query）
- 入站经 `messageGatewayToken`；出站 `send({ target, payload })`

## 安装

```bash
pnpm add @zhin.js/adapter-onebot11
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/onebot11.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: "private:uid"|"group:gid", content, sender, metadata })`  
出站：`send({ target, payload })` → WS `send_private_msg` / `send_group_msg`（payload 已由 gateway/core 渲染；无 segment-mapper）

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  onebot11:
    connection: ws
    name: ob11-bot
    url: "ws://127.0.0.1:6700"
    access_token: "${ONEBOT11_ACCESS_TOKEN}"
    reconnect_interval: 5000
    heartbeat_interval: 30000
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-onebot11`（`instanceKey: onebot11`）。

## 连接方式

| connection | 状态 |
|------------|----------------|
| `ws` | 已实现（推荐） |
| `wss` | 已实现：反向 WS（`httpHostToken`） |

## 鉴权

- **Bearer**：`Authorization: Bearer <access_token>`
- 正向 WS 在 Upgrade 时附带请求头，并在 URL query 写入 `access_token`

## 动作与事件

- 事件：`post_type`（message/notice/request/meta_event）、`message_type`、`message` 等
- 动作：`send_private_msg`、`send_group_msg`、`delete_msg`、`set_group_special_title` 等

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具 | `agent/tools/set_title.ts` → `onebot11_set_title` |
| 技能说明 | `agent/skills/onebot11.md` |

## 迁移说明（Plugin Runtime）

- **notice / request 侧事件已移除**：旧 Adapter 对 `post_type: notice|request` 构建 `notice.receive` / `request.receive` 事件；新 Plugin Runtime（`messageGatewayToken`）暂无侧事件总线，入站仅处理 `post_type: message`，notice / request 事件静默丢弃。
- **群管工具暂未迁移**：旧 Adapter 经 `createSceneManagementTools` 注册踢人 / 禁言 / 群名片等成套 agent 工具；迁移后仅保留 `onebot11_set_title`，其余群管能力可通过 `callApi`（如 `set_group_kick`、`set_group_ban`）作为逃生舱调用。
- **平台权限门禁**：`plugin.ts` setup 已注册 `registerDefaultScenePlatformPermitChecker('onebot11')`，`scene_admin` / `scene_owner` 依据入站 metadata 中的 sender `role`（owner / admin）判定。

## 文档链接

- [OneBot 11 标准](https://github.com/botuniverse/onebot-11)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 许可证

MIT License
