# @zhin.js/adapter-napcat

Zhin.js [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 适配器（Plugin Runtime，OneBot 11 + NapCat 扩展）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **反向 WS** 与 **HTTP POST 上报**（经 `httpHostToken`）。

## 功能特性

- OneBot 11 + go-cqhttp 扩展 + NapCat 独有 API
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 NapCat WS
- `access_token` 鉴权（Bearer + query）
- 入站经 `messageGatewayToken`（去重 + 自发过滤）；出站 `send({ target, payload })`
- 41 个 AI 工具（`agent/tools/`）

## 安装

```bash
pnpm add @zhin.js/adapter-napcat
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/napcat.ts`（`defineAdapter`）
- `@zhin.js/core` — `messageGatewayToken` 入站/出站
- `@zhin.js/plugin-runtime` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ adapter, target: "private:uid"|"group:gid", content, sender, metadata })`  
出站：`send({ target, payload })` → WS `send_private_msg` / `send_group_msg`

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  napcat:
    connection: ws
    reconnect_interval: 5000
    heartbeat_interval: 30000
    endpoints:
      - name: my-bot
        url: "ws://127.0.0.1:3001"
        access_token: "${NAPCAT_TOKEN}"
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-napcat`（`instanceKey: napcat`）。

## 连接方式

| connection | 状态 |
|------------|------|
| `ws` | 已实现（推荐） |
| `wss` | 已实现：反向 WS（httpHostToken） |
| `http` | 已实现：POST 入站 + `http_url/{action}` 出站 |

## 鉴权

- **Bearer**：`Authorization: Bearer <access_token>`
- 正向 WS 在 Upgrade 时附带请求头，并在 URL query 写入 `access_token`

## AI 工具

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `agent/PERMITS.md` |
| 平台工具 | `agent/tools/*.ts` |
| 技能说明 | `agent/skills/napcat.md` |

## 迁移说明（Plugin Runtime）

- **notice / request 侧事件已移除**：旧 Adapter 对 `post_type: notice|request` 构建 `notice.receive` / `request.receive` 事件（含 `$approve` / `$reject`）；新 Plugin Runtime（`messageGatewayToken`）暂无侧事件总线，入站仅处理 `post_type: message`，notice / request 事件静默丢弃。加好友 / 加群请求审批可改用 `callApi('set_friend_add_request' | 'set_group_add_request')`。
- **群管工具暂未迁移**：旧 Adapter 经 `createSceneManagementTools` 注册踢人 / 禁言 / 群名片等成套 agent 工具；迁移后 `agent/tools/` 仅覆盖 NapCat 扩展 API，其余群管能力可通过 `callApi`（如 `set_group_kick`、`set_group_ban`）作为逃生舱调用。
- **平台权限门禁**：`plugin.ts` setup 已注册 `registerDefaultScenePlatformPermitChecker('napcat')`，`scene_admin` / `scene_owner` 依据入站 metadata 中的 sender `role`（owner / admin）判定。

## 文档链接

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 许可证

MIT License
