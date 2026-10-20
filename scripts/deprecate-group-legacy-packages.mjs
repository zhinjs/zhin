#!/usr/bin/env node
/**
 * 将已合并进 @zhin.js/plugin-group-suite 的五个旧包在 npm 上标记为废弃。
 *
 * 用法（需 npm 发布权限）：
 *   npm login
 *   node scripts/deprecate-group-legacy-packages.mjs
 *
 * 或：
 *   NODE_AUTH_TOKEN=<npm-token> node scripts/deprecate-group-legacy-packages.mjs
 */

import { execSync } from "node:child_process";

const MSG =
  "已合并至 @zhin.js/plugin-group-suite，请改用 group-suite 并迁移 groupSuite 扁平配置。";

const PACKAGES = [
  "@zhin.js/plugin-group-admin",
  "@zhin.js/plugin-checkin",
  "@zhin.js/plugin-stats",
  "@zhin.js/plugin-group-daily-analysis",
  "@zhin.js/plugin-teach",
];

function sh(cmd) {
  execSync(cmd, { stdio: "inherit", encoding: "utf-8" });
}

if (!process.env.NODE_AUTH_TOKEN) {
  try {
    sh("npm whoami");
  } catch {
    console.error(
      "未登录 npm：请先执行 npm login，或设置 NODE_AUTH_TOKEN 后重试。",
    );
    process.exit(1);
  }
}

for (const name of PACKAGES) {
  const quoted = JSON.stringify(MSG);
  console.log(`\n→ deprecate ${name}@*`);
  sh(`npm deprecate ${name}@* ${quoted}`);
}

console.log("\n完成：五个旧包已全部标记 deprecated。");
