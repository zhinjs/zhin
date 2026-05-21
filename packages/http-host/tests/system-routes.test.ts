import { describe, expect, it } from "vitest";
import { RouteTable } from "../src/route-table.js";
import { createFetchApp } from "../src/fetch-app.js";
import { registerSystemStatusRoute } from "../src/system-routes.js";

describe("registerSystemStatusRoute", () => {
  it("returns success envelope at {base}/system/status", async () => {
    const table = new RouteTable();
    registerSystemStatusRoute(table, "/api");
    const app = createFetchApp(table, { base: "/api", token: "secret" });
    const res = await app.fetch(
      new Request("http://localhost/api/system/status", {
        headers: { Authorization: "Bearer secret" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; data: { runtime: string; timestamp: string } };
    expect(json.success).toBe(true);
    expect(json.data.runtime).toBe("node");
    expect(json.data.timestamp).toBeTruthy();
  });
});
