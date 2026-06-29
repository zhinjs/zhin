import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 从应用根（ZHIN_PROJECT_ROOT / cwd）解析 optional peer，避免 core 包目录下 dynamic import 失败 */
export function resolveOptionalPeerPackage(packageName: string): string | undefined {
  const roots = new Set<string>();
  const envRoot = process.env.ZHIN_PROJECT_ROOT?.trim();
  if (envRoot) roots.add(path.resolve(envRoot));
  roots.add(process.cwd());

  for (const root of roots) {
    try {
      const req = createRequire(path.join(root, 'package.json'));
      return req.resolve(packageName);
    } catch {
      // try next root
    }
  }

  try {
    return createRequire(import.meta.url).resolve(packageName);
  } catch {
    return undefined;
  }
}

export async function importOptionalPeerPackage<T = Record<string, unknown>>(
  packageName: string,
): Promise<T> {
  const resolved = resolveOptionalPeerPackage(packageName);
  if (resolved) {
    return import(pathToFileURL(resolved).href) as Promise<T>;
  }
  return import(packageName) as Promise<T>;
}
