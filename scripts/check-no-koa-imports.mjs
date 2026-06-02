#!/usr/bin/env node
/**
 * Fail if plugins import Koa types directly (use RouterContext / registerFetchRoute).
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginsDir = path.join(root, "plugins");
/** host-router 插件内部允许直接 import koa */
const hostRouterSrc = path.join(root, "packages", "host", "router", "src");
function isHostRouterInternal(file) {
  const rel = path.relative(hostRouterSrc, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
const bad = /from\s+['"]koa['"]|require\s*\(\s*['"]koa['"]\s*\)/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "lib" || name === "dist") continue;
      walk(p, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(pluginsDir)) {
  const text = fs.readFileSync(file, "utf8");
  if (bad.test(text) && !isHostRouterInternal(file)) violations.push(path.relative(root, file));
}

if (violations.length) {
  console.error("Koa imports found in plugins (use @zhin.js/host-router RouterContext):");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("check-no-koa-imports: ok");
