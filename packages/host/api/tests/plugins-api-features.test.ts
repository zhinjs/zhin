import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandFeature, Plugin, ToolFeature } from "@zhin.js/core";
import {
  buildPluginFeatures,
  buildPluginListItem,
  collectFeatureServices,
  collectOwnContexts,
  contextFeatureJSON,
} from "../src/rest/plugin-inspection.js";

describe("plugin inspection", () => {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../../");
  const testPluginPath = path.join(
    repoRoot,
    "packages/host/api/tests/fixtures/test-plugin.ts",
  );

  it("collects command feature and attributes addCommand to child plugin name", async () => {
    const root = new Plugin("/tmp/test-bot/src/index.ts");
    root.provide(new CommandFeature());
    root.provide(new ToolFeature());
    const child = await root.import(testPluginPath);
    await root.start();

    const featureServices = collectFeatureServices(root);
    const names = featureServices.map((f) => f.name);
    expect(names).toContain("command");
    expect(names).toContain("tool");

    const cmd = root.inject("command")!;
    expect(cmd.items.length).toBeGreaterThan(0);
    expect(child.name).toBe("test-plugin");
    expect(cmd.getByPlugin("test-plugin").length).toBeGreaterThan(0);

    const features = buildPluginFeatures(child, featureServices);
    expect(features.some((f) => f.name === "command")).toBe(true);
  });

  it("includes own provided contexts in features and contextCount", async () => {
    const root = new Plugin("/tmp/test-bot/src/index.ts");
    root.provide(new CommandFeature());
    const child = new Plugin("/tmp/adapters/icqq/src/index.ts", root);
    child.provide({
      name: "icqq",
      description: "ICQQ adapter",
      value: { endpoints: new Map() },
    });

    const contexts = collectOwnContexts(child);
    expect(contexts).toEqual([
      { name: "icqq", description: "ICQQ adapter" },
    ]);

    const ctxFeature = contextFeatureJSON(contexts);
    expect(ctxFeature).toMatchObject({
      name: "context",
      desc: "上下文",
      count: 1,
      items: [{ name: "icqq", desc: "ICQQ adapter" }],
    });

    const item = buildPluginListItem(child, collectFeatureServices(root));
    expect(item.contextCount).toBe(1);
    expect(item.contexts).toHaveLength(1);
    expect(item.features.some((f) => f.name === "context")).toBe(true);
  });

  it("does not aggregate child contexts into parent list item", () => {
    const root = new Plugin("/tmp/test-bot/src/index.ts");
    const child = new Plugin("/tmp/adapters/icqq/src/index.ts", root);
    child.provide({
      name: "icqq",
      description: "ICQQ adapter",
      value: {},
    });

    const parentContexts = collectOwnContexts(root);
    expect(parentContexts).toEqual([]);

    const parentItem = buildPluginListItem(root, []);
    expect(parentItem.contextCount).toBe(0);
    expect(parentItem.features.some((f) => f.name === "context")).toBe(false);
  });
});
