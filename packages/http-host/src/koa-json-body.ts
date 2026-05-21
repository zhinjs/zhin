import type Koa from "koa";
import { Readable } from "node:stream";

/**
 * Koa 3 respond() cannot pipeline plain objects; serialize JSON for Console API routes on koa fallback.
 */
export function koaJsonBodyMiddleware(): Koa.Middleware {
  return async (ctx, next) => {
    await next();
    const b = ctx.body;
    if (b == null) return;
    if (typeof b === "string" || Buffer.isBuffer(b)) return;
    if (b instanceof ReadableStream) return;
    if (b instanceof Readable) return;
    if (typeof b === "object") {
      // Avoid Koa 3 treating duck-typed streams as pipeline bodies
      const maybeStream = b as { pipe?: unknown; readable?: unknown };
      if (typeof maybeStream.pipe === "function" && maybeStream.readable) return;
      if (!ctx.response.get("Content-Type")) {
        ctx.type = "application/json; charset=utf-8";
      }
      ctx.body = JSON.stringify(b);
    }
  };
}
