import { describe, expect, it, vi } from "vitest";
import { createPluginRegisterHostApi, getRegisterFn } from "./loadConsoleEntries.js";

describe("console entries bootstrap", () => {
  it("resolves named register export", () => {
    const register = () => {};
    expect(getRegisterFn({ register })).toBe(register);
  });

  it("resolves default register export", () => {
    const register = () => {};
    expect(getRegisterFn({ default: { register } })).toBe(register);
  });

  it("returns null when no register export exists", () => {
    expect(getRegisterFn({ default: {} })).toBeNull();
  });

  it("creates a host API with addPage aliased to addRoute", () => {
    const React = {} as any;
    const addRoute = vi.fn();
    const addTool = vi.fn(() => "tool-id");
    const api = createPluginRegisterHostApi({ React, addRoute, addTool });

    api.addPage({ path: "/x", name: "x", element: "page" as any });
    api.addRoute({ path: "/y", name: "y", element: "route" as any });
    expect(api.React).toBe(React);
    expect(addRoute).toHaveBeenCalledTimes(2);
    expect(api.addTool({ id: "t", name: "T" })).toBe("tool-id");
  });
});

