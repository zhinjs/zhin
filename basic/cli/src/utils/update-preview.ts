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
}

export interface UpdatePreview {
  /** `update -r`: the pnpm workspace members move with the root. */
  readonly recursive: boolean;
  readonly members: readonly UpdatePreviewMember[];
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
  const recursive = workspacePackageGlobs(root).some(glob => !glob.startsWith('!'));
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
    const considered = work.filter(item => item.exact !== undefined || semver.validRange(item.range) !== null);
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
        ...(!item.exact && latest && latest !== target && semver.gt(latest, target) ? { latestOutsideRange: latest } : {}),
      };
    })).filter((change): change is UpdatePreviewChange => change !== undefined);
    changes.sort((a, b) => a.name.localeCompare(b.name));
    unknown.sort();
    members.push({
      path: isRoot ? '.' : path.relative(root, dir).split(path.sep).join('/'),
      name: typeof manifest.name === 'string' ? manifest.name : undefined,
      changes, unknown, notDeclared,
    });
  }
  return { recursive, members };
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
      lines.push(`  ${change.name.padEnd(width)}  ${change.current ?? '未安装'} → ${change.target}（${change.range}${outside}）`);
    }
    if (member.unknown.length) lines.push(`  无法从 registry 查询：${member.unknown.join('、')}`);
    if (member.notDeclared.length) lines.push(`  未声明：${member.notDeclared.join('、')}`);
  }
  lines.push('');
  lines.push(total === 0
    ? '所有依赖都已是范围内的最新版本。'
    : `共 ${total} 处升级。实际执行：去掉 --dry-run${gatewayRunning ? '（网关会先停止实例，升级完成后再启动；失败时回滚）' : ''}。`);
  lines.push('提示：pnpm 的 minimumReleaseAge 可能暂缓刚发布的版本；超出范围的大版本请用 zhin update <包名>@<版本>。');
  return lines;
}
