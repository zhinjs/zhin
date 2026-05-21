# Fetch 路由编写（官方 API）

## Host

```typescript
import { RouteTable, createFetchApp, registerFetchRoute } from "@zhin.js/http-host";

const table = new RouteTable();
registerFetchRoute(table, "POST", "/api/webhook/foo", async (ctx) => {
  const body = ctx.request.body;
  ctx.body = { ok: true };
});

const app = createFetchApp(table, { base: "/api", token: "...", corsOrigins: ["https://console.zhin.dev"] });
```

`@zhin.js/http` 插件提供的 `Router` 类为 **兼容 shim**（映射到同一 `RouteTable`），**已 deprecated**，三期移除。

## Edge

- 使用 `createFetchApp` + `registerFetchRoute`；**不要** `router.ws()` 或 `node:http` `createServer`。
- Console：`registerConsoleRoutes(table, base, getWebServer, { parity: "edge" })`。
- Queue：`registerQueueRoutes` from `@zhin.js/queue-runtime`。

## WebSocket（仅 Host）

```typescript
router.ws("/path", (ws) => { /* ... */ });
```

Edge 运行时无 Node `ws` upgrade；入站用 Webhook POST 或平台提供的 WS API（如 Deno `upgradeWebSocket`）。

## 鉴权

- 受保护路径需 `Authorization: Bearer <http.token>`。
- 公开：`/pub/*` 在白名单外于 `base` 下时由 `RouteTable.whiteList` 控制。

参见 [ADR-0009](../adr/0009-phase-2-edge-storage-queue.md)。
