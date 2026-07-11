# @zhin.js/adapter-napcat

> **QQ 群助手 + 可选 @AI** — 先在 [demo.zhin.dev](https://demo.zhin.dev) 或 Sandbox 调试，再接 NapCat。启用 AI：`npx zhin setup --ai`。接入本适配器：`npx zhin setup --adapters`。

Zhin.js NapCatQQ 适配器，支持 OneBot11 标准 + go-cqhttp 扩展 + NapCat 独有 API。

## 功能特性

- 完整 OneBot v11 协议兼容 + go-cqhttp 扩展 + NapCat 独有 API（92+ 接口）
- **单一适配器**：`context: napcat`，通过 `connection` 选择连接方式
- **正向 WebSocket**（`connection: ws`）：应用连 NapCat 的 WS
- **反向 WebSocket**（`connection: wss`）：应用开 WS 服务端，NapCat 连上来
- **HTTP API + POST 上报**（`connection: http`）：出站 HTTP 调用，入站 webhook
- Access Token 认证支持（Bearer / HMAC 签名）
- 自动重连机制（WS）与心跳检测
- 群聊和私聊消息处理
- 入站消息去重与 bot 自发消息过滤
- Typing Indicator（处理中提示：群聊表情回应 / 私聊输入状态）
- 41 个 AI 工具（群管、戳一戳、表情回应、精华消息、群公告、AI 语音等）
- Console 管理页面（`/console/napcat`）
- Agent Prompt 贡献器（deferred 任务自动优选 napcat 工具）

## 安装

```bash
pnpm add @zhin.js/adapter-napcat ws
```

反向 WS / HTTP 模式需同时启用 `@zhin.js/host-router`。

## 配置

所有 Endpoint 使用 **同一 context：`napcat`**，通过 **`connection`** 区分连接方式。

### 正向 WebSocket（connection: ws）

```yaml
plugins:
  - "@zhin.js/adapter-napcat"

endpoints:
  - context: napcat
    connection: ws
    name: my-bot
    url: "ws://127.0.0.1:3001"
    access_token: "${NAPCAT_TOKEN}"
    reconnect_interval: 5000
    heartbeat_interval: 30000
```

### 反向 WebSocket（connection: wss）

```yaml
plugins:
  - "@zhin.js/host-router"
  - "@zhin.js/adapter-napcat"

endpoints:
  - context: napcat
    connection: wss
    name: my-bot
    path: "/napcat/ws"
    access_token: "${NAPCAT_TOKEN}"
    heartbeat_interval: 30000
```

### HTTP API + POST 上报（connection: http）

```yaml
plugins:
  - "@zhin.js/host-router"
  - "@zhin.js/adapter-napcat"

endpoints:
  - context: napcat
    connection: http
    name: my-bot
    http_url: "http://127.0.0.1:3000"
    post_path: "/napcat/post"
    access_token: "${NAPCAT_TOKEN}"
    poll_interval: 30000
```

### Typing Indicator（处理中提示）

```yaml
endpoints:
  - context: napcat
    connection: ws
    name: my-bot
    url: "ws://127.0.0.1:3001"
    typingIndicator:
      enabled: true
      defaultEmoji: "128516"
      privateConfig:
        type: "message"
        message: "正在思考中..."
      groupConfig:
        type: "reaction"
        emoji: "128516"
```

## NapCat 独有能力

相比标准 OneBot11 适配器，NapCat 额外支持：

- 戳一戳（群聊 / 私聊）
- 表情回应（贴表情）
- 合并 / 单条消息转发
- 精华消息管理
- 群公告管理
- 群文件管理
- AI 语音 TTS
- 图片 OCR 文字识别
- 小程序卡片签名
- 个人资料 / 头像 / 签名修改
- 在线状态设置
- 消息历史查询
- 英译中翻译

## AI 工具


## full-bot L4 参考

[`examples/full-bot`](../../../examples/full-bot/) 默认加载本适配器（`endpoints` 段需自行填写 `ONEBOT11_*` 后取消注释）。

- 入站 → `ZhinAgent` → 出站走 `Adapter.sendMessage` 统一链路
- 契约测试：`plugins/adapters/napcat/tests/l4-contract.test.ts` + `integration.test.ts`（adapter-harness）
- CI：`L4_SKIP_PLATFORM=1` 跳过实机；本地验证不设该变量并可配置 `ONEBOT11_WS_URL`

详见 [full-bot ACCEPTANCE.md](../../../examples/full-bot/ACCEPTANCE.md)。
