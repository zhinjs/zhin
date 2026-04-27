import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";

const bundleCache = new Map<string, string>();

const tmpDir = path.join(os.tmpdir(), "zhin-console-plugin-bundles");

export async function bundleEntryToTempFile(
  cacheKey: string,
  absSource: string,
  resolveDir: string,
): Promise<string> {
  const cached = bundleCache.get(cacheKey);
  if (cached && existsSync(cached)) return cached;

  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 12);
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

  bundleCache.set(cacheKey, outfile);
  return outfile;
}
