---
title: "@zhin.js/adapter-sandbox"
package: "@zhin.js/adapter-sandbox"
tier: Stable
---

::: info 文档同步
本页由 [`plugins/adapters/sandbox/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/sandbox/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=e3b11abe4905999f -->

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

- `@zhin.js/host-router` — HTTP 服务（提供 Router 和 WebSocket）
- `@zhin.js/host-api` — Host 侧 Console API（`addEntry` 注册 Sandbox 扩展）
- `@zhin.js/client` — Remote Console 客户端 SDK（UI 在 zhin-console 仓库）

## 配置

**推荐（与 [minimal-bot](/getting-started/) 一致）**：`endpoints: []`，在 Remote Console 打开「沙盒」页时经 `/sandbox` WebSocket **自动创建** bot（如 `sandbox-xxxx`），无需在 yaml 里写 `context: sandbox`。

```yaml
# zhin.config.yml
endpoints: []

plugins:
  - "@zhin.js/adapter-sandbox"
  - "@zhin.js/host-router"
  - "@zhin.js/host-api"
```

可选：若需在启动时即在 bot 列表显示**固定名称**的离线占位 bot，可显式配置：

```yaml
endpoints:
  - context: sandbox
    name: sandbox-bot
```

## 使用方式

1. 启动 Zhin 实例：`pnpm dev`（终端会打印 Host 地址，一般为 `http://127.0.0.1:8086`）
2. 打开 **[Remote Console](https://console.zhin.dev)**，API Base 与 Host 地址一致，Token 与 `http.token` / `HTTP_TOKEN` 一致
3. 在 Console **沙盒** 页连接后发送消息进行测试

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
