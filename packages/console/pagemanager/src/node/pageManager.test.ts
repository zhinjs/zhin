import { describe, expect, it } from "vitest";
import Koa from "koa";
import { PageManager } from "./pageManager.js";
import { createInMemoryEntryStore } from "./entryStore.js";

function createManager(entryStore = createInMemoryEntryStore()) {
  return new PageManager({
    koa: new Koa(),
    clientPackageRoot: process.cwd(),
    entryStore,
  });
}

describe("PageManager", () => {
  it("keeps entries isolated per instance by default", () => {
    const first = createManager();
    const second = createManager();

    first.addEntry({
      id: "first",
      development: "/dev/first.tsx",
      production: "/dist/first.js",
    });

    expect(first.entryStore.list().map(entry => entry.id)).toEqual(["first"]);
    expect(second.entryStore.list()).toEqual([]);
  });

  it("uses injected entryStore", () => {
    const store = createInMemoryEntryStore();
    const manager = createManager(store);

    manager.addEntry({
      id: "injected",
      development: "/dev/injected.tsx",
      production: "/dist/injected.js",
    });

    expect(store.list().map(entry => entry.id)).toEqual(["injected"]);
  });
});

