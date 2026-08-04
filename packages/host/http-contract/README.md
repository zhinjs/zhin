# @zhin.js/host-http-contract

The zero-business-dependency boundary shared by Zhin HTTP protocol hosts.

It provides `HttpRouteHost` for mounting protocol routes and `readJsonBody()`
for bounded JSON request parsing. It intentionally does not expose listeners,
authentication, WebSockets, or OpenAPI construction; those are responsibilities
of `@zhin.js/host-http`.

Tiny, dependency-free Node HTTP request-body contract shared by Zhin hosts.
It contains no routing, authentication, Plugin Runtime, or IM concepts, so
`@zhin.js/host-http`, `@zhin.js/mcp`, and `@zhin.js/a2a` share one body-limit
and error policy without depending on one another.

```ts
import { HttpBodyError, readJsonBody } from '@zhin.js/host-http-contract';

try {
  const body = await readJsonBody(request); // 1 MiB default limit
} catch (error) {
  const status = error instanceof HttpBodyError ? error.statusCode : 400;
  response.writeHead(status).end();
}
```

`readJsonBody()` drains oversized bodies before throwing `HttpBodyError(413)`.
That lets the caller send a reliable response without prematurely destroying a
keep-alive socket.
