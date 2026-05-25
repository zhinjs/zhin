import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Wrangler/Workers 打包后 import.meta.url 常不可用，回退 cwd 或 ZHIN_PROJECT_ROOT */
export function resolveEdgeProjectRoot(): string {
  const fromEnv =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.ZHIN_PROJECT_ROOT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }

  const meta = import.meta.url;
  if (typeof meta === "string" && meta.length > 0) {
    return path.resolve(path.dirname(fileURLToPath(meta)), "..");
  }
  return path.resolve(process.cwd());
}
