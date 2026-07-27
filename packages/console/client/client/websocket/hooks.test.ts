import { describe, expect, it } from "vitest";

import { resolveKeyedValue } from "./hooks.js";

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
