import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHostProtectedPaths, type HostProtectedPaths } from '@zhin.js/agent';
import { resolvePluginLifecycleFile } from '../plugin-lifecycle-store.js';

/**
 * #1030 P0: the host-owned half of the agent's protected-path set. The agent package ships the
 * conventional names (root config candidates, `package.json`, `schema.json`, `AGENTS.md`, skills
 * dirs); the host knows what only it can know — the project root, the root plugin entry declared
 * in `package.json#zhin.entry`, and where the plugin lifecycle store lives.
 */
export async function resolveHostProtectedPaths(
  projectRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HostProtectedPaths> {
  const selfFiles: string[] = [];
  try {
    const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { zhin?: { entry?: unknown } };
    if (typeof manifest.zhin?.entry === 'string' && manifest.zhin.entry.trim()) selfFiles.push(manifest.zhin.entry.trim());
  } catch {
    // package.json is itself protected; a missing or unreadable one just contributes no entry.
  }
  let lifecycleFile: string;
  try {
    lifecycleFile = resolvePluginLifecycleFile(projectRoot, environment);
  } catch {
    // An invalid ZHIN_PLUGIN_LIFECYCLE_FILE already fails host start; fall back to the default location.
    lifecycleFile = resolvePluginLifecycleFile(projectRoot, {});
  }
  return createHostProtectedPaths({ projectRoot, selfFiles, denyFiles: [lifecycleFile] });
}
