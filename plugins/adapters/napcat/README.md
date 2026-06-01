# @zhin.js/adapter-napcat

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

反向 WS / HTTP 模式需同时启用 `@zhin.js/http`。

## 配置

所有 Bot 使用 **同一 context：`napcat`**，通过 **`connection`** 区分连接方式。

### 正向 WebSocket（connection: ws）

```yaml
plugins:
  - "@zhin.js/adapter-napcat"

bots:
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
  - "@zhin.js/http"
  - "@zhin.js/adapter-napcat"

bots:
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
  - "@zhin.js/http"
  - "@zhin.js/adapter-napcat"

bots:
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
bots:
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

适配器自动注册 41 个 AI 工具（7 个群管理标准工具 + 34 个 NapCat 扩展工具），详见 `skills/napcat/SKILL.md`。
