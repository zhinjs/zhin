# @zhin.js/adapter-napcat

Zhin.js [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 适配器（Plugin Runtime，OneBot 11 + NapCat 扩展）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **反向 WS** 与 **HTTP POST 上报**（经 `httpHostToken`）。

## 功能特性

- OneBot 11 + go-cqhttp 扩展 + NapCat 独有 API
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 NapCat WS
- `access_token` 鉴权（Bearer + query）
- 入站经 `Endpoint.emit(...)`（去重 + 自发过滤）；出站 `send({ conversation, payload })`
- 41 个 AI 工具（`agent/tools/`）

## 安装

```bash
pnpm add @zhin.js/adapter-napcat
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/napcat.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`

入站：`gateway.receive({ conversation, message: { conversation, id }, content, sender, metadata })`（`conversation` 为 ConversationRef：私聊 `kind: 'private'`、群聊 `kind: 'group'`，临时会话群容器进 `parent`）  
出站：`send({ conversation, payload })` → WS `send_private_msg` / `send_group_msg`

## 前置条件

1. 安装并登录 NapCatQQ，启用一个与 Zhin 配置匹配的 OneBot 11 连接。
2. 正向 WS 需 Zhin 可达 NapCat；反向 WS/HTTP 上报需 NapCat 可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，不要把未鉴权端口暴露到公网。

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

- **notice / request / meta 侧事件**：经 the unified `Endpoint.emit(...)` ingress 归一后分发到 `handlers`（`notice.receive` / `request.receive` / `system.receive`），请求带 `$approve` / `$reject`。消息仍走 `outboundMessageToken`。
- **群管工具暂未迁移**：旧 Adapter 经 `createSceneManagementTools` 注册踢人 / 禁言 / 群名片等成套 agent 工具；迁移后 `agent/tools/` 仅覆盖 NapCat 扩展 API，其余群管能力可通过 `callApi`（如 `set_group_kick`、`set_group_ban`）作为逃生舱调用。
- **平台权限门禁**：`plugin.ts` setup 已注册 `registerDefaultScenePlatformPermitChecker('napcat')`，`scene_admin` / `scene_owner` 依据入站 metadata 中的 sender `role`（owner / admin）判定。

## 文档链接

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS 连接被拒绝 | 检查 NapCat URL、端口与连接方向 |
| 401 或握手失败 | 确认两端 token 一致，反向代理保留 Authorization |
| 重复或自身消息触发 | 检查是否同时启用了多条上报连接 |
| 请求/通知缺失 | 确认 NapCat 上报 notice/request/meta，并查看 Endpoint 对应分类 |

## 许可证

MIT License
