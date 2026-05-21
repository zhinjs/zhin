# Host / Edge 双产品与 Remote Console（Fetch HttpHost + REST/SSE + IDB）

## 背景

Console 与 HTTP 服务绑定 Node 专有模式：Koa 第二栈、`/server` WebSocket、Farm 内嵌 UI、服务端 SQLite 收件箱。Edge 运行时（Deno Deploy、Workers）无法 `createServer(koa.callback())` 且不宜长连接 IM。

## 决策

### 产品分界

- **Zhin Host**（Node/Bun）：全量 IM、Agent、适配器 Webhook、`router.ws()`；单端口 **Fetch HttpHost**；Console API 为 REST + SSE。
- **Zhin Edge**：单 `fetch` 入口；**无 IM 适配器**；Webhook + Sandbox WS 入站；REST/SSE **子集** + 同协议。
- **Console Remote**：`console-app` 静态资源发布在 **GitHub Pages**；用户配置 **API Base URL**；**Bearer Token** + **CORS allowlist**。

### HTTP

- 新包 **`@zhin.js/http-host`**：`Request → Response` 路由表、`createFetchApp`（鉴权、CORS、JSON body）。
- **`@zhin.js/http`** 插件移除对外 `koa` 依赖；`Router` **兼容 shim** 注册到 Fetch 表；未匹配路径可回落内部 Koa（**仅 Console API 路由** `/entries`、`/@assets` 等，**无 Host 静态 UI**）。
- 配置延续：`http.port`、`http.token`、`http.base`、`http.trustProxy`；新增 **`http.corsOrigins`**（字符串数组）。

### Console 协议

| 方向 | 一期路径 | 说明 |
|------|----------|------|
| 请求 | `POST {base}/console/request` | Body：`{ type, data?, requestId? }`，与原 WS `type` 一致 |
| 推送 | `GET {base}/events` | `text/event-stream`；事件 `{ type, data?, timestamp? }` |
| 公开 | `GET /pub/health` | 无 Token |

域拆分 REST（`/api/bots/*` 等）可在后续迭代；一期以 **console RPC + SSE** 保持客户端迁移量可控。

### 客户端缓存

- **IndexedDB** 为 Console 主缓存（收件箱、pending、游标）。
- Host 服务端 SQLite（bot-persistence）一期保留；可选 `POST {base}/console/import` 一次性导入 IDB。
- Edge 无服务端 DB，仅 IDB + SSE。

### Koa

- 从 **HTTP 插件公开面** 移除 `provide('koa')`；Console `PageManager` 在 Host 上 **仅注册 API 路由**（`serveClientHost: false`），静态 UI 仅 Remote 部署。

## 后果

- 破坏性：依赖 `useContext('koa')` 的插件需改接 `router` 或 Fetch 路由。
- `/server` WebSocket 废弃；Remote Console 必须配置 API Base。
- 二期见 [issue #427](https://github.com/zhinjs/zhin/issues/427)：Edge parity、StoragePort、Queue Edge。
