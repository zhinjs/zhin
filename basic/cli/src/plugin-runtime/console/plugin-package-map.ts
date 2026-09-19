import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Reads the instance-key to package-name mapping declared by the project. */
export async function readPluginPackageMap(
  projectRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>();
  try {
    const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly zhin?: { readonly plugins?: unknown };
    };
    const plugins = pkg.zhin?.plugins;
    if (!Array.isArray(plugins)) return map;
    for (const item of plugins) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as { readonly package?: unknown; readonly instanceKey?: unknown };
      if (typeof entry.package !== 'string') continue;
      map.set(String(entry.instanceKey ?? entry.package), entry.package);
    }
  } catch {
    return map;
  }
  return map;
}
