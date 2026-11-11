# @zhin.js/host-http-contract

The zero-business-dependency boundary shared by Zhin HTTP protocol hosts.

It provides the transport-independent route contract (ADR 0054 §2) — `HttpRouteHost`,
`HttpRouteHandler = (request: Request, context: HttpRouteContext) => Response | Promise<Response>`
— plus bounded body readers (`readJsonBody()`, `readTextBody()`, `readBodyBytes()`), `jsonResponse()`
and `createResponseStream()` (a streaming body with backpressure for SSE). It intentionally does not
expose listeners, authentication, WebSockets, or OpenAPI construction; those are responsibilities
of `@zhin.js/host-http`.

Dependency-free and Web standard only (`Request`, `Response`, `ReadableStream`), so
`@zhin.js/host-http`, `@zhin.js/mcp`, and `@zhin.js/a2a` share one body-limit and error policy
without depending on one another or on `node:http`.

```ts
import { HttpBodyError, jsonResponse, readJsonBody } from '@zhin.js/host-http-contract';

try {
  const body = await readJsonBody(request); // 1 MiB default limit
  return jsonResponse(200, { ok: true, body });
} catch (error) {
  const status = error instanceof HttpBodyError ? error.statusCode : 400;
  return new Response(null, { status });
}
```

`readJsonBody()` and `readTextBody()` read oversized bodies to their end before throwing
`HttpBodyError(413)`, so the transport can answer on the same keep-alive connection.
