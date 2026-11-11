import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRegisterHostApi } from "@zhin.js/contract";
import { ConsoleApp } from "../app.js";
import {
  getRegisterFn,
  loadConsoleEntries,
  reloadConsoleEntries,
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

  it("forwards the page section into route meta; module meta wins, unknown values are dropped", () => {
    const Page = () => null;
    const routeMeta = (mod: Record<string, unknown>, entry: Record<string, unknown>) => {
      const addRoute = vi.fn();
      resolveEntryRegister(mod, { id: "p", resolvedModule: "/p.js", route: "/p", ...entry } as any)!({
        React: { createElement: vi.fn() } as any, addRoute, addTool: vi.fn(),
      });
      return addRoute.mock.calls[0]![0].meta as Record<string, unknown>;
    };
    expect(routeMeta({ default: Page }, { section: "ops" })).toMatchObject({ section: "ops" });
    expect(routeMeta({ default: Page }, { meta: { section: "access" } })).toMatchObject({ section: "access" });
    expect(routeMeta({ default: Page, meta: { section: "features" } }, { section: "ops" })).toMatchObject({ section: "features" });
    expect(routeMeta({ default: Page }, { section: "nowhere" })).not.toHaveProperty("section");
    expect(routeMeta({ default: Page }, {})).not.toHaveProperty("section");
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

describe("console entries reload", () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function entryModule(source: string): string {
    const dir = mkdtempSync(join(tmpdir(), "zhin-console-entry-"));
    dirs.push(dir);
    const file = join(dir, "entry.mjs");
    writeFileSync(file, source);
    return pathToFileURL(file).href;
  }

  function serveEntries(...responses: Array<Array<{ id: string; resolvedModule: string }>>) {
    const queue = [...responses];
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ entries: queue.shift() ?? [], runtimeEnvHint: null }),
    } as Response)));
  }

  function hostApiFor(app: ConsoleApp): PluginRegisterHostApi {
    return {
      React: {} as never,
      addRoute: (input) => app.addRoute(input),
      addTool: (input) => app.addTool(input),
      removeRoute: (path) => app.removeRoute(path),
      removeTool: (id) => app.removeTool(id),
    };
  }

  const toolIds = (app: ConsoleApp) => app.getToolTree().map((tool) => tool.id);
  const routePaths = (app: ConsoleApp) => app.getRoutes().map((route) => route.path);

  it("removes routes and tools of entries that disappeared and keeps tool ids stable", async () => {
    const alpha = {
      id: "alpha",
      resolvedModule: entryModule(`export function register(api) {
        api.addRoute({ path: "/alpha", name: "Alpha", element: null });
        api.addTool({ name: "Alpha Tool" });
        api.addTool({ name: "Alpha Tool" });
      }`),
    };
    const beta = {
      id: "beta",
      resolvedModule: entryModule(`export function register(api) {
        api.addRoute({ path: "/beta", name: "Beta", element: null });
        api.addTool({ id: "beta-tool", name: "Beta Tool" });
      }`),
    };
    serveEntries([alpha, beta], [alpha, beta], [alpha], []);
    const app = new ConsoleApp();
    const onEmpty = vi.fn();
    const options = { hostApi: hostApiFor(app), entriesUrl: "http://host.test/entries", onEmpty };

    await loadConsoleEntries(options);
    expect(routePaths(app).sort()).toEqual(["/alpha", "/beta"]);
    expect(toolIds(app).sort()).toEqual(["alpha:alpha-tool", "alpha:alpha-tool-2", "beta-tool"]);

    // Same entries: nothing is duplicated (a random id used to add one tool per reload).
    await reloadConsoleEntries(options);
    expect(routePaths(app).sort()).toEqual(["/alpha", "/beta"]);
    expect(toolIds(app).sort()).toEqual(["alpha:alpha-tool", "alpha:alpha-tool-2", "beta-tool"]);

    // beta was uninstalled.
    await reloadConsoleEntries(options);
    expect(routePaths(app)).toEqual(["/alpha"]);
    expect(toolIds(app).sort()).toEqual(["alpha:alpha-tool", "alpha:alpha-tool-2"]);

    // Everything is gone.
    await reloadConsoleEntries(options);
    expect(routePaths(app)).toEqual([]);
    expect(toolIds(app)).toEqual([]);
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("drops a route an entry stopped registering and keeps the old registration when a reload fails", async () => {
    (globalThis as { __entryMode?: string }).__entryMode = "both";
    const gamma = {
      id: "gamma",
      resolvedModule: entryModule(`export function register(api) {
        const mode = globalThis.__entryMode;
        if (mode === "broken") throw new Error("boom");
        api.addRoute({ path: "/gamma", name: "Gamma", element: null });
        if (mode === "both") api.addRoute({ path: "/gamma/extra", name: "Extra", element: null });
      }`),
    };
    serveEntries([gamma], [gamma], [gamma]);
    const app = new ConsoleApp();
    const onEntryError = vi.fn();
    const options = { hostApi: hostApiFor(app), entriesUrl: "http://host.test/entries", onEntryError };

    await loadConsoleEntries(options);
    expect(routePaths(app).sort()).toEqual(["/gamma", "/gamma/extra"]);

    (globalThis as { __entryMode?: string }).__entryMode = "broken";
    await reloadConsoleEntries(options);
    expect(onEntryError).toHaveBeenCalledTimes(1);
    expect(routePaths(app).sort()).toEqual(["/gamma", "/gamma/extra"]);

    (globalThis as { __entryMode?: string }).__entryMode = "single";
    await reloadConsoleEntries(options);
    expect(routePaths(app)).toEqual(["/gamma"]);
    delete (globalThis as { __entryMode?: string }).__entryMode;
  });

  it("does not re-add a known tool on a host API without removeTool", async () => {
    const delta = {
      id: "delta",
      resolvedModule: entryModule(`export function register(api) { api.addTool({ name: "Delta" }); }`),
    };
    serveEntries([delta], [delta]);
    const addTool = vi.fn((input: { id?: string }) => input.id ?? "generated");
    const hostApi: PluginRegisterHostApi = { React: {} as never, addRoute: vi.fn(), addTool };

    const options = { hostApi, entriesUrl: "http://host.test/entries" };
    await loadConsoleEntries(options);
    await reloadConsoleEntries(options);

    expect(addTool).toHaveBeenCalledTimes(1);
    expect(addTool).toHaveBeenCalledWith({ id: "delta:delta", name: "Delta" });
  });
});
