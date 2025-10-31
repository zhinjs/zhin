#!/usr/bin/env node

import { buildCurrentPlugin, buildConsoleClient } from "./build.js";
import path from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case "build":
        // 构建当前目录的插件客户端代码
        console.log("🔨 Building plugin client...");
        await buildCurrentPlugin();
        break;

      case "build:console":
        // 构建 console 插件的客户端代码
        console.log("🔨 Building console client...");
        const consoleRoot = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          ".."
        );
        await buildConsoleClient({ consoleRoot });
        break;

      default:
        console.log(`
Zhin.js Client Builder

Usage:
  zhin-client build          Build current plugin's client code
  zhin-client build:console  Build console plugin's client code (SPA mode)

Examples:
  # Build a plugin (single file mode)
  cd my-plugin && zhin-client build

  # Build console (SPA mode)
  zhin-client build:console
        `);
        process.exit(1);
    }
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

main();
