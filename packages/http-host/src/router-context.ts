/**
 * Minimal router context for Koa-router style handlers.
 */
export type RouterContext = {
  /** 原始 Fetch Request（WebSocket upgrade 等需要） */
  req: Request;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  request: {
    body: unknown;
    headers: Headers;
  };
  status: number;
  body: unknown;
  set: (name: string, value: string) => void;
  get: (name: string) => string | undefined;
  _responseHeaders: Map<string, string>;
};

export function createRouterContext(
  req: Request,
  params: Record<string, string>,
  body: unknown,
): RouterContext {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  const responseHeaders = new Map<string, string>();
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const ctx: RouterContext = {
    req,
    method: req.method,
    path: url.pathname,
    params,
    query,
    request: { body, headers },
    status: 200,
    body: undefined,
    _responseHeaders: responseHeaders,
    set(name, value) {
      responseHeaders.set(name, value);
    },
    get(name) {
      return headers.get(name) ?? undefined;
    },
  };
  return ctx;
}

export function contextToResponse(ctx: RouterContext): Response {
  if (ctx.body instanceof Response) {
    return ctx.body;
  }
  const status = ctx.status || 200;
  const headers = new Headers(Object.fromEntries(ctx._responseHeaders));
  if (ctx.body instanceof ReadableStream) {
    return new Response(ctx.body, { status, headers });
  }
  if (ctx.body === undefined) {
    return new Response(null, { status, headers });
  }
  if (typeof ctx.body === "string" || ctx.body instanceof Uint8Array) {
    return new Response(ctx.body as BodyInit, { status, headers });
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(ctx.body), { status, headers });
}
