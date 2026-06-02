import { build } from "esbuild";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";

const bundleCache = new Map<string, string>();

const tmpDir = path.join(os.tmpdir(), "zhin-console-plugin-bundles");

function cacheKeyWithMtime(cacheKey: string, absSource: string): string {
  try {
    return `${cacheKey}:${statSync(absSource).mtimeMs}`;
  } catch {
    return cacheKey;
  }
}

export async function bundleEntryToTempFile(
  cacheKey: string,
  absSource: string,
  resolveDir: string,
): Promise<string> {
  const keyed = cacheKeyWithMtime(cacheKey, absSource);
  const cached = bundleCache.get(keyed);
  if (cached && existsSync(cached)) return cached;

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const hash = createHash("sha256").update(keyed).digest("hex").slice(0, 12);
  const outfile = path.join(tmpDir, `${hash}.mjs`);

  await build({
    entryPoints: [absSource],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    minify: false,
    external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "react-router", "react-router-dom"],
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs"],
    absWorkingDir: resolveDir,
    logLevel: "warning",
  });

  bundleCache.set(keyed, outfile);
  return outfile;
}
