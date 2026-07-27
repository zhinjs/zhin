import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPlugin, generatePluginFiles } from "../src/plugin-template.js";

describe("create_plugin 模板（新 Plugin Runtime 格式）", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  });

  it("生成的 plugin.ts 含 definePlugin 且不含 usePlugin", () => {
    const files = generatePluginFiles("echo-bot", "回声插件", []);

    expect(Object.keys(files)).toEqual(["plugin.ts"]);
    expect(files["plugin.ts"]).toContain("definePlugin");
    expect(files["plugin.ts"]).toContain("export default definePlugin({");
    expect(files["plugin.ts"]).toContain("name: 'echo-bot'");
    expect(files["plugin.ts"]).not.toContain("usePlugin");
  });

  it("command/middleware/component 走约定目录 defineX 格式", () => {
    const files = generatePluginFiles("my-tools", "工具集", ["command", "middleware", "component"]);

    const command = files["commands/my-tools.ts"];
    expect(command).toContain("defineCommand");
    expect(command).toContain("export default defineCommand({");
    expect(command).not.toContain("usePlugin");
    expect(command).not.toContain("addCommand");

    const middleware = files["middlewares/my-tools.ts"];
    expect(middleware).toContain("defineMiddleware");
    expect(middleware).not.toContain("usePlugin");

    const component = files["components/my-tools.ts"];
    expect(component).toContain("defineComponent");
    expect(component).not.toContain("usePlugin");
    expect(component).not.toContain("addComponent");
  });

  it("database 功能在 setup 里通过 databaseHostToken 定义表", () => {
    const files = generatePluginFiles("notes", "笔记", ["database"]);

    expect(files["plugin.ts"]).toContain("databaseHostToken");
    expect(files["plugin.ts"]).toContain("setup(context)");
    expect(files["plugin.ts"]).toContain("db.define('notes_data'");
    expect(files["plugin.ts"]).not.toContain("usePlugin");
    expect(files["plugin.ts"]).not.toContain("defineModel");
  });

  it("非法插件名直接报错", () => {
    expect(() => generatePluginFiles("Bad_Name", "x", [])).toThrow("不合法");
  });

  it("createPlugin 写入插件目录且拒绝路径遍历", async () => {
    const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "zhin-mcp-template-"));
    tempDirs.push(projectRoot);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
    try {
      const message = await createPlugin({
        name: "demo",
        description: "示例插件",
        features: ["command"],
      });
      const pluginDir = path.join(projectRoot, "src/plugins/demo");
      expect(message).toContain(pluginDir);
      expect(fs.readFileSync(path.join(pluginDir, "plugin.ts"), "utf8")).toContain("definePlugin");
      expect(fs.readFileSync(path.join(pluginDir, "commands/demo.ts"), "utf8")).toContain("defineCommand");

      await expect(createPlugin({
        name: "escape",
        description: "逃逸",
        directory: "..",
      })).rejects.toThrow("安全错误");
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
