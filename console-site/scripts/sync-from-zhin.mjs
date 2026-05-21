#!/usr/bin/env node
/**
 * Copy console shell + builtin UI from the zhin monorepo into this site repo.
 * Run from zhin monorepo: node console-site/scripts/sync-from-zhin.mjs
 * Or in zhin-console clone: ZHIN_MONOREPO_ROOT=/path/to/zhin node scripts/sync-from-zhin.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = path.resolve(
  process.env.ZHIN_MONOREPO_ROOT ?? path.join(siteRoot, ".."),
);

function assertDir(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`[sync-from-zhin] Missing ${label}: ${p}`);
    process.exit(1);
  }
}

const copies = [
  {
    from: path.join(monorepoRoot, "packages/console-app/client"),
    to: path.join(siteRoot, "client"),
    label: "console-app/client",
  },
  {
    from: path.join(monorepoRoot, "plugins/services/console/client"),
    to: path.join(siteRoot, "console-ui"),
    label: "console plugin client",
  },
];

assertDir(path.join(monorepoRoot, "packages/console-app"), "zhin monorepo (packages/console-app)");
assertDir(path.join(monorepoRoot, "plugins/services/console/client"), "zhin monorepo (console client)");

for (const { from, to, label } of copies) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`[sync-from-zhin] ${label} → ${path.relative(siteRoot, to)}`);
}

const prepareSrc = path.join(monorepoRoot, "packages/console-app/scripts/prepare-github-pages.mjs");
const prepareDst = path.join(siteRoot, "scripts/prepare-github-pages.mjs");
if (fs.existsSync(prepareSrc)) {
  fs.copyFileSync(prepareSrc, prepareDst);
  console.log("[sync-from-zhin] prepare-github-pages.mjs");
}

const tailwindPath = path.join(siteRoot, "client/tailwind.config.js");
if (fs.existsSync(tailwindPath)) {
  let tw = fs.readFileSync(tailwindPath, "utf8");
  tw = tw.replace(
    /content:\s*\[[\s\S]*?\],/,
    `content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
    path.join(siteRoot, "console-ui/src/**/*.{js,ts,jsx,tsx}"),
  ],`,
  );
  tw = tw.replace(
    /const repoRoot = path\.resolve\(__dirname, '\.\.\/\.\.\/\.\.'\);?\n?/,
    `const siteRoot = path.resolve(__dirname, "..");\n`,
  );
  fs.writeFileSync(tailwindPath, tw);
  console.log("[sync-from-zhin] patched client/tailwind.config.js for standalone site");
}

console.log("[sync-from-zhin] Done. Commit client/ + console-ui/ in zhin-console, then pnpm install && pnpm build.");
