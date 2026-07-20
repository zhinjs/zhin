# @zhin.js/host-http

Minimal HTTP and WebSocket host for Plugin Runtime. Provides `httpHostToken` so Adapters and
Console can register path-scoped WebSocket / HTTP routes without importing Koa or the legacy
`@zhin.js/host-router`.

Root installs the host via `installResources` (see `basic/cli/src/plugin-runtime/http-host-installer.ts`
and `console-host-installer.ts`).

## Capabilities (this slice)

- Path-scoped WebSocket upgrades (`ws(path)`)
- HTTP `route(method, path, handler, meta?)` (exact + `/*` prefix)
- Built-in `GET /pub/health` and `GET /pub/openapi.json`
- CORS allowlist (always includes `https://console.zhin.dev`)
- Optional Bearer auth for `/api/*` when `http.token` / `http.tokens` are set (ADR 0016 scopes)
- WebSocket upgrade auth (Authorization or `?token=`); demo scope limited to `/sandbox`
- `readJsonBody()` helper for JSON POST/PUT bodies (no Koa)

```ts
import { httpHostToken, type HttpHost } from '@zhin.js/host-http';

const http = context.use(httpHostToken);
const handle = http.ws('/sandbox');
handle.onConnection(({ socket, authScope }) => { /* ... */ });

http.route('GET', '/api/secure', (_req, res, _url, scope) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ scope }));
});
```

## Config (`http` in Root YAML)

```yaml
http:
  host: 127.0.0.1
  port: 8086
  token: ${HTTP_TOKEN}          # full scope
  tokens:
    - token: ${DEMO_TOKEN}
      scope: demo
  corsOrigins:
    - https://example.test
  base: /api                    # auth prefix
```

Still deferred to later host migration: full `@zhin.js/host-api` management-plane REST/RPC/SSE
and retiring the legacy Koa `@zhin.js/host-router` stack.
