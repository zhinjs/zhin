# 二期：Edge Console 同构、StoragePort、Queue Edge、Fetch 原生路由

## 背景

一期（[ADR-0008](./0008-host-edge-remote-console.md) / [#426](https://github.com/zhinjs/zhin/issues/426)）交付 Host Fetch HttpHost 与 Remote Console。二期（[#427](https://github.com/zhinjs/zhin/issues/427)）补齐 Edge 可运维深度、队列栈与插件 HTTP 现代化。

## 决策

### StoragePort

- 新包 **`@zhin.js/storage-port`**：`StoragePort` 接口（`get` / `set` / `delete` / `list`，按 `namespace` 隔离）。
- 驱动：`memory`（默认 Edge/测试）、`sqlite`（Host，二期先由 memory + 文档约定，Host 业务 DB 仍走现有 `@zhin.js/database`）、`deno-kv`、`d1`（Edge 绑定由运行时注入 `KvLike` / `D1Like`）。
- Queue 出站记录、claim 锁、游标键命名：`queue:{botId}:outgoing:*`、`queue:{botId}:claim:*`。

### Console Parity Matrix

RPC `type` 在 **Edge** 上的策略（其余 **Host-only**）：

| 策略 | RPC 前缀 / 精确类型 |
|------|---------------------|
| **allowed** | `ping`、`entries:get`；`config:`、`schema:`、`env:`、`cron:`；`bot:list`、`bot:info`、`bot:sendMessage` |
| **unsupported** | `files:`、`db:`、`db:kv:`、`system:`；`bot:friends`、`bot:groups`、`bot:channels`、`bot:deleteFriend`、`bot:requests`、`bot:request*`、`bot:notice*`、`bot:inbox*`、`bot:group*` |

Edge 对 unsupported 返回 HTTP 400，`{ success: false, error, code: "EDGE_UNSUPPORTED" }`，**不得** 500。

实现：`plugins/services/console/src/rpc/parity.ts`；`registerConsoleRoutes(..., { parity: "edge" | "host" })`。

### Queue Edge 试点

- 新包 **`@zhin.js/queue-runtime`**：`enqueueOutgoing`、`claimOutgoing`、`executeOutbound`；入站校验 [event-contracts](../architecture/event-contracts.md) 的 Envelope 形状。
- **试点范围**：单消费者路径 + `POST {base}/queue/incoming`；不保证全量 `queue_plugins` 并行；**不** 加载 IM 适配器。
- Edge 示例：`examples/deno-deploy-playground` 与可选 `examples/queue-edge` README。

### Fetch 原生路由

- **`registerFetchRoute(table, method, path, handler)`** 在 `@zhin.js/http-host` 导出（官方插件 HTTP 注册方式）。
- **`Router` compat shim**（`@zhin.js/http`）标 **@deprecated**，计划三期移除；新代码使用 `registerFetchRoute`。
- `router.ws()` 仅 Host（Node `ws` upgrade）。

### SSE

- `sse-hub` 为事件分配单调 `id`，支持 `Last-Event-ID` 重连重放（环形缓冲，默认 200 条）。
- 响应头 `X-Accel-Buffering: no` 与 15s heartbeat 保持。

### OAuth

- 二期仅 ADR 预留：Console 仍以 Bearer 为主；OAuth2 接入点见 `#427` 后续 issue，不实现完整流程。

## Console / Queue HTTP 路径（二期）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `{base}/console/request` | Console RPC（Host 全量 / Edge 子集） |
| GET | `{base}/events` | SSE（`Last-Event-ID` 可选） |
| POST | `{base}/queue/incoming` | Queue Envelope 入站（Edge 试点） |
| GET | `{base}/queue/outgoing` | 列出待出站记录（调试/验收） |
| GET | `/pub/health` | 健康检查（无 Token） |

## 后果

- `http-host` 鉴权改用 Web Crypto 兼容的 timing-safe 比较，可在 Deno/Workers 运行。
- zhin-console 需根据 `EDGE_UNSUPPORTED` 与 Parity Matrix 隐藏面板（外仓协同）。
- 破坏性：无（compat shim 保留至三期）。

## 相关

- 一期：[0008-host-edge-remote-console.md](./0008-host-edge-remote-console.md)
- 队列词汇：[queue/CONTEXT.md](../architecture/queue/CONTEXT.md)
- 路由编写：[fetch-router-authoring.md](../architecture/fetch-router-authoring.md)
