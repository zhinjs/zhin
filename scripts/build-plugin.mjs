#!/usr/bin/env node
/**
 * 通用插件构建脚本（不依赖 zhin CLI binary）。
 *
 * 用法（从插件 package.json#scripts.build）：
 *   node ../../../scripts/build-plugin.mjs
 *
 * 逻辑：有 src/ 就 tsc；有 client/ 就 esbuild bundle → dist/。
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, "..");

const CLIENT_ENTRIES = [
  "index.tsx", "index.ts", "index.jsx", "index.js",
  "main.tsx", "main.ts", "src/index.tsx", "src/index.ts",
];
const CLIENT_EXTERNAL = [
  "react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime",
  "react-dom/client", "@zhin.js/client", "@zhin.js/console-types",
  "@zhin.js/console-core", "react-router-dom", "react-router",
];

function findEsbuild() {
  const candidates = [
    join(MONOREPO_ROOT, "basic/cli/node_modules/esbuild"),
    join(MONOREPO_ROOT, "plugins/services/console/node_modules/esbuild"),
    join(MONOREPO_ROOT, "node_modules/esbuild"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "package.json"))) return p;
  }
  const require = createRequire(join(MONOREPO_ROOT, "basic/cli/package.json"));
  return dirname(require.resolve("esbuild/package.json"));
}

const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd();

const hasSrc = existsSync(join(cwd, "src"));
const hasClient = existsSync(join(cwd, "client"));

if (!hasSrc && !hasClient) {
  console.log("[build-plugin] 无 src/ 或 client/，跳过。");
  process.exit(0);
}

if (hasSrc) {
  const tsconfig = ["tsconfig.build.json", "tsconfig.json"].find((n) =>
    existsSync(join(cwd, n)),
  );
  if (tsconfig) {
    console.log(`[build-plugin] tsc -p ${tsconfig}`);
    execSync(`npx tsc -p ${tsconfig}`, { cwd, stdio: "inherit" });
  } else {
    console.log("[build-plugin] src/ 存在但无 tsconfig，跳过 tsc。");
  }
}

if (hasClient) {
  const clientRoot = join(cwd, "client");
  const entry = CLIENT_ENTRIES.map((e) => join(clientRoot, e)).find(existsSync);
  if (entry) {
    const outDir = join(cwd, "dist");
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const base = basename(entry).replace(/\.[^.]+$/, "");
    const outfile = join(outDir, base === "index" ? "index.js" : `${base}.js`);
    console.log(`[build-plugin] esbuild client → ${outfile}`);

    const esbuildDir = findEsbuild();
    const esbuild = await import(pathToFileURL(join(esbuildDir, "lib/main.js")).href);
    await esbuild.build({
      absWorkingDir: cwd,
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      jsx: "automatic",
      minify: true,
      sourcemap: false,
      logLevel: "warning",
      external: CLIENT_EXTERNAL,
    });
  } else {
    console.log("[build-plugin] client/ 存在但未找到入口文件，跳过。");
  }
}
