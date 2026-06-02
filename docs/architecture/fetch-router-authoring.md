# HTTP 路由编写（Koa + `@koa/router`）

`@zhin.js/host-router` 提供单一 Koa 应用与 `Router` 实例（基于 `@koa/router`）。**官方管理面 REST / Console 协议** 由 `@zhin.js/host-api` 注册；自定义插件仍通过 `useContext('router')` 挂载路由。

## 注册路由

```typescript
import type { Router, RouterContext } from "@zhin.js/host-router/router";

useContext("router", (router: Router) => {
  router.get("/pub/health", (ctx: RouterContext) => {
    ctx.body = { ok: true };
  });

  router.post("/api/webhook/foo", async (ctx) => {
    const body = ctx.request.body;
    ctx.body = { ok: true };
  });
});
```

兼容别名 `registerFetchRoute(router, "POST", path, handler)` 仍可用，内部即 `router.post` 等。

## WebSocket

```typescript
const wss = router.ws("/sandbox");
wss.on("connection", (ws) => { /* ... */ });
```

## 鉴权

- 受保护路径需 `Authorization: Bearer <http.token>`（`http.config` 中的 `token`）。
- 公开路径：`/pub/*`，以及 `router.whiteList` 中的前缀。

Bearer / CORS 由 `@zhin.js/host-router` 中间件统一处理，见 `packages/host/router/src/http-middleware.ts`。
