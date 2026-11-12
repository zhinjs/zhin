# @zhin.js/host-http

Minimal HTTP and WebSocket host for Plugin Runtime. Provides `httpHostToken` so Adapters and
Console can register path-scoped WebSocket / HTTP routes without importing Koa or the legacy
`@zhin.js/host-router`.

Root installs the host via `installResources` (see `packages/host/http/src/host-installer.ts`
and `packages/im/zhin/src/instance/console/host.ts`).

The route contract is transport independent (ADR 0054 §2): HTTP routes take a Web standard
`Request` and return a `Response`; WebSocket routes receive a `WsConnection`. The main entry never
loads `node:http` or `ws`. The in-process Node listener (`createHttpHost`, `createHttpHostGroup`)
the Node ↔ Web conversion (`createNodeRequest`, `writeNodeResponse`, `wrapNodeWebSocket`) and the
bare listener both of them and the gateway run on (`createNodeHttpListener`) live in
`@zhin.js/host-http/node`.

`@zhin.js/host-http/bridge` carries the same contract across the gateway ↔ instance IPC channel
(ADR 0054 §3): `createBridgedHttpHost` is the instance's `HttpHost` (it announces a route table,
serves forwarded requests with chunked, credit-based streaming bodies and bridged WebSocket
frames, and never loads `node:http` / `ws`); `IpcInstanceTransport` implements the gateway-facing
`InstanceTransport` (`routes()`, `onRoutes()`, `fetch(request, { principal })`,
`openWebSocket(info, peer)`). The gateway authenticates; the bridged router runs in `forwarded`
authentication mode and still authorizes every `{apiBase}` route against the Console permission map.

The composition root owns the process listener through `ProcessHttpHost`. Generation scopes receive
only the `HttpHost` routing port: they may register HTTP/WS routes but cannot listen or close the
shared server. Registrations are bound to generation admission, so candidate routes stay invisible
until snapshot commit and retired routes stop matching immediately while their leases drain.

`ProcessHttpHost.close()` is terminal and idempotent. It waits for a pending
`listen()` operation to settle and releases its TCP listener. Concurrent `listen()`
calls share one operation; calling `listen()` after close rejects.

## Capabilities (this slice)

- Path-scoped WebSocket upgrades (`ws(path)`), delivered as `WsConnection`
  (`url`, `headers`, `principal?`, `remoteAddress?`, `send`, `close`, `onMessage`, `onClose`,
  `bufferedAmount`); the Node transport answers protocol pings and drops peers that miss a pong
- HTTP `route(method, path, handler, meta?)` (exact + `/*` prefix); `handler(request, context)`
  returns a `Response`; `context` carries `url`, `params` (`'*'` = prefix remainder), the
  authenticated `principal` and `remoteAddress`
- Streaming responses (SSE, large files) use `ReadableStream` bodies; `createResponseStream()`
  gives a writer with backpressure (`write()` → false, `onDrain`) and disconnect (`signal`, `onClose`)
- Built-in `GET /pub/health` and `GET /pub/openapi.json`
- CLI-composed runtimes additionally expose `GET /pub/ready` and `GET /api/system/readiness` (requires `status.view`); see [production probes](../../../docs/operations/production.md).
- CORS allowlist (always includes `https://console.zhin.dev`)
- Bearer auth for `/api/*` (ADR 0049): `http.token` is a bootstrap token that only reaches
  `/auth/setup*` until the first owner exists; afterwards only Console user sessions and API tokens
  (supplied by a pluggable `ConsoleAccessProvider` on `tokenRegistry`) are accepted, and every
  route / RPC is checked against the permission map in `@zhin.js/console-protocol`
- WebSocket upgrade auth (Authorization or `?token=`), checked per path permission
- `readJsonBody()` / `readTextBody()` / `readBodyBytes()` (bounded, default 1 MiB, 413 after
  draining) and `jsonResponse()` helpers (no Koa)

```ts
import {
  createResponseStream, httpHostToken, jsonResponse, readJsonBody, SSE_HEADERS,
  verifyProtocolAccessToken,
} from '@zhin.js/host-http';

const http = context.resources.use(httpHostToken);

http.route('POST', '/api/echo', async (request, { principal }) => {
  const body = await readJsonBody<{ text?: string }>(request);
  return jsonResponse(200, { success: true, data: { text: body?.text, kind: principal?.kind } });
});

http.route('GET', '/api/ticks', () => {
  const stream = createResponseStream();
  const timer = setInterval(() => stream.write('data: tick\n\n'), 1000);
  stream.onClose(() => clearInterval(timer));     // client disconnected
  return new Response(stream.stream, { headers: SSE_HEADERS });
});

// A plugin socket authenticates itself (Console credentials are not accepted here).
http.ws('/my-protocol', { auth: 'protocol' }).onConnection((connection) => {
  if (!verifyProtocolAccessToken(config.accessToken, connection)) return connection.close(4003, 'Unauthorized');
  connection.onMessage((data) => connection.send(typeof data === 'string' ? `echo:${data}` : data));
});
```

Webhook routes check their own credential with `verifyProtocolAccessToken(token, { headers:
request.headers, url: context.url, remoteAddress: context.remoteAddress })`.

## Config (`http` in Root YAML)

```yaml
http:
  host: 127.0.0.1
  port: 8086
  token: ${HTTP_TOKEN}          # bootstrap: creates the first owner, rejected afterwards
  corsOrigins:
    - https://example.test
  base: /api                    # auth prefix
```

The legacy Koa `@zhin.js/host-router` stack and the `@zhin.js/host-api` management-plane plugin have
been removed; the management-plane REST/RPC/SSE is now assembled by `@zhin.js/cli` (Console Host) on
top of this package — no Host plugins need to be installed or enabled.

Extended Console RPC uses `src/console-rpc-extended/index.ts` as its module boundary. The dispatcher
only maps protocol method names to schedule, inbox, login, Endpoint-management, and Workroom control
handlers. Shared request parsing and generation-leased Endpoint execution live behind internal helper
ports, so adding one RPC domain does not enlarge the central dispatcher or couple unrelated domains.

Console project-file operations resolve the project root and existing filesystem targets before
access. Internal symlinks remain usable only when their resolved target is inside an allowed project
path; links outside the root, blocked path segments, and dangling links are denied. New files are
checked through their nearest existing parent and checked again after parent creation. File-tree
and environment-file inventory use the same boundary. This covers existing symlink layouts; it does
not provide an OS sandbox against a local process concurrently replacing directories during access.


### Saved configuration explanations

The `config:explain` Console RPC (requires `ops.config.read`) reuses the composition root's
`PluginManagementPort.explainConfiguration(instanceKey, expectedRevision)` authority.
The route returns metadata only, checks the caller's permission before reading configuration, and normalizes
errors without forwarding validator details or causes. It does not apply/restart the Runtime,
expand values for clients, execute plugin code, or perform platform/network actions.
