# @zhin.js/adapter-milky

Zhin.js [Milky](https://milky.ntqqrev.org/) 协议适配器，**一个适配器**支持 WebSocket 正向/反向、SSE、Webhook 四种连接方式，由配置项 `connection` 区分；支持 HTTP API 调用与 `access_token` 鉴权。

## 功能特性

- 🔌 Milky 协议兼容（[通信说明](https://milky.ntqqrev.org/guide/communication)）
- 📦 **单一适配器**：`context: milky`，通过 `connection` 选择连接方式
- 🌐 **WebSocket 正向**（`connection: ws`）：应用连协议端 `ws(s)://baseUrl/event`
- 📡 **SSE**（`connection: sse`）：应用 GET 协议端 `/event`
- 📮 **Webhook**（`connection: webhook`）：应用提供 POST 端点收事件
- 🔄 **WebSocket 反向**（`connection: wss`）：应用开 WS 服务端，协议端来连
- 🔐 `access_token` 鉴权（Header 或 query）
- 📨 群聊 / 私聊消息收发与消息段映射
- 🛠️ HTTP API 封装，供发消息、撤回、群管等复用

## 安装

```bash
pnpm add @zhin.js/adapter-milky ws eventsource
```

适配器依赖 `@zhin.js/http` 提供的 `router` 才能注册（Webhook/反向 WS 需挂路由），请同时启用 HTTP 服务：

```bash
pnpm add @zhin.js/http
```

## 配置

所有 Bot 使用 **同一 context：`milky`**，通过 **`connection`** 区分连接方式。

### WebSocket 正向

```yaml
plugins:
  - "@zhin.js/http"
  - "@zhin.js/adapter-milky"

bots:
  - context: milky
    connection: ws
    name: milky-bot
    baseUrl: "http://127.0.0.1:8080"
    access_token: "${MILKY_ACCESS_TOKEN}"
    reconnect_interval: 5000
    heartbeat_interval: 30000
```

### SSE

```yaml
bots:
  - context: milky
    connection: sse
    name: milky-sse-bot
    baseUrl: "http://127.0.0.1:8080"
    access_token: "${MILKY_ACCESS_TOKEN}"
```

### Webhook

```yaml
bots:
  - context: milky
    connection: webhook
    name: milky-webhook-bot
    baseUrl: "http://协议端地址"
    path: "/milky/webhook"               # 应用接收事件的 POST 路径
    access_token: "${MILKY_ACCESS_TOKEN}"
```

### WebSocket 反向

```yaml
bots:
  - context: milky
    connection: wss
    name: milky-wss-bot
    baseUrl: "http://协议端地址"
    path: "/milky/event"                 # 应用 WS 服务端路径
    access_token: "${MILKY_ACCESS_TOKEN}"
    heartbeat_interval: 30000
```

## 鉴权

所有连接方式统一支持：

- **Header**：`Authorization: Bearer {access_token}`
- **Query**：`access_token=xxx`

建议配置 `access_token`，并与协议端一致。

## 连接方式对比

| connection | 说明                           |
|------------|--------------------------------|
| `ws`       | 应用主动连协议端 `/event`      |
| `sse`      | 应用 GET `/event` 拉取事件流   |
| `webhook`  | 协议端 POST 到应用配置的 path  |
| `wss`      | 协议端连应用提供的 WS path     |

## 使用示例

### 消息处理

```typescript
import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    return `你好，${result.params.name}！`
  })
)
```

### 发送消息段

```typescript
addCommand(new MessageCommand('pic')
  .action(async () => {
    return [
      { type: 'text', data: { text: '图片：' } },
      { type: 'image', data: { url: 'https://example.com/img.png' } }
    ]
  })
)
```

发消息、撤回、群管等通过适配器封装的 HTTP API 完成。群管能力通过 `IGroupManagement` 自动注册为工具，详见 [工具与技能](/advanced/tools-skills)。

## 消息 ID 格式

`{message_scene}:{peer_id}:{message_seq}`（如 `group:123456:10001`）。撤回时使用该 ID。

## 协议与 API 参考

- [Milky 快速开始](https://milky.ntqqrev.org/)
- [Milky 通信](https://milky.ntqqrev.org/guide/communication)
- [事件结构](https://milky.ntqqrev.org/struct/Event)、[接收消息](https://milky.ntqqrev.org/struct/IncomingMessage)、[消息 API](https://milky.ntqqrev.org/api/message)、[群聊 API](https://milky.ntqqrev.org/api/group)

## 依赖项

- `ws` - WebSocket 客户端/服务端
- `eventsource` - SSE 客户端
- `zhin.js` - Zhin 核心
- `@zhin.js/http` - 提供 router，适配器注册依赖

## 开发

```bash
pnpm build   # 构建
pnpm clean   # 清理
```

## 许可证

MIT License
