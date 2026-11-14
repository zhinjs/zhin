/**
 * What a Zhin project actually has installed, compared with what its package.json declares (#1250).
 *
 * `zhin migrate` rewrites specifiers and runs the install; whether the install really moved a
 * package is only visible in node_modules. pnpm 11 holds back releases younger than
 * `minimumReleaseAge` (one day by default): a freshly published Zhin release then stays at the old
 * version (`Already up to date`) unless `pnpm-workspace.yaml#minimumReleaseAgeExclude` lists it —
 * the scaffold's install has pnpm write exactly those `name@version` entries.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { Document, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { semver } from '../plugin-check/semver.js';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** `zhin.js` and `@zhin.js/*`: the packages migrate upgrades and doctor compares. */
export function isZhinPackage(name: string): boolean {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

/** The version in `node_modules/<name>/package.json` (the project's own copy), or undefined. */
export function readInstalledPackageVersion(dir: string, name: string): string | undefined {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/** Declared Zhin dependencies (`dependencies` and `devDependencies`) with their specifiers. */
export function declaredZhinDependencies(pkg: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of ['devDependencies', 'dependencies'] as const) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (isZhinPackage(name) && typeof spec === 'string') out[name] = spec;
    }
  }
  return out;
}

export function snapshotInstalledVersions(dir: string, names: Iterable<string>): Map<string, string | undefined> {
  const snapshot = new Map<string, string | undefined>();
  for (const name of names) snapshot.set(name, readInstalledPackageVersion(dir, name));
  return snapshot;
}

/** Whether `installed` satisfies `declared`; undefined when the specifier is not a semver range (link:, workspace:, a dist-tag…). */
export function installedSatisfies(installed: string, declared: string): boolean | undefined {
  if (semver.validRange(declared) === null) return undefined;
  return semver.satisfies(installed, declared, { includePrerelease: true });
}

export interface InstalledVersionRow {
  readonly name: string;
  readonly declared: string;
  readonly before?: string;
  readonly after?: string;
  /** `missing`: not in node_modules; `mismatch`: installed outside the declared range; `ok`; `unchecked`: not a semver range. */
  readonly status: 'ok' | 'mismatch' | 'missing' | 'unchecked';
}

export function compareInstalledVersions(
  dir: string,
  declared: Readonly<Record<string, string>>,
  before: ReadonlyMap<string, string | undefined> = new Map(),
): InstalledVersionRow[] {
  return Object.entries(declared).map(([name, spec]) => {
    const after = readInstalledPackageVersion(dir, name);
    let status: InstalledVersionRow['status'];
    if (after === undefined) status = 'missing';
    else {
      const satisfied = installedSatisfies(after, spec);
      status = satisfied === undefined ? 'unchecked' : satisfied ? 'ok' : 'mismatch';
    }
    return { name, declared: spec, before: before.get(name), after, status };
  });
}

function readWorkspace(dir: string): Document | undefined {
  const file = path.join(dir, WORKSPACE_FILE);
  if (!fs.existsSync(file)) return new Document({});
  const doc = parseDocument(fs.readFileSync(file, 'utf8'));
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return undefined;
  return doc;
}

function excludeEntries(doc: Document): string[] {
  const list = doc.get('minimumReleaseAgeExclude');
  return isSeq(list) ? list.items.map(item => String(isScalar(item) ? item.value : item)) : [];
}

/** An exclusion entry (`name`, `name@version`, `@scope/*`, `prefix*`) that covers `name@version`. */
function excludes(entry: string, name: string, version: string): boolean {
  const at = entry.lastIndexOf('@');
  const [pattern, versions] = at > 0 ? [entry.slice(0, at), entry.slice(at + 1)] : [entry, undefined];
  const nameMatches = pattern.includes('*')
    ? new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\/]/gu, '\\$&')).join('.*')}$`, 'u').test(name)
    : pattern === name;
  if (!nameMatches) return false;
  return versions === undefined || versions.split('||').map(v => v.trim()).includes(version);
}

/**
 * Appends `name@version` entries to `pnpm-workspace.yaml#minimumReleaseAgeExclude` for the Zhin
 * releases migrate upgrades to — the form pnpm writes into a freshly scaffolded project — so pnpm 11
 * installs a release published less than `minimumReleaseAge` ago instead of keeping the old one.
 * Entries that already cover a release (a bare name, a pattern or the same version) are kept as
 * they are; a project without `pnpm-workspace.yaml` is left alone. Returns the entries added (printed; written unless `dryRun`).
 */
export function syncReleaseAgeExclusions(dir: string, releases: ReadonlyMap<string, string>, dryRun: boolean): string[] {
  // Only an existing workspace file is edited: a plain package (a plugin) does not get one for this.
  if (releases.size === 0 || !fs.existsSync(path.join(dir, WORKSPACE_FILE))) return [];
  const doc = readWorkspace(dir);
  if (!doc) return [];
  const existing = excludeEntries(doc);
  const added: string[] = [];
  for (const [name, version] of [...releases].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isZhinPackage(name) || existing.some(entry => excludes(entry, name, version))) continue;
    added.push(`${name}@${version}`);
  }
  if (added.length === 0) return [];
  for (const entry of added) {
    console.log(chalk.cyan(`  ${dryRun ? '[dry-run]' : '·'} ${WORKSPACE_FILE} minimumReleaseAgeExclude: + ${entry}`));
  }
  if (!dryRun) {
    const list = doc.get('minimumReleaseAgeExclude');
    if (isSeq(list)) for (const entry of added) list.add(doc.createNode(entry));
    else doc.set('minimumReleaseAgeExclude', doc.createNode(added));
    fs.writeFileSync(path.join(dir, WORKSPACE_FILE), doc.toString());
  }
  return added;
}

/** pnpm major version on PATH (undefined when pnpm is unavailable). */
export function detectPnpmMajor(dir: string): number | undefined {
  try {
    const output = execFileSync('pnpm', ['--version'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, shell: process.platform === 'win32' });
    const major = Number.parseInt(output.trim(), 10);
    return Number.isFinite(major) ? major : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why a declared Zhin release did not install, as a Chinese sentence. `pnpmMajor` decides whether
 * the release-age gate applies (pnpm 11 enables it by default; earlier releases only when
 * `minimumReleaseAge` is configured).
 */
export function explainVersionMismatch(dir: string, pkg: Record<string, any>, row: InstalledVersionRow, pnpmMajor: number | undefined): string {
  const override = pkg.pnpm?.overrides?.[row.name] ?? pkg.overrides?.[row.name] ?? pkg.resolutions?.[row.name];
  if (typeof override === 'string') {
    return `package.json 的 overrides 把 ${row.name} 固定为 ${override}，与声明的 ${row.declared} 冲突：改为相同范围或删除该 override，再运行 pnpm install`;
  }
  const doc = readWorkspace(dir);
  const configuredAge = doc ? Number(doc.get('minimumReleaseAge') ?? Number.NaN) : Number.NaN;
  const ageGate = Number.isFinite(configuredAge) ? configuredAge > 0 : (pnpmMajor ?? 0) >= 11;
  if (ageGate) {
    return `pnpm 的 minimumReleaseAge（新发布版本的冷却期，pnpm 11 默认 1 天）可能拦下了 ${row.name} 的新版本：在 ${WORKSPACE_FILE} 的 minimumReleaseAgeExclude 中加入 "${row.name}@<版本>"（zhin migrate 会自动补齐），或等冷却期过后再运行 pnpm install`;
  }
  return `pnpm install 没有把 ${row.name} 更新到声明的 ${row.declared}：检查上方 pnpm 输出（lockfile、registry 镜像同步），然后运行 pnpm install`;
}

/** `before → after` table lines for migrate's result (Chinese). */
export function formatInstalledVersionRows(rows: readonly InstalledVersionRow[]): string[] {
  return rows.map(row => {
    const before = row.before ?? '未安装';
    const after = row.after ?? '未安装';
    const change = before === after ? `${after}（未变化）` : `${before} → ${after}`;
    const mark = row.status === 'ok' || row.status === 'unchecked' ? chalk.green('✓') : chalk.red('✗');
    return `  ${mark} ${row.name}: ${change}  （声明 ${row.declared}）`;
  });
}
