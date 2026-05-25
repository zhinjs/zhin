/**
 * 构建 Edge Console 静态资源（对齐 Host 的 /@assets + /esm 代理）。
 * 在 monorepo 根或本目录执行：node scripts/build-console-assets.mjs
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND_ROOT = path.resolve(
  process.env.PLAYGROUND_ROOT ?? path.join(__dirname, ".."),
);
const REPO_ROOT = path.resolve(PLAYGROUND_ROOT, "../..");

function resolveEsbuild() {
  const toolsDir = process.env.DEPLOY_TOOLS_DIR;
  const candidates = [
    toolsDir && path.join(toolsDir, "node_modules/esbuild/package.json"),
    path.join(PLAYGROUND_ROOT, "package.json"),
    path.join(REPO_ROOT, "packages/console-core/package.json"),
    path.join(REPO_ROOT, "package.json"),
  ].filter(Boolean);
  for (const pkg of candidates) {
    if (!existsSync(pkg)) continue;
    try {
      return createRequire(pkg).resolve("esbuild");
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "esbuild not found; run: cd examples/deno-deploy-playground && npm install (or node scripts/prepare-deploy.mjs)",
  );
}

const { build } = await import(resolveEsbuild());
const SANDBOX_ROOT = path.join(REPO_ROOT, "plugins/adapters/sandbox");
const SANDBOX_ENTRY = path.join(SANDBOX_ROOT, "client/index.tsx");
const OUT_ROOT = path.join(PLAYGROUND_ROOT, "static/console");
const ASSETS_DIR = path.join(OUT_ROOT, "assets");
const ESM_DIR = path.join(OUT_ROOT, "esm");

const CONSOLE_SHARED_MODULES_KEY = "__ZHIN_CONSOLE_SHARED_MODULES__";

const ALLOWED_ESM_CANONICAL = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-router",
  "react-router-dom",
];

const HOST_PROXIED_MODULES = new Set(ALLOWED_ESM_CANONICAL);

/** discoverCjsExports 失败时的兜底（须与 Host Console 注册的 CJS 导出一致） */
const KNOWN_NAMED_EXPORTS = {
  "react/jsx-runtime": ["Fragment", "jsx", "jsxs"],
  "react/jsx-dev-runtime": ["Fragment", "jsx", "jsxs", "jsxDEV"],
  react: [
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "cloneElement",
    "createContext",
    "createElement",
    "createFactory",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "version",
  ],
};

const ESM_DISCOVER_RESOLVE_DIRS = [
  path.join(REPO_ROOT, "plugins/services/console"),
  SANDBOX_ROOT,
  path.join(REPO_ROOT, "packages/console-app"),
  REPO_ROOT,
];

function encodeSpecifierSegment(specifier) {
  return encodeURIComponent(specifier).replace(/%2F/g, "~");
}

function joinConsolePublicPath(basePath, subpath) {
  const base =
    basePath === "/" || basePath === ""
      ? ""
      : basePath.replace(/\/$/, "").replace(/^\/+/, "");
  const rest = subpath.replace(/^\/+/, "");
  return base ? `/${base}/${rest}` : `/${rest}`;
}

function discoverCjsExports(canonical, resolveDirs) {
  for (const resolveDir of resolveDirs) {
    const req = createRequire(path.join(resolveDir, "_virtual.cjs"));
    try {
      const mod = req(canonical);
      if (mod && typeof mod === "object") {
        const keys = Object.keys(mod).filter(
          (k) => k !== "default" && k !== "__esModule" && /^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(k),
        );
        if (keys.length) return keys;
      }
    } catch {
      /* try next resolveDir */
    }
  }
  return [];
}

function resolveNamedExports(canonical) {
  const discovered = discoverCjsExports(canonical, ESM_DISCOVER_RESOLVE_DIRS);
  const known = KNOWN_NAMED_EXPORTS[canonical] ?? [];
  return [...new Set([...discovered, ...known])];
}

function buildHostProxyModule(canonical, namedExports) {
  const lines = [
    `const _m = globalThis[${JSON.stringify(CONSOLE_SHARED_MODULES_KEY)}]?.get(${JSON.stringify(canonical)});`,
    `if (!_m) throw new Error("[zhin-console] Host module not registered: ${canonical}");`,
    `export default _m;`,
    ...namedExports.map((n) => `export const ${n} = _m.${n};`),
  ];
  return lines.join("\n");
}

function rewriteBareImportsForBrowser(code, basePath) {
  const tag = "edge";
  for (const canonical of ALLOWED_ESM_CANONICAL) {
    const enc = encodeSpecifierSegment(canonical);
    const esmUrl = `${joinConsolePublicPath(basePath, `esm/${enc}.mjs`)}?v=${tag}`;
    const pattern = new RegExp(
      `from\\s*["']${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "g",
    );
    code = code.replace(pattern, `from "${esmUrl}"`);
  }
  return code;
}

async function writeEsmProxies() {
  for (const canonical of HOST_PROXIED_MODULES) {
    const named = resolveNamedExports(canonical);
    const code = buildHostProxyModule(canonical, named);
    const enc = encodeSpecifierSegment(canonical);
    const out = path.join(ESM_DIR, `${enc}.mjs`);
    writeFileSync(out, code, "utf8");
    console.log(`[console-assets] esm ${canonical} -> ${path.relative(PLAYGROUND_ROOT, out)}`);
  }
}

async function writeSandboxAsset() {
  if (!existsSync(SANDBOX_ENTRY)) {
    throw new Error(`Missing sandbox client entry: ${SANDBOX_ENTRY}`);
  }
  const outfile = path.join(ASSETS_DIR, "sandbox.mjs");
  await build({
    entryPoints: [SANDBOX_ENTRY],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    minify: false,
    external: [...HOST_PROXIED_MODULES],
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs"],
    absWorkingDir: SANDBOX_ROOT,
    logLevel: "warning",
  });
  let code = readFileSync(outfile, "utf8");
  code = rewriteBareImportsForBrowser(code, "");
  writeFileSync(outfile, code, "utf8");
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
  console.log(`[console-assets] sandbox.mjs (${code.length} bytes, sha ${hash})`);
}

function collectMjsManifest(dir, prefix = "") {
  const out = {};
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      Object.assign(out, collectMjsManifest(full, rel));
    } else if (ent.name.endsWith(".mjs")) {
      out[rel] = readFileSync(full, "utf8");
    }
  }
  return out;
}

function writeEmbeddedManifest() {
  const manifest = collectMjsManifest(OUT_ROOT);
  const keys = Object.keys(manifest);
  if (!keys.length) {
    throw new Error("[console-assets] no .mjs files under static/console");
  }
  const outPath = path.join(PLAYGROUND_ROOT, "src/console-assets.manifest.json");
  writeFileSync(outPath, JSON.stringify(manifest), "utf8");
  console.log(
    `[console-assets] manifest ${keys.length} files -> ${path.relative(PLAYGROUND_ROOT, outPath)}`,
  );
}

mkdirSync(ASSETS_DIR, { recursive: true });
mkdirSync(ESM_DIR, { recursive: true });
await writeEsmProxies();
await writeSandboxAsset();
writeEmbeddedManifest();
console.log("[console-assets] done");
