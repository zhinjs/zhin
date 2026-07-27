# HTTP 路由编写（`@zhin.js/host-http`）

Console/HTTP Host 由 `@zhin.js/cli` 自动装配：传输层是 `@zhin.js/host-http`（原生 HTTP，无 Koa），**官方管理面 REST / Console 协议** 由 CLI 的 Console Host 装配。自定义插件通过 `httpHostToken` 挂载路由，无需安装任何 Host 插件。

## 注册路由

```typescript
import { httpHostToken, readJsonBody } from "@zhin.js/host-http";

const http = context.use(httpHostToken);

http.route("GET", "/pub/health", (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

http.route("POST", "/api/webhook/foo", async (req, res) => {
  const body = await readJsonBody(req);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, body }));
});
```

`route()` 返回注销函数；路径支持精确匹配与 `/*` 前缀匹配。可追加可选元数据对象（`summary`、`tags` 等 `RouteMeta`），会进入运行时 `GET /pub/openapi.json` 清单。

## WebSocket

```typescript
const handle = http.ws("/sandbox");
handle.onConnection(({ socket, authScope }) => { /* ... */ });
```

## 鉴权

- `/api/*` 默认受保护：需 `Authorization: Bearer <http.token>`（`http` 配置中的 `token` / `tokens`，支持 scope）。
- 公开路径：`/pub/*`（内置 `GET /pub/health`、`GET /pub/openapi.json`）。
- WebSocket upgrade 同样校验 Bearer（Authorization 或 `?token=`）。

Bearer / CORS 由 `@zhin.js/host-http` 统一处理，见 `packages/host/http/src/http-host.ts`。
