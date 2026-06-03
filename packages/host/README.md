# packages/host/

Zhin **Host 运行时**（与 `packages/im`、`packages/console` 并列的常驻包，非可选 `plugins`）。

| 目录 | npm 包 | 职责 |
|------|--------|------|
| [router](./router/) | `@zhin.js/host-router` | Koa 监听、`Router`/WS、Bearer、CORS |
| [api](./api/) | `@zhin.js/host-api` | 管理面 REST、Console 协议、`PageManager` / `entries` |
| [mcp](./mcp/) | `@zhin.js/mcp` | MCP **Server**（向外暴露 Zhin 工具） |

配置：`zhin.config` 中 **`http:`**（传输）、**`hostApi:`**（管理面）；`plugins` 列表启用上述包名。

## Remote Console（快速路径）

Host **不提供**内置管理页 UI，仅暴露 Console API。官方 UI 在独立仓库 **[zhin-console](https://github.com/zhinjs/console)**（如 [console.zhin.dev](https://console.zhin.dev)）。

1. 启动应用，启用 `@zhin.js/host-router` + `@zhin.js/host-api`（默认 `hostApi.enabled: true`）。
2. 浏览器打开 **https://console.zhin.dev**（或本地 `zhin-console/` 开发服）。
3. 登录页填写 **API Base URL**（如 `http://127.0.0.1:8086`）与 **Bearer Token**（`.env` 中 `HTTP_TOKEN` / `http.token`）。

协议：`POST /api/console/request` + SSE `GET /api/events`；插件扩展经 `GET /entries` 动态加载。完整说明见 **[docs/console-remote.md](../../docs/console-remote.md)**。

构建顺序（Host 栈）：`packages/console/*` → `packages/host/router` → `packages/host/api`（见 [repo-structure](../../docs/contributing/repo-structure.md)）。
