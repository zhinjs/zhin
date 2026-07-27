# Host 运行时栈

Zhin **Host** 与 `packages/im`、`packages/console` 并列，提供 HTTP 监听、管理面 REST、Console 协议与可选 MCP Server。UI **不在** Host 内嵌，官方 Remote Console 见 [console-remote.md](../console-remote.md)。

## 组件

| 包 | npm | 职责 |
|----|-----|------|
| [host-http](https://github.com/zhinjs/zhin/tree/main/packages/host/http) | `@zhin.js/host-http` | HTTP/WebSocket 监听、Bearer、CORS |
| [host-mcp](https://github.com/zhinjs/zhin/tree/main/packages/host/mcp) | `@zhin.js/mcp` | MCP **Server**（向外暴露 Zhin 工具） |

> 原 legacy 插件包 `@zhin.js/host-router`（Koa 传输）与 `@zhin.js/host-api`（管理面 REST）已删除；Console/HTTP Host 由 `@zhin.js/cli` 自动装配（`@zhin.js/host-http` + `@zhin.js/pagemanager`），无需在 `plugins` 列表中启用。

Console 前端栈（contract → pagemanager → client → [zhin-console](https://github.com/zhinjs/console)）见仓库 [packages/console](https://github.com/zhinjs/zhin/tree/main/packages/console)。

## 配置

```yaml
# zhin.config.yml（Stable 最小集）
http:
  port: 8086
  token: ${HTTP_TOKEN}   # 或 .env HTTP_TOKEN

hostApi:
  enabled: true

# 可选：向外暴露 MCP（由 CLI 装配，无需列入 plugins）
mcp:
  enabled: true
```

- **`http:`** — 传输层（端口、Token、CORS）
- **`hostApi:`** — 管理面开关与 Console 相关选项

## Remote Console 快速路径

1. 启动应用（如 [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 的 `pnpm dev`）。
2. 浏览器打开 **[console.zhin.dev](https://console.zhin.dev)**（或本地 `zhin-console/` 开发服）。
3. 登录页填写 **API Base**（日志中的 Host，如 `http://127.0.0.1:8086`）与 **Bearer Token**（`.env` 的 `HTTP_TOKEN`）。

协议：`POST /api/console/request` + SSE `GET /api/events`；插件扩展经 `GET /entries` 动态加载。详见 [Remote Console](../console-remote.md)。

## MCP Server

启用 MCP（`mcp.enabled`，由 CLI 自动装配）后，IDE 等 MCP Client 可通过 Streamable HTTP 调用 Zhin 内置工具。配置与工具列表见 [MCP 集成 — Server 模式](../advanced/mcp#server-模式zhin-作为-mcp-server)。

## 相关文档

- [架构概览 — Host 层](../architecture-overview.md)
- [Remote Console](../console-remote.md)
- [MCP 集成](../advanced/mcp)
- [packages/host（仓库）](https://github.com/zhinjs/zhin/tree/main/packages/host)
