# packages/host/

Zhin **Host 运行时**（与 `packages/im`、`packages/console` 并列的常驻包，非可选 `plugins`）。

| 目录 | npm 包 | 职责 |
|------|--------|------|
| [router](./router/) | `@zhin.js/host-router` | Koa 监听、`Router`/WS、Bearer、CORS |
| [api](./api/) | `@zhin.js/host-api` | 管理面 REST、Console 协议、`PageManager` / `entries` |
| [mcp](./mcp/) | `@zhin.js/mcp` | MCP **Server**（向外暴露 Zhin 工具） |

配置：`zhin.config` 中 **`http:`**（传输）、**`hostApi:`**（管理面）；`plugins` 列表启用上述包名。

构建顺序（Host 栈）：`packages/console/*` → `packages/host/router` → `packages/host/api`（见 [repo-structure](../../docs/contributing/repo-structure.md)）。
