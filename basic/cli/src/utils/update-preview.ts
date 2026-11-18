/**
 * `zhin update --dry-run` (#1250 `update-no-preview`): what `zhin update` would upgrade, per
 * package and workspace member, without writing a file or touching the instance.
 *
 * `zhin update` runs the package manager's `update` (with `-r` in a pnpm workspace), which stays
 * inside each `package.json` range; `name@x.y.z` moves the root to exactly that version. The
 * preview reads the installed versions from node_modules and the published versions from the
 * registry, and picks what the range allows. pnpm's `minimumReleaseAge` can still hold back a
 * release published less than a day ago.
 *
 * #1250 update-overrides-not-synced: when the update touches Zhin packages (all dependencies, or a
 * requested `zhin.js` / `@zhin.js/*`), the pnpm overrides that pin Zhin packages move with them
 * (the gateway releases and re-pins them; see `./zhin-overrides.ts`). The preview
 * therefore computes Zhin targets from the declared ranges and shows how each override changes;
 * Zhin packages are listed first, other dependencies after them.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  classifyZhinOverride,
  formatOverrideChanges,
  isZhinPackageName,
  manualOverrideHint,
  readZhinOverrides,
  syncedOverrideValue,
  type ZhinOverrideChange,
} from './zhin-overrides.js';
import { semver } from '../plugin-check/semver.js';
import { readInstalledPackageVersion } from './installed-versions.js';
import { isValidNpmPackageName } from './registry-version.js';
import { listWorkspacePackageDirs, workspacePackageGlobs } from './workspace-packages.js';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** Published versions of a package (ascending), or undefined when the registry cannot say. */
export type PublishedVersions = (name: string) => Promise<readonly string[] | undefined>;

/** The `dependencies` of one published version, or undefined when the registry cannot say. */
export type PackageDependencies = (name: string, version: string) => Promise<Readonly<Record<string, string>> | undefined>;

export interface UpdatePreviewChange {
  readonly name: string;
  /** Declared range (or the requested exact version). */
  readonly range: string;
  readonly current: string | undefined;
  readonly target: string;
  /** Newest published version when it is outside the range (not installed by `zhin update`). */
  readonly latestOutsideRange?: string;
  /** The pnpm override that decides the version instead of `range`. */
  readonly override?: string;
}

export interface UpdatePreviewMember {
  /** `.` for the root, else the path relative to the root. */
  readonly path: string;
  readonly name: string | undefined;
  readonly changes: readonly UpdatePreviewChange[];
  /** Declared dependencies the registry did not answer for. */
  readonly unknown: readonly string[];
  /** Requested packages this member does not declare. */
  readonly notDeclared: readonly string[];
  /** Packages pinned by an override the preview cannot evaluate (`link:`, `npm:` aliases, …), with it. */
  readonly overridden: readonly string[];
}

export interface UpdatePreviewOverrides {
  /** Zhin overrides `zhin update` rewrites to the upgraded versions. */
  readonly changes: readonly ZhinOverrideChange[];
  /** Zhin overrides to edit by hand (form not syncable, or no version to preview). */
  readonly manual: readonly string[];
}

export interface UpdatePreview {
  /** `update -r`: the pnpm workspace members move with the root. */
  readonly recursive: boolean;
  readonly members: readonly UpdatePreviewMember[];
  /** Conditional override keys (`a>b`, `name@<2`) the preview does not apply. */
  readonly conditionalOverrides: readonly string[];
  /** How the Zhin overrides move (only when the update touches Zhin packages). */
  readonly overrides: UpdatePreviewOverrides;
}

/**
 * pnpm overrides of the root: `package.json#pnpm.overrides` and `pnpm-workspace.yaml#overrides`
 * (the workspace file wins on the same key). Only plain `name` keys are applied by the preview.
 */
export function readPnpmOverrides(root: string): { readonly plain: ReadonlyMap<string, string>; readonly conditional: readonly string[] } {
  const merged = new Map<string, string>();
  const add = (entries: unknown): void => {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof value === 'string') merged.set(key, value);
    }
  };
  const manifest = readManifest(root);
  add((manifest?.pnpm as { overrides?: unknown } | undefined)?.overrides);
  try { add((parseYaml(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')) as { overrides?: unknown } | null)?.overrides); }
  catch { /* no workspace file */ }
  const plain = new Map<string, string>();
  const conditional: string[] = [];
  for (const [key, value] of merged) {
    // `@scope/name` is plain; `a>b` and `name@<2` (a selector after the name) are conditional.
    if (key.includes('>') || key.slice(1).includes('@')) conditional.push(`${key}: ${value}`);
    else plain.set(key, value);
  }
  return { plain, conditional: conditional.sort() };
}

interface Manifest { name?: unknown; [field: string]: unknown }

function readManifest(dir: string): Manifest | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest; } catch { return undefined; }
}

function declared(manifest: Manifest): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (!entries || typeof entries !== 'object') continue;
    for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof range === 'string' && !out.has(name)) out.set(name, range);
    }
  }
  return out;
}

/** `name@1.2.3` → name and exact version; a bare name has none. */
export function splitUpdateSpec(spec: string): { readonly name: string; readonly version?: string } {
  const at = spec.lastIndexOf('@');
  if (at > 0) {
    const version = spec.slice(at + 1);
    return EXACT_VERSION.test(version) ? { name: spec.slice(0, at), version } : { name: spec.slice(0, at) };
  }
  return { name: spec };
}

/** `npm view <name> versions --json` (the project's registry configuration, mirrors included). */
export const npmPublishedVersions: PublishedVersions = (name) => new Promise((resolve) => {
  if (!isValidNpmPackageName(name)) { resolve(undefined); return; }
  execFile('npm', ['view', name, 'versions', '--json'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32',
  }, (error, stdout) => {
    if (error) { resolve(undefined); return; }
    try {
      const parsed = JSON.parse(stdout) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      resolve(list.filter((item): item is string => typeof item === 'string'));
    } catch { resolve(undefined); }
  });
});

/** `npm view <name>@<version> dependencies --json`. */
export const npmPackageDependencies: PackageDependencies = (name, version) => new Promise((resolve) => {
  if (!isValidNpmPackageName(name) || !EXACT_VERSION.test(version)) { resolve(undefined); return; }
  execFile('npm', ['view', `${name}@${version}`, 'dependencies', '--json'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32',
  }, (error, stdout) => {
    if (error) { resolve(undefined); return; }
    try {
      // No dependencies at all prints nothing.
      const parsed = stdout.trim() ? JSON.parse(stdout) as unknown : {};
      resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : undefined);
    } catch { resolve(undefined); }
  });
});

/** Runs `task` over `items` with at most `limit` at a time. */
async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }));
  return results;
}

/**
 * The preview for `zhin update [packages…]`. `packages` empty means every dependency. Only semver
 * ranges are considered (`workspace:`, `link:`, `file:`, git URLs and dist-tags are left alone).
 */
export async function previewUpdate(
  root: string,
  packages: readonly string[],
  options: {
    readonly publishedVersions?: PublishedVersions;
    readonly packageDependencies?: PackageDependencies;
    readonly concurrency?: number;
  } = {},
): Promise<UpdatePreview> {
  // Same rule as the gateway's update transaction (`isPnpmWorkspace`): any `packages` entry means `update -r`.
  const recursive = workspacePackageGlobs(root).length > 0;
  const overrides = readPnpmOverrides(root);
  const rootDeclared = declared(readManifest(root) ?? {});
  const requested = packages.map(splitUpdateSpec);
  // The update releases and re-pins the Zhin overrides it can sync (#1250 update-overrides-not-synced).
  const touchesZhin = requested.length === 0 || requested.some(item => isZhinPackageName(item.name));
  const zhinOverrides = touchesZhin ? readZhinOverrides(root) : undefined;
  const dirs = [root, ...(recursive ? listWorkspacePackageDirs(root) : [])];
  const lookup = options.publishedVersions ?? npmPublishedVersions;
  const cache = new Map<string, Promise<readonly string[] | undefined>>();
  const versionsOf = (name: string) => {
    if (!cache.has(name)) cache.set(name, lookup(name));
    return cache.get(name)!;
  };

  const members: UpdatePreviewMember[] = [];
  for (const dir of dirs) {
    const manifest = readManifest(dir);
    if (!manifest) continue;
    const isRoot = dir === root;
    const deps = declared(manifest);
    const notDeclared: string[] = [];
    const work: { name: string; range: string; exact?: string }[] = [];
    if (requested.length === 0) {
      for (const [name, range] of deps) work.push({ name, range });
    } else {
      for (const item of requested) {
        const range = deps.get(item.name);
        // An exact version only moves the root (it is installed there when not declared).
        if (item.version) { if (isRoot) work.push({ name: item.name, range: range ?? item.version, exact: item.version }); continue; }
        if (range === undefined) { notDeclared.push(item.name); continue; }
        work.push({ name: item.name, range });
      }
    }
    const overridden: string[] = [];
    const considered: { name: string; range: string; exact?: string; override?: string }[] = [];
    for (const item of work) {
      const raw = overrides.plain.get(item.name);
      const released = zhinOverrides !== undefined && raw !== undefined && classifyZhinOverride(item.name, raw).kind === 'sync';
      if (raw !== undefined && !released) {
        // `$name` refers to the root's own specifier of that package.
        const spec = raw.startsWith('$') ? rootDeclared.get(raw.slice(1)) ?? raw : raw;
        if (semver.validRange(spec) === null) { overridden.push(`${item.name}（${raw}）`); continue; }
        considered.push({ name: item.name, range: spec, ...(semver.valid(spec) ? { exact: spec } : {}), override: raw });
        continue;
      }
      if (item.exact !== undefined || semver.validRange(item.range) !== null) considered.push(item);
    }
    const unknown: string[] = [];
    const changes = (await mapLimited(considered, options.concurrency ?? 8, async (item): Promise<UpdatePreviewChange | undefined> => {
      const current = readInstalledPackageVersion(dir, item.name) ?? (isRoot ? undefined : readInstalledPackageVersion(root, item.name));
      const published = await versionsOf(item.name);
      if (!published) { unknown.push(item.name); return undefined; }
      const target = item.exact ?? semver.maxSatisfying(published, item.range) ?? undefined;
      if (!target || target === current) return undefined;
      if (item.exact && !published.includes(item.exact)) { unknown.push(`${item.name}@${item.exact}`); return undefined; }
      const stable = published.filter(version => !version.includes('-'));
      const latest = stable.at(-1);
      return {
        name: item.name, range: item.range, current, target,
        ...(item.override !== undefined ? { override: item.override } : {}),
        ...(!item.exact && latest && latest !== target && semver.gt(latest, target) ? { latestOutsideRange: latest } : {}),
      };
    })).filter((change): change is UpdatePreviewChange => change !== undefined);
    changes.sort((a, b) => a.name.localeCompare(b.name));
    unknown.sort();
    members.push({
      path: isRoot ? '.' : path.relative(root, dir).split(path.sep).join('/'),
      name: typeof manifest.name === 'string' ? manifest.name : undefined,
      changes, unknown, notDeclared, overridden: overridden.sort(),
    });
  }
  const rootMember = members.find(member => member.path === '.');
  const versionAtRoot = (name: string): string | undefined =>
    rootMember?.changes.find(change => change.name === name)?.target ?? readInstalledPackageVersion(root, name);
  const dependencyLookup = options.packageDependencies ?? npmPackageDependencies;
  const dependencyCache = new Map<string, Promise<Readonly<Record<string, string>> | undefined>>();
  const dependenciesOf = (name: string, version: string) => {
    const key = `${name}@${version}`;
    if (!dependencyCache.has(key)) dependencyCache.set(key, dependencyLookup(name, version));
    return dependencyCache.get(key)!;
  };
  const exactIn = (dependencies: Readonly<Record<string, string>> | undefined, name: string): string | undefined => {
    const spec = dependencies?.[name]?.trim().replace(/^=?v?/u, '');
    return spec && EXACT_VERSION.test(spec) ? spec : undefined;
  };
  // Breadth-first over the Zhin packages of the upgraded release, like the gateway's re-pin.
  // zhin.js's release first; the project's other Zhin dependencies only when it says nothing.
  const alignedVersion = async (name: string): Promise<string | undefined> => {
    const others = [...rootDeclared.keys()].filter(dep => dep !== 'zhin.js' && dep !== name && isZhinPackageName(dep));
    for (const starts of [['zhin.js'], others]) {
      const queue = starts.flatMap(dep => { const version = versionAtRoot(dep); return version ? [[dep, version] as const] : []; });
      const seen = new Set(queue.map(([dep, version]) => `${dep}@${version}`));
      while (queue.length) {
        const [dep, version] = queue.shift()!;
        const dependencies = await dependenciesOf(dep, version);
        const aligned = exactIn(dependencies, name);
        if (aligned) return aligned;
        for (const [next, spec] of Object.entries(dependencies ?? {})) {
          const exact = isZhinPackageName(next) ? exactIn({ [next]: spec }, next) : undefined;
          if (exact && !seen.has(`${next}@${exact}`)) { seen.add(`${next}@${exact}`); queue.push([next, exact]); }
        }
      }
    }
    return undefined;
  };
  const changes: ZhinOverrideChange[] = [];
  const manual: string[] = [];
  for (const entry of zhinOverrides?.entries ?? []) {
    if (entry.class.kind !== 'sync') { manual.push(manualOverrideHint(entry)); continue; }
    const { name, parent } = entry.class;
    // Same rule as the gateway's re-pin, from the registry instead of the installed tree.
    const parentVersion = parent ? versionAtRoot(parent) : undefined;
    const version = parent
      ? (parentVersion ? exactIn(await dependenciesOf(parent, parentVersion), name) : undefined)
      : (name === 'zhin.js' ? undefined : await alignedVersion(name)) ?? versionAtRoot(name);
    if (!version) { manual.push(manualOverrideHint(entry)); continue; }
    const to = syncedOverrideValue(entry, version);
    if (to !== String(entry.value)) changes.push({ file: entry.file, key: entry.key, from: String(entry.value), to });
  }
  const handled = new Set((zhinOverrides?.entries ?? []).map(entry => entry.key));
  return {
    recursive,
    members,
    conditionalOverrides: overrides.conditional.filter(item => !handled.has(item.slice(0, item.lastIndexOf(': ')))),
    overrides: { changes, manual },
  };
}

/** Readable lines of a preview: per member the Zhin packages first, then the other dependencies. */
export function renderUpdatePreview(preview: UpdatePreview, gatewayRunning: boolean): string[] {
  const lines = ['预览（--dry-run）：不会修改任何文件，也不会停止或重启实例。'];
  if (preview.recursive) {
    const members = preview.members.filter(member => member.path !== '.');
    lines.push(`pnpm 工作区：zhin update 会一并更新 ${members.length} 个成员${members.length ? `（${members.map(member => member.path).join('、')}）` : ''}。`);
  }
  let total = 0;
  const changeLine = (change: UpdatePreviewChange, width: number): string => {
    const outside = change.latestOutsideRange ? `；最新 ${change.latestOutsideRange} 超出范围，不会升级` : '';
    const rule = change.override !== undefined ? `overrides：${change.override}` : change.range;
    return `    ${change.name.padEnd(width)}  ${change.current ?? '未安装'} → ${change.target}（${rule}${outside}）`;
  };
  const renderOverrides = (): void => {
    const { changes, manual } = preview.overrides;
    if (changes.length === 0 && manual.length === 0) return;
    lines.push('', 'pnpm overrides（Zhin 包的版本锁，随升级同步；其他条目不动）：');
    for (const line of formatOverrideChanges(changes)) lines.push(`  ${line}`);
    for (const line of manual) lines.push(`  ${line}`);
  };
  for (const member of preview.members) {
    const title = member.path === '.' ? `根项目${member.name ? `（${member.name}）` : ''}` : `${member.path}${member.name ? `（${member.name}）` : ''}`;
    lines.push('', `${title}：`);
    if (member.changes.length === 0) lines.push('  没有可升级的依赖');
    const width = Math.max(0, ...member.changes.map(change => change.name.length));
    const zhin = member.changes.filter(change => isZhinPackageName(change.name));
    const others = member.changes.filter(change => !isZhinPackageName(change.name));
    for (const [heading, group] of [['Zhin 包', zhin], ['其他依赖', others]] as const) {
      if (group.length === 0) continue;
      lines.push(`  ${heading}：`);
      for (const change of group) { total += 1; lines.push(changeLine(change, width)); }
    }
    if (member.unknown.length) lines.push(`  无法从 registry 查询：${member.unknown.join('、')}`);
    if (member.notDeclared.length) lines.push(`  未声明：${member.notDeclared.join('、')}`);
    if (member.overridden.length) lines.push(`  由 overrides 决定、无法预览：${member.overridden.join('、')}`);
    if (member.path === '.') renderOverrides();
  }
  if (!preview.members.some(member => member.path === '.')) renderOverrides();
  if (preview.conditionalOverrides.length) {
    lines.push('', `带条件的 overrides 没有计入预览（实际安装时仍然生效）：${preview.conditionalOverrides.join('、')}`);
  }
  lines.push('');
  const overrideChanges = preview.overrides.changes.length;
  lines.push(total === 0 && overrideChanges === 0
    ? '所有依赖都已是范围内的最新版本。'
    : `共 ${total} 处升级${overrideChanges ? `、${overrideChanges} 处 overrides 同步` : ''}。实际执行：去掉 --dry-run${gatewayRunning ? '（网关会先停止实例，升级完成后再启动；失败时回滚）' : '（失败时回滚）'}；完成后运行 zhin doctor 检查「Zhin 包单实例」。`);
  lines.push('提示：pnpm 的 minimumReleaseAge 可能暂缓刚发布的版本；超出范围的大版本请用 zhin update <包名>@<版本>。');
  return lines;
}
