# @zhin.js/adapter-sandbox

Zhin.js Sandbox 适配器，基于 WebSocket 的本地测试适配器，配合 Web 控制台提供浏览器端聊天窗口进行调试。

## 功能特性

- 基于 WebSocket 实时通信
- 浏览器端 React 聊天 UI
- 支持多客户端同时连接
- 无需第三方平台账号，即开即用
- 适合本地开发和插件调试

## 安装

```bash
pnpm add @zhin.js/adapter-sandbox
```

## 依赖

Sandbox 适配器需要以下服务插件：

- `@zhin.js/http` — HTTP 服务（提供 Router 和 WebSocket）
- `@zhin.js/console` — Web 控制台（提供前端 UI）
- `@zhin.js/client` — 控制台客户端框架

## 配置

```yaml
# zhin.config.yml
bots:
  - context: sandbox
    name: sandbox-bot

plugins:
  - adapter-sandbox
  - http
  - console
```

或使用 TypeScript 配置：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    {
      context: 'sandbox',
      name: 'sandbox-bot',
    }
  ],
  plugins: [
    'adapter-sandbox',
    'http',
    'console',
  ]
})
```

## 使用方式

1. 启动机器人：`pnpm dev`
2. 打开浏览器访问 Web 控制台（默认 `http://localhost:8086`）
3. 在控制台的 Sandbox 聊天窗口中发送消息进行测试

每个浏览器客户端通过 WebSocket 连接后会自动创建一个 Sandbox Bot 实例，消息通过 JSON 格式在 WebSocket 上传输。

## 消息格式

Sandbox 使用 JSON 消息格式：

```json
{
  "type": "message",
  "id": "msg-001",
  "content": "你好",
  "timestamp": 1700000000000
}
```

## 适用场景

- 本地开发调试插件逻辑
- 测试命令和 AI 工具调用
- 不依赖外部平台的功能验证

## 许可证

MIT License
