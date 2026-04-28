/**
 * zhin build 的智能构建：优先执行非递归的 package.json#scripts.build，否则对 src/client 做内建 tsc + esbuild。
 */
import fs from "fs-extra";
import path from "path";
import * as esbuild from "esbuild";
import spawn from "cross-spawn";
import { logger } from "../utils/logger.js";

const CLIENT_ENTRY_CANDIDATES = [
  "index.tsx",
  "index.ts",
  "index.jsx",
  "index.js",
  "main.tsx",
  "main.ts",
  "src/index.tsx",
  "src/index.ts",
];

/** 与控制台宿主对齐的常见 browser external（避免与页面 React 双实例） */
const CLIENT_EXTERNAL = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "@zhin.js/client",
  "@zhin.js/console-types",
  "@zhin.js/console-core",
  "react-router-dom",
  "react-router",
];

function isRecursiveZhinBuildScript(script: string): boolean {
  const t = script.trim().replace(/\s+/g, " ");
  if (/^zhin\s+build\b/.test(t)) return true;
  if (/^(?:pnpm|yarn|npm)\s+zhin\s+build\b/.test(t)) return true;
  if (/^pnpm\s+run\s+zhin\s+build\b/.test(t)) return true;
  if (/^npm\s+run\s+zhin\s+build\b/.test(t)) return true;
  if (/^yarn\s+zhin\s+build\b/.test(t)) return true;
  if (/^npx\s+zhin\s+build\b/.test(t)) return true;
  return false;
}

function readPackageJson(cwd: string): {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} | null {
  const p = path.join(cwd, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readJsonSync(p) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function hasZhinJsDep(pkg: NonNullable<ReturnType<typeof readPackageJson>>): boolean {
  const keys = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
  ];
  for (const d of keys) {
    if (d && (d["zhin.js"] || d["@zhin.js/core"])) return true;
  }
  return false;
}

function isPluginLikePackageName(name: string | undefined): boolean {
  if (!name) return false;
  if (name.startsWith("@zhin.js/")) return true;
  if (name.startsWith("zhin.js-")) return true;
  return false;
}

export function shouldUseSmartBuildInCwd(cwd: string): boolean {
  const pkg = readPackageJson(cwd);
  if (!pkg) return false;
  const hasSrc = fs.existsSync(path.join(cwd, "src"));
  const hasClient = fs.existsSync(path.join(cwd, "client"));
  if (!hasSrc && !hasClient) return false;
  if (fs.existsSync(path.join(cwd, "plugin.yml"))) return true;
  if (isPluginLikePackageName(pkg.name)) return true;
  if (hasZhinJsDep(pkg)) return true;
  return false;
}

export function printEmptyPluginDirsError(pluginName: string): void {
  logger.error(
    `插件「${pluginName}」缺少可构建目录：需要存在 src/ 和/或 client/，并配置 tsconfig（若有 TypeScript 服务端代码）。`,
  );
}

function resolveClientEntry(cwd: string): string | null {
  const clientRoot = path.join(cwd, "client");
  if (!fs.existsSync(clientRoot)) return null;
  for (const rel of CLIENT_ENTRY_CANDIDATES) {
    const abs = path.join(clientRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function resolveTsconfig(cwd: string): string | null {
  for (const name of ["tsconfig.build.json", "tsconfig.json"]) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function intrinsicBuildServer(cwd: string): Promise<void> {
  const hasSrc = fs.existsSync(path.join(cwd, "src"));
  if (!hasSrc) return;
  const tsconfig = resolveTsconfig(cwd);
  if (!tsconfig) {
    logger.warn("存在 src/ 但未找到 tsconfig.json / tsconfig.build.json，跳过 tsc。");
    return;
  }
  const r = spawn.sync("npx", ["tsc", "-p", tsconfig], {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(`tsc 失败（${path.relative(cwd, tsconfig)}）`);
  }
}

async function intrinsicBuildClient(
  cwd: string,
  production: boolean,
): Promise<void> {
  const entry = resolveClientEntry(cwd);
  if (!entry) {
    logger.warn("存在 client/ 但未找到入口文件（index/main 或 client/src/index），跳过 client 构建。");
    return;
  }
  const outDir = path.join(cwd, "dist");
  await fs.mkdirp(outDir);
  const base = path.basename(entry).replace(/\.[^.]+$/, "");
  const outfile =
    base === "index" ? path.join(outDir, "index.js") : path.join(outDir, `${base}.js`);

  await esbuild.build({
    absWorkingDir: cwd,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    sourcemap: !production,
    minify: production,
    logLevel: "warning",
    external: [...CLIENT_EXTERNAL],
  });
}

async function intrinsicSmartBuild(
  cwd: string,
  options: { clean: boolean; production: boolean },
): Promise<void> {
  if (options.clean) {
    await fs.remove(path.join(cwd, "lib")).catch(() => {});
    await fs.remove(path.join(cwd, "dist")).catch(() => {});
  }
  await intrinsicBuildServer(cwd);
  if (fs.existsSync(path.join(cwd, "client"))) {
    await intrinsicBuildClient(cwd, options.production);
  }
}

function runPackageBuildScript(cwd: string): void {
  const lockPnpm = fs.existsSync(path.join(cwd, "pnpm-lock.yaml"));
  const lockYarn = fs.existsSync(path.join(cwd, "yarn.lock"));
  const cmd = lockPnpm ? "pnpm" : lockYarn ? "yarn" : "npm";
  const r = spawn.sync(cmd, ["run", "build"], { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    throw new Error(`${cmd} run build 失败`);
  }
}

export async function performSmartBuild(
  cwd: string,
  _label: string,
  options: { clean: boolean; production: boolean },
): Promise<void> {
  const pkg = readPackageJson(cwd);
  const script = pkg?.scripts?.build?.trim();
  if (script && !isRecursiveZhinBuildScript(script)) {
    if (options.clean) {
      await fs.remove(path.join(cwd, "lib")).catch(() => {});
      await fs.remove(path.join(cwd, "dist")).catch(() => {});
    }
    runPackageBuildScript(cwd);
    return;
  }
  await intrinsicSmartBuild(cwd, options);
}

export async function watchClientBundle(cwd: string): Promise<void> {
  const entry = resolveClientEntry(cwd);
  if (!entry) {
    throw new Error("未找到 client 入口文件");
  }
  const outDir = path.join(cwd, "dist");
  await fs.mkdirp(outDir);
  const base = path.basename(entry).replace(/\.[^.]+$/, "");
  const outfile =
    base === "index" ? path.join(outDir, "index.js") : path.join(outDir, `${base}.js`);

  const ctx = await esbuild.context({
    absWorkingDir: cwd,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    sourcemap: true,
    logLevel: "info",
    external: [...CLIENT_EXTERNAL],
  });
  await ctx.watch();
}
