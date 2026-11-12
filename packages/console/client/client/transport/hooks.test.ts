import { describe, expect, it } from "vitest";

import { resolveKeyedValue, transactionFailure } from "./hooks.js";

describe("resolveKeyedValue (useConfig stale-state guard)", () => {
  it("returns the value when the entry key matches", () => {
    const entry = { key: "plugin-a", value: { foo: 1 } };
    expect(resolveKeyedValue(entry, "plugin-a")).toEqual({ foo: 1 });
  });

  it("treats a previous plugin's leftover state as empty after pluginName switches", () => {
    // 回归：旧实现中 config state 跨 pluginName 残留，ready(config != null) 永远为真，
    // 切换插件后不再自动加载新配置。
    const stale = { key: "plugin-a", value: { foo: 1 } };
    expect(resolveKeyedValue(stale, "plugin-b")).toBeNull();
  });

  it("returns null when nothing has been loaded", () => {
    expect(resolveKeyedValue(null, "plugin-a")).toBeNull();
  });
});

describe("transactionFailure (install / uninstall / update hooks)", () => {
  const base = { id: "t1", operation: "install", packages: [], instance: { before: "running", after: "running" } } as const;
  it("is null for a successful transaction", () => {
    expect(transactionFailure({ ...base, ok: true, status: "succeeded" } as never)).toBeNull();
  });
  it("reports a rolled-back transaction as the hook error", () => {
    expect(transactionFailure({ ...base, ok: false, status: "rolledBack", failedPhase: "start-instance", error: "instance did not start" } as never))
      .toBe("instance did not start（已回滚，失败阶段 start-instance）");
    expect(transactionFailure({ ...base, ok: false, status: "rollbackFailed", error: "boom", rollbackError: "disk full" } as never))
      .toBe("boom（回滚未完成：disk full）");
  });
});
