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

## 前置条件

Sandbox 不需要外部账号。只需由 `zhin runtime start` 装配 HTTP Host，并确保浏览器能访问启动日志中的 Host 地址。

## 依赖

### Plugin Runtime（新，`zhin runtime start`）

- `@zhin.js/adapter` — 约定式 `adapters/sandbox.ts`
- `@zhin.js/host-http` — Root 提供的 `httpHostToken`（WebSocket `/sandbox` + Console HTTP）
- `@zhin.js/core` — `messageGatewayToken` / ImRuntime 入站出站
- `@zhin.js/page` + `pages/index.tsx` — ADR 0046 约定页（`definePage`；路由 `/sandbox`）

Root 在 `zhin runtime start` 时装载 `@zhin.js/host-http`、`ConsoleRuntime` 与
`ClientBuildModuleRuntime`。打开 `http://<host>:<port>/console` 可浏览页面；Sandbox 页
（路由 `/sandbox`，与 WebSocket `/sandbox` 同 path：GET 开页、Upgrade 走 WS）内置聊天壳。

旧 `client/`（`register(api)` / `pageManager.addEntry`）仅保留给 legacy Host 栈参考，
**不是** Plugin Runtime 生产入口。

### 旧 Host 栈（已删除）

原 legacy 插件包 `@zhin.js/host-router`（HTTP 服务）与 `@zhin.js/host-api`（Host 侧 Console API，`addEntry` 注册 Sandbox 扩展）已删除；`zhin dev` 现由 `@zhin.js/cli` 自动装配 Console/HTTP Host（`@zhin.js/host-http` + `@zhin.js/pagemanager`），无需安装任何 Host 插件。

- `@zhin.js/client` — Remote Console 客户端 SDK（UI 在 zhin-console 仓库）

出站 wire 只做 JSON 封装；旧 `segment-mapper`（canonical segments）归一化上移到 gateway/core 渲染链。

## 配置

**推荐（与 [minimal-bot](../../../examples/minimal-bot/) 一致）**：`plugins.sandbox.endpoints: []`，在 Remote Console 打开「沙盒」页时经 `/sandbox` WebSocket **自动创建** bot（如 `sandbox-xxxx`），无需在 yaml 里写 `context: sandbox`。

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  sandbox:
    endpoints: []
```

可选：若需在启动时即在 bot 列表显示**固定名称**的离线占位 bot，可显式配置：

```yaml
plugins:
  sandbox:
    endpoints:
      - name: sandbox-bot
        context: sandbox
        owner: sandbox-user
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

## AI 工具

技能说明见 `agent/skills/sandbox.md`（本地沙箱调试约束）。


## 故障排查

| 现象 | 排查 |
| --- | --- |
| Console 无法连接 | 以启动日志中的 Host、端口和 token 为准 |
| Sandbox 页面空白 | 检查 HTTP Host 是否因端口占用软降级，以及鉴权/CORS 错误 |
| 刷新后没有历史消息 | 核对 Endpoint 与频道，并检查 history RPC 与 recovery gap 日志 |
| 命令或工具未生效 | 在运行时能力页确认它已进入当前 generation |

## 许可证

MIT License
