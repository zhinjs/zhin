import { describe, expect, it, vi } from "vitest";
import {
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
      { default: Page, meta: { title: "Sandbox", titleI18n: { en: "Try a conversation" }, icon: "Box" } },
      { id: "sandbox", resolvedModule: "/assets/client/sandbox.js", route: "/p-sandbox" } as any,
    );
    expect(typeof register).toBe("function");
    const addRoute = vi.fn();
    const createElement = vi.fn((c: unknown) => ({ type: c }));
    register!({
      React: { createElement } as any,
      addRoute,
      addTool: vi.fn(),
    });
    expect(addRoute).toHaveBeenCalledWith(expect.objectContaining({
      path: "/p-sandbox",
      name: "Sandbox",
      icon: "Box",
      meta: { hideInMenu: false, titleI18n: { en: "Try a conversation" } },
    }));
    expect(createElement).toHaveBeenCalledWith(Page);
  });

  it("mounts DeclarativePageView for raw zhin.console.page-blueprint objects", () => {
    const blueprint = {
      kind: "zhin.console.page-blueprint",
      version: 1,
      title: "Cron",
      dataSource: { action: "status" },
      sections: [],
    };
    const register = resolveEntryRegister(
      { default: blueprint, meta: { title: "Cron Jobs" } },
      { id: "root/cron", resolvedModule: "/assets/client/cron.js", route: "/p-cron" } as any,
    );
    expect(typeof register).toBe("function");
    const addRoute = vi.fn();
    const createElement = vi.fn((c: unknown, props: unknown) => ({ type: c, props }));
    register!({
      React: { createElement } as any,
      addRoute,
      addTool: vi.fn(),
    });
    expect(createElement).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        spec: blueprint,
        pageProps: { pluginId: "root/cron", route: "/p-cron", title: "Cron Jobs" },
      }),
    );
  });

  it("mounts AdapterConsolePage for raw zhin.console.adapter-page objects", () => {
    const adapterBp = {
      kind: "zhin.console.adapter-page",
      version: 1,
      adapterKey: "telegram",
      dataSource: { action: "status" },
    };
    const register = resolveEntryRegister(
      { default: adapterBp, meta: { title: "Telegram" } },
      { id: "root/adapter-telegram", resolvedModule: "/assets/client/tg.js", route: "/p-telegram" } as any,
    );
    expect(typeof register).toBe("function");
    const addRoute = vi.fn();
    const createElement = vi.fn((c: unknown, props: unknown) => ({ type: c, props }));
    register!({
      React: { createElement } as any,
      addRoute,
      addTool: vi.fn(),
    });
    expect(createElement).toHaveBeenCalledWith(
      expect.any(Function),
      { adapterKey: "telegram" },
    );
  });
});
