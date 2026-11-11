---
"@zhin.js/gateway": patch
"@zhin.js/host-http": patch
---

网关 HTTP 服务器（ADR 0054 §2 / §3，B1.3）

- gateway：`GatewayHttpServer`——项目唯一的监听者（主端口 + `http.listeners` 额外端口 / TLS），网关自有路由优先，`{base}` 请求在网关认证后连同主体转发，其他路由（Webhook、反向 WebSocket）原样转发；实例未就绪时返回 `503 { code: 'instance_unavailable', state }` 与 `Retry-After`，网关自有路由与 `/pub/health` 不受影响；`startGateway` 组合服务器、实例监管与实例传输。
- host-http：`@zhin.js/host-http/node` 新增 `createNodeHttpListener`（Node 请求 ↔ `Request` / `Response`、`ws` ↔ `WsConnection`）；路由器新增 `builtinRoutes` 选项；WebSocket 升级拒绝可带状态码与响应头；CORS 暴露 `Retry-After`（跨域 Console 能读到登录限速与实例离线的等待时长）。
