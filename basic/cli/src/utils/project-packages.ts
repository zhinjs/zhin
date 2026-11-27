/**
 * `zhin packages list` (#1250 `packages-list-misleading`, ADR 0062 §11): the project's
 * dependencies grouped by what they are to Zhin — adapters, plugins, the framework and feature
 * packages, other dependencies — plus the zhin-package skill packs.
 *
 * What a dependency is comes from its installed `package.json#zhin` (the same rule as the
 * gateway's `gateway.packages.list`): `type: "plugin"` is a plugin, an adapter when its
 * `metadata.category` is `adapter` (or a known adapter package); `type: "feature"` and `zhin.js`
 * are the framework; anything without a Zhin manifest is an ordinary dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPluginMarketplaceMetadata } from '@zhin.js/plugin-runtime';
import { classifyPackage } from './plugin-registry.js';
import { locateProjectRoot } from './project-root.js';

export type ProjectPackageGroup = 'adapter' | 'plugin' | 'framework' | 'dependency' | 'missing';

export interface ProjectPackage {
  readonly name: string;
  readonly range: string;
  readonly dependencyType: 'dependencies' | 'devDependencies' | 'optionalDependencies';
  readonly installedVersion: string | null;
  readonly group: ProjectPackageGroup;
}

export interface SkillPackEntry {
  readonly name: string;
  readonly source: string;
  readonly local: boolean;
}

export const PROJECT_PACKAGE_GROUP_TITLES: Readonly<Record<ProjectPackageGroup, string>> = Object.freeze({
  adapter: '适配器',
  plugin: '插件',
  framework: 'Zhin 框架与功能包',
  dependency: '其他依赖',
  missing: '已声明但未安装',
});

const GROUP_ORDER: readonly ProjectPackageGroup[] = ['adapter', 'plugin', 'framework', 'dependency', 'missing'];

function groupOf(name: string, manifest: Record<string, unknown>): ProjectPackageGroup {
  const zhin = manifest.zhin;
  const type = zhin && typeof zhin === 'object' && !Array.isArray(zhin) ? (zhin as { type?: unknown }).type : undefined;
  if (name === 'zhin.js' || type === 'feature') return 'framework';
  if (type === 'plugin') {
    const category = readPluginMarketplaceMetadata(zhin).category;
    return category === 'adapter' || classifyPackage({ name }).kind === 'adapter' ? 'adapter' : 'plugin';
  }
  return name.startsWith('@zhin.js/') ? 'framework' : 'dependency';
}

/**
 * The project root for `cwd` ({@link locateProjectRoot}: the nearest directory with a package.json
 * plus a Zhin config file or a `zhin.js` dependency, a pnpm workspace member resolving to its
 * workspace root), else `cwd`. Run from `plugins/foo/` it still finds the project.
 */
export function findProjectRoot(cwd: string): string {
  return locateProjectRoot(cwd) ?? path.resolve(cwd);
}

/** The root package.json's dependencies with their installed version and group, sorted by name. */
export function listProjectPackages(root: string): ProjectPackage[] {
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>; }
  catch { return []; }
  const packages: ProjectPackage[] = [];
  const seen = new Set<string>();
  for (const dependencyType of ['dependencies', 'optionalDependencies', 'devDependencies'] as const) {
    const entries = manifest[dependencyType];
    if (!entries || typeof entries !== 'object') continue;
    for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof range !== 'string' || seen.has(name)) continue;
      seen.add(name);
      let installed: Record<string, unknown> | undefined;
      try {
        installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as Record<string, unknown>;
        if (installed.name !== name || typeof installed.version !== 'string') installed = undefined;
      } catch { installed = undefined; }
      packages.push({
        name, range, dependencyType,
        installedVersion: installed ? installed.version as string : null,
        group: installed ? groupOf(name, installed) : 'missing',
      });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/** Readable `zhin packages list`. */
export function renderProjectPackages(packages: readonly ProjectPackage[], skillPacks: readonly SkillPackEntry[]): string[] {
  const lines: string[] = [];
  for (const group of GROUP_ORDER) {
    const members = packages.filter(item => item.group === group);
    if (members.length === 0 && group !== 'adapter' && group !== 'plugin') continue;
    if (lines.length) lines.push('');
    lines.push(`${PROJECT_PACKAGE_GROUP_TITLES[group]}（${members.length}）`);
    if (members.length === 0) { lines.push('  （无）'); continue; }
    const width = Math.max(...members.map(item => item.name.length));
    for (const item of members) {
      const dev = item.dependencyType === 'devDependencies' ? '，dev' : '';
      lines.push(`  ${item.name.padEnd(width)}  ${item.installedVersion ?? '未安装'}（${item.range}${dev}）`);
    }
  }
  if (lines.length) lines.push('');
  lines.push(`zhin-package 技能包（${skillPacks.length}）`);
  if (skillPacks.length === 0) lines.push('  （无）');
  for (const pack of skillPacks) lines.push(`  ${pack.name}  ←  ${pack.source}（${pack.local ? '项目 .zhin/packages' : '全局'}）`);
  if (packages.some(item => item.group === 'missing')) lines.push('', '有依赖未安装：运行 pnpm install。');
  return lines;
}
