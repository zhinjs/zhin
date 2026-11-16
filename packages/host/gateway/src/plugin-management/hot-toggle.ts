/**
 * Which plugin enable / disable must still restart the instance (zhinjs/zhin#1250, ADR 0054 §4
 * addendum 2026-11-15). Everything else is applied in the running instance as one generation
 * transaction. Checks run before anything is written; each names a reason the result reports.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayPluginRestartReason } from '@zhin.js/console-protocol';

export interface HotToggleBlocker {
  readonly reason: Extract<GatewayPluginRestartReason, 'manifest' | 'native-module' | 'dependencies-changed'>;
  readonly detail: string;
}

/** The plugin package as the gateway resolved it. */
export interface HotTogglePackage {
  readonly name: string;
  readonly root: string;
  readonly packageJson: Readonly<Record<string, unknown>> & { readonly zhin?: unknown };
}

/** Loaders and toolchains that mean a native addon (`.node`) is in the dependency. */
const NATIVE_DEPENDENCIES: ReadonlySet<string> = new Set([
  'bindings', 'node-gyp-build', 'node-gyp-build-optional-packages', 'prebuild-install', 'node-pre-gyp',
  '@mapbox/node-pre-gyp', 'node-addon-api', 'nan', 'cmake-js', 'napi-macros',
]);

/** Root files whose change means the dependency tree on disk moved after the instance started. */
const DEPENDENCY_FILES = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb'];

/**
 * Why toggling `pkg` needs a restart, or `undefined` when it can be applied in place.
 * `startedAt` is when the running instance became ready (epoch ms); without it the
 * dependency check is skipped.
 */
export async function hotToggleBlocker(projectRoot: string, pkg: HotTogglePackage | undefined, startedAt: number | undefined): Promise<HotToggleBlocker | undefined> {
  if (pkg) {
    const zhin = pkg.packageJson.zhin as { readonly toggle?: unknown } | undefined;
    if (zhin?.toggle === 'restart') {
      return { reason: 'manifest', detail: `${pkg.name} 在 package.json#zhin.toggle 中声明启停需要重启实例` };
    }
    const native = await nativeModule(pkg);
    if (native) return { reason: 'native-module', detail: `${pkg.name} ${native}，原生模块无法在进程内卸载或重新加载` };
  }
  if (startedAt !== undefined) {
    const files = [...DEPENDENCY_FILES.map(file => join(projectRoot, file)), ...(pkg ? [join(pkg.root, 'package.json')] : [])];
    for (const file of files) {
      const changedAt = await modifiedAt(file);
      if (changedAt !== undefined && changedAt > startedAt) {
        return { reason: 'dependencies-changed', detail: `${relativeName(projectRoot, file)} 在实例启动后被修改，需要重启实例加载新依赖` };
      }
    }
  }
  return undefined;
}

async function nativeModule(pkg: HotTogglePackage): Promise<string | undefined> {
  const json = pkg.packageJson;
  if (json.gypfile === true || await exists(join(pkg.root, 'binding.gyp'))) return '包含原生扩展（binding.gyp）';
  if (await hasNodeFile(join(pkg.root, 'prebuilds'), 3) || await hasNodeFile(join(pkg.root, 'build', 'Release'), 1)) return '包含原生扩展（.node 文件）';
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    const deps = json[field];
    if (!deps || typeof deps !== 'object') continue;
    const found = Object.keys(deps).find(name => NATIVE_DEPENDENCIES.has(name));
    if (found) return `依赖原生扩展加载器 ${found}`;
  }
  return undefined;
}

async function hasNodeFile(directory: string, depth: number): Promise<boolean> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.node')) return true;
    if (entry.isDirectory() && depth > 1 && await hasNodeFile(join(directory, entry.name), depth - 1)) return true;
  }
  return false;
}

async function modifiedAt(file: string): Promise<number | undefined> {
  try { return (await stat(file)).mtimeMs; } catch { return undefined; }
}

async function exists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

function relativeName(projectRoot: string, file: string): string {
  return file.startsWith(projectRoot) ? file.slice(projectRoot.length).replace(/^[\\/]/u, '') || file : file;
}
