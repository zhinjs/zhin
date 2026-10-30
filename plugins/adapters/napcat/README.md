# @zhin.js/adapter-napcat

Zhin.js [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 适配器（Plugin Runtime，OneBot 11 + NapCat 扩展）。默认 **正向 WebSocket 客户端**（`connection: ws`）；亦支持 **反向 WS** 与 **HTTP POST 上报**（经 `httpHostToken`）。

账号由 `NapcatAdapter` 管理。Endpoint 直接继承实际 `NapcatClient`，保留原生方法与事件；框架生命周期、规范入站与发送经 `endpointSpec` 和 AdapterIndex 接入，不占用 Client 的原生 `start` / `stop` / `send` 方法。

## 功能特性

- OneBot 11 + go-cqhttp 扩展 + NapCat 独有 API
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）
- **正向 WebSocket**（`connection: ws`）：应用连 NapCat WS
- `access_token` 鉴权（Bearer + query）
- 入站经 `endpointSpec.events`（去重 + 自发过滤）；出站 `send({ conversation, payload })`
- 41 个 AI 工具（`tools/`）

## 安装

```bash
pnpm add @zhin.js/adapter-napcat
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/napcat/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `endpointSpec.events` 入站、`outboundMessageToken` 出站
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到顶层 `<instanceKey>`

入站：`endpoint[endpointSpec].events.emit('message.receive', { conversation, message: { conversation, id }, content, sender, metadata })`（`conversation` 为 ConversationRef：私聊 `kind: 'private'`、群聊 `kind: 'group'`，临时会话群容器进 `parent`）

出站：`send({ conversation, payload })` → WS `send_private_msg` / `send_group_msg`

## 前置条件

1. 安装并登录 NapCatQQ，启用一个与 Zhin 配置匹配的 OneBot 11 连接。
2. 正向 WS 需 Zhin 可达 NapCat；反向 WS/HTTP 上报需 NapCat 可达 Zhin HTTP Host。
3. 两端配置相同的 `access_token`，不要把未鉴权端口暴露到公网。

## 最小配置

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  napcat: "@zhin.js/adapter-napcat"
napcat:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: my-bot
      url: "ws://127.0.0.1:3001"
      access_token: "${NAPCAT_TOKEN}"
```

AdapterIndex 会把实例级连接默认值合并进每个 endpoint；协议实现只接收一份展开后的
endpoint 配置，不会从环境变量推断 endpoint id。

主配置 `plugins` 映射需引用 `@zhin.js/adapter-napcat`（`instanceKey: napcat`）。

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
| Permit 词汇 | `PERMITS.md` |
| 平台工具 | `tools/<name>/index.ts` |
| 技能说明 | `agents/napcat/skills/napcat-*/SKILL.md`（按消息、群内容、群设置、文件历史、媒体和账号拆分） |

## 迁移说明（Plugin Runtime）

- **notice / request / meta 侧事件**：经统一 `endpointSpec.events` 归一后分发到 `handlers`（`notice.receive` / `request.receive` / `system.receive`），请求带 `$approve` / `$reject`。消息仍走 `outboundMessageToken`。
- **群管工具暂未迁移**：旧 Adapter 经 `createSceneManagementTools` 注册踢人 / 禁言 / 群名片等成套 agent 工具；迁移后 `tools/` 仅覆盖 NapCat 扩展 API，其余群管能力可通过 `callApi`（如 `set_group_kick`、`set_group_ban`）作为逃生舱调用。
- **平台权限门禁**：`plugin.ts` setup 通过 generation-owned `permissionHostToken` 调用 `host.registerPlatform('napcat', createSceneRolePlatformChecker())`，`scene_admin` / `scene_owner` 依据入站 metadata 中的 sender `role`（owner / admin）判定。

## 文档链接

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [适配器概览](https://zhin.js.org/essentials/adapters)

## Console 页面

启动后打开 Console 的「NapCat」页（地址 `/napcat`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 经所属 Adapter 增删持久化账号、启停单个 Endpoint；凭据由 Host 加密仓储保存，不改启动 YAML 或 `.env`，不重启进程；
- 如果适配器要求登录，页面会显示 LoginAssist 的扫码 / 滑块 / 设备确认待办；

读取需要 `napcat:read`，写操作需要 `napcat:write`；管理员 full token 不受限。页面里的「添加 endpoint」等价于原来的 `napcat endpoint add`。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WS 连接被拒绝 | 检查 NapCat URL、端口与连接方向 |
| 401 或握手失败 | 确认两端 token 一致，反向代理保留 Authorization |
| 重复或自身消息触发 | 检查是否同时启用了多条上报连接 |
| 请求/通知缺失 | 确认 NapCat 上报 notice/request/meta，并查看 Endpoint 对应分类 |

## 许可证

MIT License

### 高阶消息支持边界

NapCat 官方消息兼容表标明 share 仅接收，不支持发送；Markdown 仅可在双层合并转发内发送，不支持直接消息。Canonical `markdown`、`share`、`keyboard` 直接出站明确返回 `unsupported_operation / not_sent`，不会将占位段或原始协议猜测报告成功。当前未实现合并转发 Markdown，亦无原生按钮回调闭环。参考：[官方兼容表](https://napneko.github.io/develop/msg)。
