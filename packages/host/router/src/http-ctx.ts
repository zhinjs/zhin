import type { RouterContext } from "./koa-router.js";

/** Koa `ctx.query` 单值（重复键取第一个）。 */
export function firstQuery(ctx: RouterContext, key: string): string | undefined {
  const v = ctx.query[key];
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : String(v);
}

/** Koa `ctx.get` 单值（重复头取第一个）。 */
export function firstHeader(ctx: RouterContext, name: string): string | undefined {
  const v = ctx.get(name);
  if (Array.isArray(v)) return v[0];
  return v;
}

/** 路径参数（含 `*name` 通配时 Koa 可能返回 string[]）。 */
export function paramPath(ctx: RouterContext, key: string): string {
  const v = ctx.params[key];
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join("/");
  return String(v);
}
