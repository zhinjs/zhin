---
"@zhin.js/gateway": patch
"@zhin.js/host-http": patch
"@zhin.js/cli": patch
---

`zhin runtime start` 经网关对外服务（ADR 0054 §1 / §3）

- cli：`zhin runtime start` / `pnpm dev` 的监管进程同时启动网关 HTTP 服务器，监听配置的 `http.port`（含额外端口），经实例传输把请求转发给受监管的实例；不再需要 `--standalone` 就能访问 Console 与 Webhook。
- gateway：新增子路径 `@zhin.js/gateway/server`（`GatewayHttpServer`、`startGateway`、`runGateway`）；`@zhin.js/gateway/http` 只保留响应工具，实例导入它时不会加载 Node HTTP 栈。网关改用 `@zhin.js/host-http/bridge` 的传输类型，转发失败按错误码映射：实例离线 `503 instance_unavailable`（带 `state`、`Retry-After`）、超时 `504 instance_timeout`、其他 `502 instance_error`。`POST {base}/console/request` 中的 `gateway.*` RPC 由网关处理（载荷在 `data`），其他类型原样转发给实例。经 Console 停止实例或依赖事务进行中，监管进程不会因实例停止而退出。
- host-http：桥接协议新增过渡消息 `auth.authenticate` / `auth.result` / `auth.state` / `auth.audit`——Console 账号迁到网关（B1.4）之前，由实例解析用户会话与 API 令牌、上报是否已有所有者，网关侧审计写入实例；`createDelegatedAccessProvider` 把它装成网关 TokenRegistry 的访问提供者（未收到上报前按“已有所有者”处理）。没有所有者且未配置 `http.token` 时，网关转发 `{ kind: 'bootstrap', open: true }`。
