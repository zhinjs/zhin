import { build } from "esbuild";
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { CONSOLE_SHARED_MODULES_KEY } from "@zhin.js/console-types";

export const ALLOWED_ESM_CANONICAL = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-router",
  "react-router-dom",
]);

const HOST_PROXIED_MODULES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-router",
  "react-router-dom",
]);

const esmCache = new Map<string, string>();
const tmpDir = path.join(os.tmpdir(), "zhin-console-esm");
const esmVersionTag = Date.now().toString(36);

export function encodeSpecifierSegment(specifier: string): string {
  return encodeURIComponent(specifier).replace(/%2F/g, "~");
}

export function decodeSpecifierSegment(enc: string): string {
  return decodeURIComponent(enc.replace(/~/g, "%2F"));
}

function discoverCjsExports(canonical: string, resolveDir: string): string[] {
  const req = createRequire(path.join(resolveDir, "_virtual.js"));
  try {
    const mod = req(canonical);
    if (mod && typeof mod === "object") {
      return Object.keys(mod).filter(
        (k) => k !== "default" && k !== "__esModule" && /^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(k),
      );
    }
  } catch { /* resolve failed */ }
  return [];
}

function buildHostProxyModule(canonical: string, namedExports: string[]): string {
  const lines = [
    `const _m = globalThis[${JSON.stringify(CONSOLE_SHARED_MODULES_KEY)}]?.get(${JSON.stringify(canonical)});`,
    `if (!_m) throw new Error("[zhin-console] Host module not registered: ${canonical}");`,
    `export default _m;`,
    ...namedExports.map((n) => `export const ${n} = _m.${n};`),
  ];
  return lines.join("\n");
}

function buildEsbuildEntrySource(canonical: string, namedExports: string[]): string {
  if (namedExports.length === 0) {
    return [
      `export * from ${JSON.stringify(canonical)};`,
      `export { default } from ${JSON.stringify(canonical)};`,
    ].join("\n");
  }
  return [
    `import _cjsMod from ${JSON.stringify(canonical)};`,
    `export default _cjsMod;`,
    ...namedExports.map((n) => `export const ${n} = _cjsMod.${n};`),
  ].join("\n");
}

export async function getOrBuildCanonicalEsmBundle(
  canonical: string,
  resolveDir: string,
  basePath: string,
): Promise<string> {
  const cached = esmCache.get(canonical);
  if (cached) return cached;

  const namedExports = discoverCjsExports(canonical, resolveDir);

  if (HOST_PROXIED_MODULES.has(canonical)) {
    const code = buildHostProxyModule(canonical, namedExports);
    esmCache.set(canonical, code);
    return code;
  }

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  const outfile = path.join(tmpDir, `${hash}.mjs`);

  const reactExternals = [...HOST_PROXIED_MODULES];
  const entrySource = buildEsbuildEntrySource(canonical, namedExports);

  await build({
    stdin: {
      contents: entrySource,
      resolveDir,
      loader: "js",
    },
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
    external: reactExternals,
  });

  let code = readFileSync(outfile, "utf8");
  code = rewriteBareImportsForBrowser(code, basePath, "");
  esmCache.set(canonical, code);
  return code;
}

export function rewriteBareImportsForBrowser(
  code: string,
  basePath: string,
  _origin: string,
): string {
  for (const canonical of ALLOWED_ESM_CANONICAL) {
    const enc = encodeSpecifierSegment(canonical);
    const esmUrl = `${basePath}/esm/${enc}.mjs?v=${esmVersionTag}`;
    const pattern = new RegExp(
      `from\\s*["']${canonical.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}["']`,
      "g",
    );
    code = code.replace(pattern, `from "${esmUrl}"`);
  }
  return code;
}
