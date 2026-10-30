# @zhin.js/adapter-sandbox

Zhin.js Sandbox 适配器，为 **[Remote Console](https://console.zhin.dev)** 提供会话工作区。Host 承载 WebSocket、真实聊天记录和执行状态，Console 提供聊天与工作界面。

## 功能特性

- **Node Host**：WebSocket `/sandbox`
- 浏览器端 React 聊天 UI
- 支持多客户端同时连接
- 无需第三方平台账号，即开即用
- 适合本地开发和插件调试

## 安装

```bash
pnpm add @zhin.js/adapter-sandbox
```

## 前置条件

Sandbox 不需要外部账号。只需由 `zhin runtime start` 装配 HTTP Host，并确保浏览器能访问启动日志中的 Host 地址。

## 依赖

### Plugin Runtime（新，`zhin runtime start`）

- `@zhin.js/adapter` — 约定式 `adapters/sandbox/index.ts`
- `@zhin.js/host-http` — Root 提供的 `httpHostToken`（WebSocket `/sandbox` + Console HTTP）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `@zhin.js/page` + `pages/index/index.tsx` — ADR 0046 约定页（`definePage`；路由 `/sandbox`）

Root 在 `zhin runtime start` 时装载 `@zhin.js/host-http`、`ConsoleRuntime` 与
`ClientBuildModuleRuntime`。打开 `http://<host>:<port>/console` 可浏览页面；Sandbox 页
（路由 `/sandbox`，与 WebSocket `/sandbox` 同 path：GET 开页、Upgrade 走 WS）内置聊天壳。

旧 `client/`（`register(api)` / `pageManager.addEntry`）仅保留给 legacy Host 栈参考，
**不是** Plugin Runtime 生产入口。

### 旧 Host 栈（已删除）

原 legacy 插件包 `@zhin.js/host-router`（HTTP 服务）与 `@zhin.js/host-api`（Host 侧 Console API，`addEntry` 注册 Sandbox 扩展）已删除；`zhin dev` 现由 `@zhin.js/cli` 自动装配 Console/HTTP Host（`@zhin.js/host-http` + `@zhin.js/pagemanager`），无需安装任何 Host 插件。

- `@zhin.js/client` — Remote Console 客户端 SDK（UI 在 zhin-console 仓库）

出站 wire 只做 JSON 封装；旧 `segment-mapper`（canonical segments）归一化上移到 gateway/core 渲染链。

Sandbox 声明 `html: direct`，聊天页在隔离 iframe 中展示 canonical `html`，因此 JSX 卡片无需截图引擎即可预览。允许内联样式和 data/blob 图片；组件脚本、事件属性、外部资源、表单提交和父页面访问均被限制。高度按内容调整，超过 1200px 可在框内滚动。

## 配置

**推荐（与 [minimal-bot](../../../examples/minimal-bot/) 一致）**：`sandbox.endpoints: []`，运行时提供默认 `sandbox-bot` endpoint，无需额外账号配置。

```yaml
configVersion: 2
# zhin.config.yml（Plugin Runtime）
plugins:
  sandbox: "@zhin.js/adapter-sandbox"
sandbox:
  endpoints: []
```

可选：若需在启动时即在 bot 列表显示**固定名称**的离线占位 bot，可显式配置：

```yaml
configVersion: 2
plugins:
  sandbox: "@zhin.js/adapter-sandbox"
sandbox:
  endpoints:
    - id: sandbox-bot
      owner: sandbox-user
```

## 使用方式

1. 启动 Zhin 实例：`pnpm dev`（终端会打印 Host 地址，一般为 `http://127.0.0.1:8086`）
2. 打开 **[Remote Console](https://console.zhin.dev)**，API Base 与 Host 地址一致，Token 与 `http.token` / `HTTP_TOKEN` 一致
3. 在 Console **会话** 页连接后发送消息

浏览器客户端连接到默认 `sandbox-bot`，也可以通过多个显式 endpoint 使用不同 WebSocket 路径。

支持工作区阅读的 Console 会在当前会话内打开「对话与轨迹」：读取真实收发记录，按需查看用量、逐轮轨迹与模型请求正文；返回聊天时保留输入草稿。未提供该阅读能力的旧 Console 仍打开记录页（`/agent/sessions?sessionKey=...`），会话分支操作保留在该页。路由 `/sandbox` 和已有会话标识保持兼容。

会话名称和运行配置保存在当前 Host 的数据库，按 Sandbox endpoint 与配置的 owner 隔离，同一 owner 的浏览器可共享目录。配置保存使用版本检查，冲突或结果不明时不自动重写。旧浏览器缓存不自动上传、迁移或清理；旧 Host 或明确不具备目录存储时继续使用原浏览器方式。主聊天读取真实收发记录，每次 50 条，按需加载更早记录。

关闭页面不会取消任务。重新进入会话后，可只读查看 journal 中已完成但未投递、部分投递或投递结果未知的结果，每页 50 个回合；这些结果不会补发、重跑，也不会写成已发送消息。结果正文复用 journal，媒体只保留已授权的资源链接，不复制 base64，不改变 journal 留存规则。

刷新后仅恢复当前进程和 generation 中仍有效的待处理交互，继续使用原发起人、会话、期限和单次处理规则。历史与浏览器缓存中的控件不提供当前审批权限；已结束或重启前的操作不会重新激活。

无人值守任务等产生的 Host 工具审批，可在任务中心的「Host 工具审批」中查看并逐次确认。该入口沿用 Console 操作者的权限，只显示当前有效请求，不改变 IM 审批规则。

「变更与产物」中的成功文件写入、编辑在 Host 提供项目文件引用时，可打开现有文件管理器查看当前文件。入口沿用文件管理器的项目根与读取权限；旧记录或无法映射的文件仍显示执行记录，不推测链接。该入口读取当前内容，不是执行时的历史快照。

每个 endpoint 通过 Root 提供的 HTTP Host（`httpHostToken`）挂载一个 WebSocket 路径，协议见下文「消息格式（wire 协议）」。

## 消息格式（wire 协议）

Console 沙盒页和自己写的测试客户端都用这套协议。每个 WebSocket 文本帧是一个 UTF-8 JSON 对象。

### 连接

- **地址**：`ws://<host>:<port>/sandbox`。同一个 HTTP Host 上的第一个 Sandbox endpoint 挂在 `/sandbox`，其余 endpoint 挂在 `/sandbox/<endpoint id>`（重名时依次加 `-2`、`-3`），启动日志会打印 `ws mounted <path>`。
- **鉴权**：Host 配置了 token 时，握手请求需带 `Authorization: Bearer <token>` 或查询参数 `?token=<token>`，否则返回 `401`。demo 权限的 token 只能连 `/sandbox`，而且是只读的：消息会被接收，但不会进入命令和 Agent，服务端回一条 `type: "error"`。
- **多连接**：同一 endpoint 的浏览器连接可以并存，共用已配置的 `owner`；`connectionId` 只标识连接，不改变 Bot 或 Agent 会话身份。关闭一个页面只移除该连接，不取消或重跑任务；endpoint 停止时关闭全部连接（`1001`），generation 退役继续由 Host 关闭（`1012`）。
- **会话投递**：每个 full 连接订阅一个 `type` + `id`；默认订阅 `private` + `owner`，发送普通消息也会更新该连接的订阅。回复只投递到同会话的 full 连接，demo 连接不能订阅或接收这些消息。无匹配连接时不确认发送，所有发送尝试失败时保留结果未知，不自动重试。

### 客户端 → 服务端：订阅当前会话

仅在本次 `ready.protocol` 为 `scoped-conversations-v1` 时发送：

```json
{"op":"subscribe","conversation":{"type":"group","id":"test-group"}}
```

`type` 为 `private`、`group` 或 `channel`。订阅替换该连接的当前会话，服务端返回 `type: "subscribed"` 和同一个 `conversation`。这类控制帧及无效控制帧不会进入命令、Agent 或平台消息钩子。

已订阅新协议的页面会收到同会话用户消息的 `direction: "inbound"` 回声，用于同步显示；回声不会再次进入框架。旧客户端无需修改即可发送原消息格式、接收当前会话回复，服务端不会向其发送无法识别的用户回声。新页面连接旧服务端时不发送订阅控制帧，沿用原发送方式。重连只恢复订阅，不重新提交消息。

### 客户端 → 服务端：发送消息

```json
{
  "type": "group",
  "id": "test-group",
  "content": [{ "type": "text", "data": { "text": "/hello" } }],
  "messageId": "client-msg-001",
  "timestamp": 1700000000000
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `private` \| `group` \| `channel` \| `direct` \| `guild` | 会话类型，默认 `private`。`direct` 按 `private` 处理，`guild` 按 `channel` 处理 |
| `id` | string | 会话 id，默认使用 endpoint 的 `owner`（默认 `sandbox-user`） |
| `content` | string 或消息段数组 | 消息段格式为 `{ "type": string, "data": object }`；字符串等同于一个 `text` 段 |
| `text` | string | 可选。没有 `content` 时作为纯文本；`content` 里没有文本段时也用它作为消息文本 |
| `messageId` | string | 可选。客户端生成的消息 id，须匹配 `^[A-Za-z0-9._:-]{1,160}$`，不匹配时忽略；填写后作为这条入站消息的 id，引用回复时可据此定位 |
| `timestamp` | number | 可选。毫秒时间戳，默认取服务端收到的时间 |
| `agentRun` | object | 可选。「会话」运行配置，见下表 |

- 帧内容不是 JSON 时，整段文本按一条纯文本消息处理。
- 消息的发送者固定为 endpoint 的 `owner`。
- **按钮回传**：`content` 中的 `{ "type": "action", "data": { "id": "...", "payload": "..." } }` 段会作为交互动作交给命令或 Agent；只填 `id` 或 `payload` 时，另一个取相同的值。消息里没有文本时，`payload` 作为消息文本。

`agentRun` 字段：

| 字段 | 取值 | 默认 |
| --- | --- | --- |
| `workingDirectory` | string，最长 4096 字符 | `""` |
| `safetyMode` | `read-only` \| `workspace-write` \| `danger-full-access` | `workspace-write` |
| `approvalMode` | `ask` \| `auto` \| `bypass` | `ask` |
| `networkAccess` | boolean | `false`；`safetyMode` 为 `danger-full-access` 时恒为 `true` |

无法识别的取值按默认值处理。

### 服务端 → 客户端

**连接就绪**：每次连接成功后发送一次。

```json
{
  "type": "ready",
  "protocol": "scoped-conversations-v1",
  "connectionId": "connection-uuid",
  "id": "sandbox-user",
  "endpoint": "sandbox-bot",
  "workingDirectory": "/path/to/bot",
  "canExecute": true,
  "shellIsolation": { "available": false, "provider": "docker", "message": "Docker daemon is unavailable" },
  "content": [{ "type": "text", "data": { "text": "已连接 Sandbox「sandbox-bot」…" } }],
  "timestamp": 1700000000000
}
```

`canExecute` 表示当前连接是否为 full 权限（能运行命令和 Agent 任务）；`shellIsolation` 是 Docker 隔离环境的探测结果，仅供展示。`ready` 与 `subscribed` 仅确认连接和订阅，不代表任务或审批成功。

**回复消息**：

```json
{
  "type": "group",
  "id": "test-group",
  "bot": "sandbox-bot",
  "endpoint": "sandbox-bot",
  "content": [{ "type": "text", "data": { "text": "Hello!" } }],
  "timestamp": 1700000000001
}
```

- `conversation: { type, id }` 是框架发送请求确定的真实会话；新客户端优先用它归并消息，即使 legacy envelope 的 `type` / `id` 指向别处。`bot` 和 `endpoint` 是配置的 endpoint id。旧客户端仍可读取原 `type` / `id` 字段。
- `messageId` 与框架记录的发送回执使用同一个消息 ID，可用于关联实时回复和已保存的聊天记录；已有 wire envelope 的非空显式字符串 ID 保持不变。
- `content` 是消息段数组。文本、`html`（JSX 卡片，见上文 `html: direct`）、按钮等段原样透传。
- `image` / `audio` / `video` / `file` 段只读 `data.media`（MediaRef）：`url` 原样透传；`base64` 补上 `base64://` 前缀后内联；`path` 由服务端读取文件后转成 `base64` 内联；其他类型和缺少 `data.media` 的媒体段会被丢弃，并在日志中记录 `sandbox_outbound_media_dropped`。
- 插件直接发送完整消息对象时，其他字段会原样保留。

**用户消息回声**：只发给已完成新协议订阅的同会话 full 连接。

```json
{
  "type": "group",
  "id": "test-group",
  "conversation": { "type": "group", "id": "test-group" },
  "direction": "inbound",
  "senderId": "sandbox-user",
  "messageId": "client-msg-001",
  "endpoint": "sandbox-bot",
  "content": [{ "type": "text", "data": { "text": "/hello" } }],
  "timestamp": 1700000000000
}
```

客户端按会话、消息方向及 `messageId` 合并本页乐观消息、真实历史和回声。按钮操作仍由原服务端交互与审批逻辑裁决，页面显示「已提交」不代表审批通过。多连接沿用当前 Console 操作者和配置的 Sandbox owner，不增加多人账号体系。

**只读连接的提示**：demo 权限的连接发送消息后，服务端回复：

```json
{
  "type": "error",
  "id": "sandbox-user",
  "endpoint": "sandbox-bot",
  "content": [{ "type": "text", "data": { "text": "当前连接是只读演示权限，不能运行 Agent 任务。" } }],
  "timestamp": 1700000000000
}
```

## 适用场景

- 本地开发调试插件逻辑
- 测试命令和 AI 工具调用
- 不依赖外部平台的功能验证

## AI 工具

技能说明见 `skills/sandbox/SKILL.md`（本地沙箱调试约束）。


## 故障排查

| 现象 | 排查 |
| --- | --- |
| Console 无法连接 | 以启动日志中的 Host、端口和 token 为准 |
| Sandbox 页面空白 | 检查 HTTP Host 是否因端口占用软降级，以及鉴权/CORS 错误 |
| 刷新后没有历史消息 | 核对 Endpoint 与频道，并检查 history RPC 与 recovery gap 日志 |
| 命令或工具未生效 | 在运行时能力页确认它已进入当前 generation |

## 许可证

MIT License
