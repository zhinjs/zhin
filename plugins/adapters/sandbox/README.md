# @zhin.js/adapter-sandbox

Zhin.js Sandbox 适配器，基于 WebSocket 的本地测试适配器；浏览器端聊天 UI 在 **[Remote Console](https://console.zhin.dev)**（Host 仅 Console API）中打开 Sandbox 窗口调试。

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

## 依赖

Sandbox 适配器需要以下服务插件：

- `@zhin.js/http` — HTTP 服务（提供 Router 和 WebSocket）
- `@zhin.js/console` — Host 侧 Console API（`addEntry` 注册 Sandbox 扩展）
- `@zhin.js/client` — Remote Console 客户端 SDK（UI 在 zhin-console 仓库）

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

1. 启动机器人：`pnpm dev`（Host 默认 `http://127.0.0.1:8086` 仅 **Console API**）
2. 打开 **[Remote Console](https://console.zhin.dev)**，API Base 指向上述 Host，Token 与 `http.token` / `HTTP_TOKEN` 一致
3. 在 Sandbox 聊天窗口中发送消息进行测试（勿将 `http://localhost:8086` 根路径当作 UI 入口）

每个浏览器客户端连接后创建 Sandbox Bot（无 yaml 固定名时为 `sandbox-xxxx`）。

通过 `Router.ws("/sandbox")`（插件 `useContext("router")` 自动挂载）建立连接。

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
