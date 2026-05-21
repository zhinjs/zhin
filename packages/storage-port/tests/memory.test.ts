import { describe, expect, it } from "vitest";
import { createMemoryStoragePort } from "../src/memory-driver.js";

describe("createMemoryStoragePort", () => {
  it("isolates namespaces", async () => {
    const port = createMemoryStoragePort();
    await port.set("a", "k", "1");
    await port.set("b", "k", "2");
    expect(await port.get("a", "k")).toBe("1");
    expect(await port.get("b", "k")).toBe("2");
  });

  it("lists keys by prefix", async () => {
    const port = createMemoryStoragePort();
    await port.set("q", "out:1", {});
    await port.set("q", "out:2", {});
    await port.set("q", "in:1", {});
    const keys = await port.list("q", "out:");
    expect(keys.sort()).toEqual(["out:1", "out:2"]);
  });
});
