import { describe, expect, it } from "vitest";
import { RouteTable } from "../src/route-table.js";

describe("RouteTable :param+ splat", () => {
  it("matches multi-segment package name", async () => {
    const table = new RouteTable();
    table.get("/pub/marketplace/detail/:name+", (ctx) => {
      ctx.body = { name: ctx.params.name };
    });
    const res = await table.dispatch(
      new Request("http://localhost/pub/marketplace/detail/@zhin.js/adapter-icqq"),
      undefined,
    );
    expect(res?.status).toBe(200);
    const json = await res!.json();
    expect(json).toEqual({ name: "@zhin.js/adapter-icqq" });
  });
});
