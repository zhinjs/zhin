import { describe, expect, it, vi } from "vitest";
import {
  createPluginRegisterHostApi,
  getRegisterFn,
  resolveEntryRegister,
} from "./loadConsoleEntries.js";

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

  it("synthesizes register from default component + entry.route", () => {
    const Page = () => null;
    const register = resolveEntryRegister(
      { default: Page, meta: { title: "Sandbox", icon: "Box" } },
      { id: "sandbox", resolvedModule: "/assets/client/sandbox.js", route: "/p-sandbox" } as any,
    );
    expect(typeof register).toBe("function");
    const addRoute = vi.fn();
    const createElement = vi.fn((c: unknown) => ({ type: c }));
    register!({
      React: { createElement } as any,
      addRoute,
      addPage: addRoute,
      addTool: vi.fn(),
    });
    expect(addRoute).toHaveBeenCalledWith(expect.objectContaining({
      path: "/p-sandbox",
      name: "Sandbox",
      icon: "Box",
    }));
    expect(createElement).toHaveBeenCalledWith(Page);
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
