#!/usr/bin/env node

import { build } from "./build.js";
import path from "path";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case "build":
        // 构建当前目录的插件客户端代码
        console.log("🔨 Building plugin client...");
        await build(process.cwd());
        break;
    }
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

main();
