/**
 * `zhin update --dry-run` (#1250 `update-no-preview`): what `zhin update` would upgrade, per
 * package and workspace member, without writing a file or touching the instance.
 *
 * `zhin update` runs the package manager's `update` (with `-r` in a pnpm workspace), which stays
 * inside each `package.json` range; `name@x.y.z` moves the root to exactly that version. The
 * preview reads the installed versions from node_modules and the published versions from the
 * registry, and picks what the range allows. pnpm's `minimumReleaseAge` can still hold back a
 * release published less than a day ago.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { semver } from '../plugin-check/semver.js';
import { readInstalledPackageVersion } from './installed-versions.js';
import { isValidNpmPackageName } from './registry-version.js';
import { listWorkspacePackageDirs, workspacePackageGlobs } from './workspace-packages.js';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** Published versions of a package (ascending), or undefined when the registry cannot say. */
export type PublishedVersions = (name: string) => Promise<readonly string[] | undefined>;

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

export interface UpdatePreview {
  /** `update -r`: the pnpm workspace members move with the root. */
  readonly recursive: boolean;
  readonly members: readonly UpdatePreviewMember[];
  /** Conditional override keys (`a>b`, `name@<2`) the preview does not apply. */
  readonly conditionalOverrides: readonly string[];
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
  options: { readonly publishedVersions?: PublishedVersions; readonly concurrency?: number } = {},
): Promise<UpdatePreview> {
  // Same rule as the gateway's update transaction (`isPnpmWorkspace`): any `packages` entry means `update -r`.
  const recursive = workspacePackageGlobs(root).length > 0;
  const overrides = readPnpmOverrides(root);
  const rootDeclared = declared(readManifest(root) ?? {});
  const requested = packages.map(splitUpdateSpec);
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
      if (raw !== undefined) {
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
  return { recursive, members, conditionalOverrides: overrides.conditional };
}

/** Readable lines of a preview. */
export function renderUpdatePreview(preview: UpdatePreview, gatewayRunning: boolean): string[] {
  const lines = ['预览（--dry-run）：不会修改任何文件，也不会停止或重启实例。'];
  if (preview.recursive) {
    const members = preview.members.filter(member => member.path !== '.');
    lines.push(`pnpm 工作区：zhin update 会一并更新 ${members.length} 个成员${members.length ? `（${members.map(member => member.path).join('、')}）` : ''}。`);
  }
  let total = 0;
  for (const member of preview.members) {
    const title = member.path === '.' ? `根项目${member.name ? `（${member.name}）` : ''}` : `${member.path}${member.name ? `（${member.name}）` : ''}`;
    lines.push('', `${title}：`);
    if (member.changes.length === 0) lines.push('  没有可升级的依赖');
    const width = Math.max(0, ...member.changes.map(change => change.name.length));
    for (const change of member.changes) {
      total += 1;
      const outside = change.latestOutsideRange ? `；最新 ${change.latestOutsideRange} 超出范围，不会升级` : '';
      const rule = change.override !== undefined ? `overrides：${change.override}` : change.range;
      lines.push(`  ${change.name.padEnd(width)}  ${change.current ?? '未安装'} → ${change.target}（${rule}${outside}）`);
    }
    if (member.unknown.length) lines.push(`  无法从 registry 查询：${member.unknown.join('、')}`);
    if (member.notDeclared.length) lines.push(`  未声明：${member.notDeclared.join('、')}`);
    if (member.overridden.length) lines.push(`  由 overrides 决定、无法预览：${member.overridden.join('、')}`);
  }
  if (preview.conditionalOverrides.length) {
    lines.push('', `带条件的 overrides 没有计入预览（实际安装时仍然生效）：${preview.conditionalOverrides.join('、')}`);
  }
  lines.push('');
  lines.push(total === 0
    ? '所有依赖都已是范围内的最新版本。'
    : `共 ${total} 处升级。实际执行：去掉 --dry-run${gatewayRunning ? '（网关会先停止实例，升级完成后再启动；失败时回滚）' : ''}。`);
  lines.push('提示：pnpm 的 minimumReleaseAge 可能暂缓刚发布的版本；超出范围的大版本请用 zhin update <包名>@<版本>。');
  return lines;
}
