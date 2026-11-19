/**
 * Native build scripts of the management gateway's dependency tree (#1250).
 *
 * `@zhin.js/gateway` depends on `node-pty` (Console terminal), `ssh2` and, through it,
 * `cpu-features`; their install scripts compile native addons. pnpm 10+ skips dependency build
 * scripts unless the package is allowed — pnpm 11 only through `allowBuilds` in
 * `pnpm-workspace.yaml` (it ignores the `pnpm` field of `package.json`), pnpm 10.0–10.25 only
 * through `onlyBuiltDependencies`. Without the allowance `node-pty` installs without its binding.
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { Document, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { GATEWAY_NATIVE_BUILD_DEPENDENCIES } from '@zhin.js/scaffold-wizard';

export { GATEWAY_NATIVE_BUILD_DEPENDENCIES };

const GATEWAY_PACKAGE = '@zhin.js/gateway';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** First pnpm 10 minor that reads `allowBuilds`. */
const ALLOW_BUILDS_MIN_PNPM10_MINOR = 26;

function declaresGateway(pkg: Record<string, any>): boolean {
  return ['dependencies', 'devDependencies', 'optionalDependencies']
    .some(field => typeof pkg[field]?.[GATEWAY_PACKAGE] === 'string');
}

/** The project installs with pnpm (pnpm lockfile, `packageManager`, or no other lockfile). */
export function usesPnpm(dir: string, pkg: Record<string, any>): boolean {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return true;
  const manager = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
  if (manager) return manager.startsWith('pnpm@');
  return !['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb', 'bun.lock']
    .some(file => fs.existsSync(path.join(dir, file)));
}

/** `packageManager` pins a pnpm 10 release older than `allowBuilds` support. */
function pinsPnpmWithoutAllowBuilds(pkg: Record<string, any>): boolean {
  const match = /^pnpm@10\.(\d+)\./u.exec(String(pkg.packageManager ?? ''));
  return match !== null && Number(match[1]) < ALLOW_BUILDS_MIN_PNPM10_MINOR;
}

/** Reads the installed pnpm version (`pnpm --version`); undefined when pnpm cannot be run. */
export type PnpmVersionProbe = (dir: string) => string | undefined;

let installedPnpmVersion: { readonly value: string | undefined } | undefined;

/** `pnpm --version` in `dir`, run once per process. */
export const readInstalledPnpmVersion: PnpmVersionProbe = dir => {
  if (installedPnpmVersion) return installedPnpmVersion.value;
  let value: string | undefined;
  try {
    // Fixed arguments only: on Windows pnpm is a `.cmd` shim, which Node runs only through a shell.
    value = execFileSync('pnpm', ['--version'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      shell: process.platform === 'win32',
    }).trim() || undefined;
  } catch {
    value = undefined;
  }
  installedPnpmVersion = { value };
  return value;
};

function majorOf(version: string): number | undefined {
  const match = /^v?(\d+)\./u.exec(version.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * The project installs with pnpm 10 or newer: `packageManager` pins pnpm 10+, or (no pnpm pinned)
 * the installed `pnpm --version` is 10+. A `pnpm-workspace.yaml` holding only `allowBuilds` breaks
 * pnpm 9 (`packages field missing or empty`), so the file is created only when this holds.
 */
export function confirmsPnpm10(dir: string, pkg: Record<string, any>, probe: PnpmVersionProbe = readInstalledPnpmVersion): boolean {
  const pinned = /^pnpm@(.+)$/u.exec(String(pkg.packageManager ?? ''));
  const version = pinned ? pinned[1] : probe(dir);
  const major = version === undefined ? undefined : majorOf(version);
  return major !== undefined && major >= 10;
}

export interface NativeBuildAllowanceChange {
  readonly file: typeof WORKSPACE_FILE | 'package.json';
  /** Setting path, e.g. `allowBuilds.node-pty` or `onlyBuiltDependencies`. */
  readonly setting: string;
  readonly value: string;
  /**
   * The value this change replaced: pnpm 11's placeholder `"set this to true or false"` (written
   * after `ERR_PNPM_IGNORED_BUILDS`) or an empty string. Absent when the key was missing or null.
   */
  readonly replaced?: string;
}

export interface NativeBuildAllowancePlan {
  readonly changes: readonly NativeBuildAllowanceChange[];
  /** Packages the planned allowance covers (the gateway's list minus every denied or undecided one). */
  readonly wanted: readonly string[];
  /**
   * Packages the project denies with `allowBuilds: false` — the bare name or a versioned key
   * (`ssh2@1.16.0: false`), in the project's files or the enclosing workspace's root file. Left as they are.
   */
  readonly denied: readonly NativeBuildDeniedEntry[];
  /**
   * Packages the project keeps from building — `ignoredBuiltDependencies` (or the older
   * `neverBuiltDependencies`) in `package.json#pnpm` or `pnpm-workspace.yaml` (the project's, or
   * the enclosing workspace's root files), with where each was found first. They are added to no
   * allow list (#1250 migrate-overrides-ignored-builds).
   */
  readonly ignored: readonly NativeBuildIgnoredEntry[];
  /** Denied packages that an allow list already names: reported, never edited. */
  readonly conflicts: readonly NativeBuildConflict[];
  /**
   * `allowBuilds.<name>` holding a value that is neither a boolean nor pnpm's placeholder
   * (`"false"`, `no`, …): left unchanged and added to no allow list.
   */
  readonly undecided: readonly NativeBuildUndecidedEntry[];
  /** Settings read in a form pnpm does not expect (a scalar instead of a list). */
  readonly warnings: readonly string[];
  /**
   * The project's `pnpm-workspace.yaml` is missing and was not planned; the caller prints a hint
   * instead. See {@link workspaceSkipReason}.
   */
  readonly workspaceSkipped: boolean;
  readonly workspaceSkipReason?: WorkspaceSkipReason;
  /** Writes the workspace file (the caller writes `package.json`, already updated in `pkg`). */
  apply(): void;
}

export interface NativeBuildIgnoredEntry {
  readonly name: string;
  /** `ignoredBuiltDependencies` or `neverBuiltDependencies`. */
  readonly setting: typeof BUILD_DENY_LISTS[number];
  /** Where the project denies the build, e.g. `package.json pnpm.ignoredBuiltDependencies`. */
  readonly source: string;
}

export interface NativeBuildDeniedEntry {
  readonly name: string;
  /** e.g. `pnpm-workspace.yaml allowBuilds.ssh2@1.16.0`. */
  readonly source: string;
}

export interface NativeBuildConflict {
  readonly name: string;
  /** Every place that denies the build (deny lists and `allowBuilds: false`). */
  readonly deniedBy: readonly string[];
  /** Every place that allows it (`allowBuilds: true`, `onlyBuiltDependencies`). */
  readonly allowedBy: readonly string[];
}

export interface NativeBuildUndecidedEntry {
  readonly name: string;
  readonly source: string;
  readonly value: string;
}

/** pnpm settings listing packages whose build scripts never run. */
const BUILD_DENY_LISTS = ['ignoredBuiltDependencies', 'neverBuiltDependencies'] as const;

/**
 * The value pnpm 11 writes into `allowBuilds` for a build script it skipped
 * (`UNDECIDED_ALLOW_BUILD` of pnpm's building policy). The only non-boolean value replaced.
 */
const PNPM_UNDECIDED_ALLOW_BUILD = 'set this to true or false';

/**
 * The package name of a build-setting entry: `ssh2`, `ssh2@1.16.0`, `@scope/name@1 || 2` →
 * `ssh2`, `ssh2`, `@scope/name` (the same split pnpm applies to `allowBuilds` keys).
 */
export function buildEntryPackageName(entry: string): string {
  const value = entry.trim();
  const at = value.indexOf('@', 1);
  return at === -1 ? value : value.slice(0, at);
}

function isGatewayNativeBuild(name: string): boolean {
  return (GATEWAY_NATIVE_BUILD_DEPENDENCIES as readonly string[]).includes(name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One place pnpm reads build settings from. */
interface BuildSettingsSource {
  /** `package.json`, `pnpm-workspace.yaml`, or the absolute path of an enclosing workspace's file. */
  readonly label: string;
  /** `pnpm.` for a `package.json#pnpm` field. */
  readonly prefix: string;
  readonly settings: Record<string, unknown>;
}

/** What the project's (and its enclosing workspace's) build settings say about the gateway's packages. */
interface BuildDecisions {
  readonly ignored: Map<string, NativeBuildIgnoredEntry>;
  readonly deniedBy: Map<string, string[]>;
  readonly allowedBy: Map<string, string[]>;
  readonly denied: NativeBuildDeniedEntry[];
  readonly warnings: string[];
}

const pushTo = (map: Map<string, string[]>, name: string, value: string): void => {
  const list = map.get(name);
  if (list) list.push(value);
  else map.set(name, [value]);
};

/** A list setting's entries (trimmed); a scalar string counts as a one-entry list, with a warning. */
function listEntries(value: unknown, where: string, warnings: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    warnings.push(`${where} 是单个字符串而不是列表，按单元素 [${value.trim()}] 处理；pnpm 期望列表（scalar read as a one-entry list）`);
    return [value.trim()];
  }
  return [];
}

function collectBuildDecisions(sources: readonly BuildSettingsSource[]): BuildDecisions {
  const decisions: BuildDecisions = { ignored: new Map(), deniedBy: new Map(), allowedBy: new Map(), denied: [], warnings: [] };
  for (const { label, prefix, settings } of sources) {
    for (const setting of BUILD_DENY_LISTS) {
      const source = `${label} ${prefix}${setting}`;
      for (const entry of listEntries(settings[setting], source, decisions.warnings)) {
        const name = buildEntryPackageName(entry);
        if (!isGatewayNativeBuild(name)) continue;
        if (!decisions.ignored.has(name)) decisions.ignored.set(name, { name, setting, source });
        pushTo(decisions.deniedBy, name, entry === name ? source : `${source}（${entry}）`);
      }
    }
    const onlyBuilt = `${label} ${prefix}onlyBuiltDependencies`;
    for (const entry of listEntries(settings.onlyBuiltDependencies, onlyBuilt, decisions.warnings)) {
      const name = buildEntryPackageName(entry);
      if (isGatewayNativeBuild(name)) pushTo(decisions.allowedBy, name, entry === name ? onlyBuilt : `${onlyBuilt}（${entry}）`);
    }
    if (!isPlainObject(settings.allowBuilds)) continue;
    for (const [key, value] of Object.entries(settings.allowBuilds)) {
      const name = buildEntryPackageName(key);
      if (!isGatewayNativeBuild(name)) continue;
      const source = `${label} ${prefix}allowBuilds.${key.trim()}`;
      if (value === false) {
        decisions.denied.push({ name, source });
        pushTo(decisions.deniedBy, name, `${source}: false`);
      } else if (value === true) {
        pushTo(decisions.allowedBy, name, `${source}: true`);
      }
    }
  }
  return decisions;
}

/** Why a missing `pnpm-workspace.yaml` is not created. */
export type WorkspaceSkipReason =
  /** The project is a member of an enclosing pnpm workspace: a file here would make it a separate root. */
  | { readonly kind: 'nested-workspace'; readonly workspaceFile: string }
  /** pnpm 10+ is not confirmed: pnpm 9 rejects a workspace file without `packages` (and runs build scripts anyway). */
  | { readonly kind: 'pnpm-unconfirmed' };

/**
 * The nearest `pnpm-workspace.yaml` in an ancestor of `dir` (not `dir` itself). The search stops
 * at the filesystem root and at the user's home directory (neither beyond nor at it).
 */
export function findAncestorWorkspaceFile(dir: string, homeDir: string = os.homedir()): string | undefined {
  const home = homeDir ? path.resolve(homeDir) : undefined;
  let current = path.resolve(dir);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current || parent === home) return undefined;
    const candidate = path.join(parent, WORKSPACE_FILE);
    if (fs.existsSync(candidate)) return candidate;
    current = parent;
  }
}

export interface NativeBuildAllowanceOptions {
  /** Installed pnpm version, consulted when `packageManager` does not pin pnpm. */
  readonly pnpmVersion?: PnpmVersionProbe;
  /** Upper bound of the enclosing-workspace search (default: the user's home directory). */
  readonly homeDir?: string;
}

/**
 * Plans the build-script allowance for the gateway's native dependencies in a pnpm project that
 * declares `@zhin.js/gateway`. Existing decisions are kept; only missing ones are appended (only
 * pnpm 11's placeholder, an empty value or null is replaced). A package is added to no list when
 * the project — or, for a project nested in a pnpm workspace, the workspace root's
 * `pnpm-workspace.yaml` / `package.json` — denies it: listed in `ignoredBuiltDependencies` /
 * `neverBuiltDependencies`, or `allowBuilds.<name>` / `allowBuilds.<name>@<version>` false. List
 * entries and keys are compared by package name (`ssh2@1.16.0` names `ssh2`). Otherwise:
 * - `allowBuilds.<name>: true` in `pnpm-workspace.yaml` (created when absent, only when the
 *   project is not inside an enclosing pnpm workspace and pnpm 10+ is confirmed — see
 *   {@link findAncestorWorkspaceFile}, {@link confirmsPnpm10}); a versioned key alone
 *   (`ssh2@1.16.0: true`) is the project's decision and gets no bare key;
 * - `onlyBuiltDependencies` in `pnpm-workspace.yaml` when that list exists or the project pins
 *   pnpm < 10.26, and in `package.json#pnpm.onlyBuiltDependencies` when that list exists
 *   (mutated in `pkg`; never created — pnpm 11 warns about the `pnpm` field).
 * Returns undefined when nothing applies (no gateway, not pnpm, unreadable workspace file).
 */
export function planNativeBuildAllowance(
  dir: string,
  pkg: Record<string, any>,
  options: NativeBuildAllowanceOptions = {},
): NativeBuildAllowancePlan | undefined {
  if (!declaresGateway(pkg) || !usesPnpm(dir, pkg)) return undefined;
  const workspacePath = path.join(dir, WORKSPACE_FILE);
  const exists = fs.existsSync(workspacePath);
  let workspaceSkipReason: WorkspaceSkipReason | undefined;
  const sources: BuildSettingsSource[] = [];
  if (isPlainObject(pkg.pnpm)) sources.push({ label: 'package.json', prefix: 'pnpm.', settings: pkg.pnpm });
  if (!exists) {
    const workspaceFile = findAncestorWorkspaceFile(dir, options.homeDir);
    if (workspaceFile) {
      workspaceSkipReason = { kind: 'nested-workspace', workspaceFile };
      // pnpm reads the settings of the workspace root, not the member's: its denials count too.
      const rootDoc = parseDocument(fs.readFileSync(workspaceFile, 'utf8'));
      if (rootDoc.errors.length > 0) return undefined;
      const rootSettings: unknown = rootDoc.toJS();
      if (isPlainObject(rootSettings)) sources.push({ label: workspaceFile, prefix: '', settings: rootSettings });
      const rootManifest = path.join(path.dirname(workspaceFile), 'package.json');
      try {
        const manifest: unknown = JSON.parse(fs.readFileSync(rootManifest, 'utf8'));
        if (isPlainObject(manifest) && isPlainObject(manifest.pnpm)) sources.push({ label: rootManifest, prefix: 'pnpm.', settings: manifest.pnpm });
      } catch { /* no readable root package.json */ }
    } else if (!confirmsPnpm10(dir, pkg, options.pnpmVersion)) workspaceSkipReason = { kind: 'pnpm-unconfirmed' };
  }
  const workspaceSkipped = workspaceSkipReason !== undefined;
  const doc = exists ? parseDocument(fs.readFileSync(workspacePath, 'utf8')) : new Document({});
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return undefined;
  if (exists) {
    const settings: unknown = doc.toJS();
    if (isPlainObject(settings)) sources.push({ label: WORKSPACE_FILE, prefix: '', settings });
  }

  // An explicit denial wins over the gateway's wish to build (#1250): never allow these.
  const decisions = collectBuildDecisions(sources);
  const ignored = GATEWAY_NATIVE_BUILD_DEPENDENCIES.flatMap(name => {
    const entry = decisions.ignored.get(name);
    return entry ? [entry] : [];
  });
  const deniedNames = new Set(decisions.denied.map(entry => entry.name));
  const undecided: NativeBuildUndecidedEntry[] = [];
  const projectAllowBuilds: unknown = exists ? (doc.toJS() as Record<string, unknown> | null)?.allowBuilds : undefined;
  if (isPlainObject(projectAllowBuilds)) {
    for (const [key, value] of Object.entries(projectAllowBuilds)) {
      const name = buildEntryPackageName(key);
      if (!isGatewayNativeBuild(name) || typeof value === 'boolean' || value === null || value === '' || value === PNPM_UNDECIDED_ALLOW_BUILD) continue;
      undecided.push({ name, source: `${WORKSPACE_FILE} allowBuilds.${key.trim()}`, value: typeof value === 'string' ? value : JSON.stringify(value) });
    }
  }
  const undecidedNames = new Set(undecided.map(entry => entry.name));
  const wanted = GATEWAY_NATIVE_BUILD_DEPENDENCIES.filter(name =>
    !decisions.ignored.has(name) && !deniedNames.has(name) && !undecidedNames.has(name));
  const conflicts: NativeBuildConflict[] = GATEWAY_NATIVE_BUILD_DEPENDENCIES.flatMap(name => {
    const deniedBy = decisions.deniedBy.get(name);
    const allowedBy = decisions.allowedBy.get(name);
    return deniedBy && allowedBy ? [{ name, deniedBy, allowedBy }] : [];
  });

  const changes: NativeBuildAllowanceChange[] = [];
  let allowBuilds = workspaceSkipped ? undefined : doc.get('allowBuilds', true);
  // An empty `allowBuilds:` key holds a null scalar, which `setIn` cannot descend into.
  if (allowBuilds === null || (isScalar(allowBuilds) && allowBuilds.value === null)) {
    allowBuilds = doc.createNode({});
    doc.set('allowBuilds', allowBuilds);
  }
  if (!workspaceSkipped && (allowBuilds === undefined || isMap(allowBuilds))) {
    const keys = isPlainObject(projectAllowBuilds) ? Object.keys(projectAllowBuilds) : [];
    for (const name of wanted) {
      const hasBare = keys.some(key => key.trim() === name);
      const current = hasBare ? (projectAllowBuilds as Record<string, unknown>)[keys.find(key => key.trim() === name)!] : undefined;
      if (current === true) continue;
      // A versioned decision (`ssh2@1.16.0: true`) is the project's; a bare key would widen it.
      if (!hasBare && keys.some(key => buildEntryPackageName(key) === name)) continue;
      // Only pnpm 11's placeholder (written after ERR_PNPM_IGNORED_BUILDS), an empty value or a
      // missing key is unset; otherwise the next `pnpm install` keeps failing (zhinjs/zhin#1250).
      doc.setIn(['allowBuilds', name], true);
      const replaced = current === undefined || current === null ? undefined : String(current);
      changes.push({ file: WORKSPACE_FILE, setting: `allowBuilds.${name}`, value: 'true', ...(replaced !== undefined ? { replaced } : {}) });
    }
  }

  let workspaceList = workspaceSkipped ? undefined : doc.get('onlyBuiltDependencies');
  if (!workspaceSkipped && (workspaceList === undefined || workspaceList === null) && pinsPnpmWithoutAllowBuilds(pkg)) {
    workspaceList = doc.createNode([]);
    doc.set('onlyBuiltDependencies', workspaceList);
  }
  if (isSeq(workspaceList)) {
    const present = new Set(workspaceList.items.map(item => buildEntryPackageName(String(isScalar(item) ? item.value : item))));
    for (const name of wanted) {
      if (present.has(name)) continue;
      workspaceList.add(doc.createNode(name));
      changes.push({ file: WORKSPACE_FILE, setting: 'onlyBuiltDependencies', value: name });
    }
  }

  const packageList = pkg.pnpm?.onlyBuiltDependencies;
  if (Array.isArray(packageList)) {
    const present = new Set(packageList.filter((item): item is string => typeof item === 'string').map(buildEntryPackageName));
    for (const name of wanted) {
      if (present.has(name)) continue;
      packageList.push(name);
      changes.push({ file: 'package.json', setting: 'pnpm.onlyBuiltDependencies', value: name });
    }
  }

  const workspaceChanged = changes.some(change => change.file === WORKSPACE_FILE);
  return {
    changes,
    wanted,
    denied: decisions.denied,
    ignored,
    conflicts,
    undecided,
    warnings: decisions.warnings,
    workspaceSkipped,
    ...(workspaceSkipReason ? { workspaceSkipReason } : {}),
    apply() {
      // lineWidth 0: keep long strings on one line instead of reflowing the user's file.
      if (workspaceChanged) fs.writeFileSync(workspacePath, doc.toString({ lineWidth: 0 }));
    },
  };
}

/** How pnpm resolves a package that is both denied and allowed (printed with a conflict). */
const CONFLICT_RULE = 'pnpm 10 以允许名单为准（onlyBuiltDependencies 或 allowBuilds: true 会构建；ignoredBuiltDependencies 只是不再提示，'
  + 'neverBuiltDependencies 在存在 onlyBuiltDependencies 时被忽略）；pnpm 11 只读 allowBuilds（false 优先于 true），'
  + '不读 onlyBuiltDependencies / ignoredBuiltDependencies / neverBuiltDependencies';

/**
 * `zhin migrate` step: appends the missing allowances (dry-run only prints them). Returns whether
 * `package.json` content changed (the workspace file is written here).
 */
export function syncNativeBuildAllowance(
  dir: string,
  pkg: Record<string, any>,
  dryRun: boolean,
  options: NativeBuildAllowanceOptions = {},
): boolean {
  const plan = planNativeBuildAllowance(dir, pkg, options);
  if (!plan) return false;
  const prefix = (marker: string): string => (dryRun ? '  [dry-run] ' : `  ${marker} `);
  const { wanted } = plan;
  const entries = `allowBuilds: { ${wanted.join(': true, ')}: true }`;
  if (plan.workspaceSkipReason?.kind === 'nested-workspace' && wanted.length > 0) {
    console.log(chalk.yellow(
      `  ! 项目位于 pnpm workspace 内，未在项目中创建 ${WORKSPACE_FILE}（会使它成为独立的 workspace 根）；`
      + `请在 ${plan.workspaceSkipReason.workspaceFile} 中加入 ${entries}`
      + `（nested in a pnpm workspace: add these allowBuilds entries to the root file）`,
    ));
  } else if (plan.workspaceSkipped && wanted.length > 0) {
    console.log(chalk.gray(
      `  · 未确认 pnpm >= 10，未创建 ${WORKSPACE_FILE}（pnpm 9 本身会运行依赖构建脚本；升级到 pnpm 10+ 后再运行 zhin migrate，`
      + `或手动在 ${WORKSPACE_FILE} 加入 ${entries}）`
      + `（pnpm 10+ not confirmed, ${WORKSPACE_FILE} not created）`,
    ));
  }
  for (const warning of plan.warnings) console.log(chalk.yellow(`${prefix('!')}${warning}`));
  const conflicted = new Set(plan.conflicts.map(conflict => conflict.name));
  for (const conflict of plan.conflicts) {
    console.log(chalk.yellow(
      `${prefix('!')}${conflict.name}: 冲突——${conflict.deniedBy.join('、')} 禁止构建，但 ${conflict.allowedBy.join('、')} 允许构建；`
      + `zhin migrate 不会改动其中任何一处。${CONFLICT_RULE}。请自行决定保留哪一处`
      + `（conflict: denied and allowed at once; nothing changed, decide which to keep）`,
    ));
  }
  for (const entry of plan.ignored) {
    if (conflicted.has(entry.name)) continue;
    const text = `${entry.name}: 已跳过：在 ${entry.setting} 中（${entry.source}），zhin migrate 不会把它加入允许名单 / skipped: listed in ${entry.setting}`;
    console.log(chalk.yellow(`${prefix('·')}${text}`));
  }
  const ignoredNames = new Set(plan.ignored.map(entry => entry.name));
  for (const entry of plan.denied) {
    if (conflicted.has(entry.name) || ignoredNames.has(entry.name)) continue;
    console.log(chalk.yellow(`${prefix('!')}${entry.source} 为 false（项目已拒绝），保留；Console 终端需要 node-pty 的原生模块`));
  }
  for (const entry of plan.undecided) {
    console.log(chalk.yellow(
      `${prefix('!')}${entry.source} 的值 ${JSON.stringify(entry.value)} 不是布尔值（pnpm 只认 true / false），保留不动，也不加入其他允许名单；`
      + `请改成 true 或 false（not a boolean: left unchanged）`,
    ));
  }
  for (const change of plan.changes) {
    const target = change.setting.startsWith('allowBuilds.')
      ? `${change.file} ${change.setting}: ${change.value}${change.replaced !== undefined ? `（替换了占位值 ${JSON.stringify(change.replaced)} / replaced placeholder）` : ''}`
      : `${change.file} ${change.setting}: + ${change.value}`;
    console.log(chalk.cyan(`${prefix('·')}${target}`));
  }
  if (!dryRun) plan.apply();
  return plan.changes.some(change => change.file === 'package.json');
}

export type NativeModuleProbe =
  | { readonly status: 'ok' }
  /** `@zhin.js/gateway` does not resolve from the project. */
  | { readonly status: 'no-gateway' }
  | { readonly status: 'failed'; readonly reason: string };

const NO_GATEWAY_EXIT_CODE = 3;

/**
 * Runs in a child `node` in the project directory: resolves the project's gateway, then loads the
 * module from the gateway's own location (pnpm does not hoist its optional dependencies). The
 * CLI's own dependency tree is never consulted.
 */
const PROBE_SCRIPT = `
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
let dir;
try { dir = dirname(fileURLToPath(import.meta.resolve(${JSON.stringify(GATEWAY_PACKAGE)}))); } catch { process.exit(${NO_GATEWAY_EXIT_CODE}); }
const isGatewayRoot = (candidate) => {
  try { return JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')).name === ${JSON.stringify(GATEWAY_PACKAGE)}; } catch { return false; }
};
while (!(existsSync(join(dir, 'package.json')) && isGatewayRoot(dir))) {
  const parent = dirname(dir);
  if (parent === dir) process.exit(${NO_GATEWAY_EXIT_CODE});
  dir = parent;
}
try { createRequire(join(dir, 'package.json'))(process.argv[1]); }
catch (error) { process.stderr.write(String(error && error.message || error)); process.exit(1); }
`;

/** Loads `moduleName` (default `node-pty`) the way the project's gateway would, in a child process. */
export function probeGatewayNativeModule(root: string, moduleName = 'node-pty', timeoutMs = 20_000): Promise<NativeModuleProbe> {
  return new Promise(resolveProbe => {
    // The gateway loads node-pty with ESM `import()`, which ignores NODE_PATH; pnpm scripts set
    // NODE_PATH to its hoisted store, so the child resolves without it.
    const { NODE_PATH: _nodePath, ...env } = process.env;
    execFile(process.execPath, ['--input-type=module', '-e', PROBE_SCRIPT, moduleName], { cwd: root, env, timeout: timeoutMs, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) return resolveProbe({ status: 'ok' });
      if ((error as { code?: unknown }).code === NO_GATEWAY_EXIT_CODE) return resolveProbe({ status: 'no-gateway' });
      const reason = String(stderr).trim().split('\n')[0] || error.message;
      resolveProbe({ status: 'failed', reason });
    });
  });
}

/** Repair commands for a `node-pty` that does not load (doctor fix text). */
export function nativeModuleFixCommand(dir: string, pkg: Record<string, any>, moduleName = 'node-pty'): string {
  if (!usesPnpm(dir, pkg)) {
    return `npm rebuild ${moduleName}（需要 Python 与 C/C++ 编译工具链 / needs Python and a C/C++ toolchain）`;
  }
  return `zhin migrate（或手动在 ${WORKSPACE_FILE} 加入 allowBuilds: { ${moduleName}: true }；pnpm < 10.26 用 onlyBuiltDependencies），然后 pnpm rebuild ${moduleName}（需要 Python 与 C/C++ 编译工具链）`;
}
