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

`@zhin.js/http` 插件提供的 `Router` 类目前用于 Node Host 路由注册。

## WebSocket（仅 Host）

```typescript
router.ws("/path", (ws) => { /* ... */ });
```

Node Host 下推荐直接使用 `router.ws()` 处理长连接。

## 鉴权

- 受保护路径需 `Authorization: Bearer <http.token>`。
- 公开：`/pub/*` 在白名单外于 `base` 下时由 `RouteTable.whiteList` 控制。

参见 `@zhin.js/http-host` 与 `@zhin.js/http` 包内 API 注释。
