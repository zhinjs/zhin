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
}

export interface NativeBuildAllowancePlan {
  readonly changes: readonly NativeBuildAllowanceChange[];
  /** Entries the user explicitly denied (`allowBuilds.<name>: false`); left as they are. */
  readonly denied: readonly string[];
  /**
   * The project's `pnpm-workspace.yaml` is missing and was not planned; the caller prints a hint
   * instead. See {@link workspaceSkipReason}.
   */
  readonly workspaceSkipped: boolean;
  readonly workspaceSkipReason?: WorkspaceSkipReason;
  /** Writes the workspace file (the caller writes `package.json`, already updated in `pkg`). */
  apply(): void;
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
 * declares `@zhin.js/gateway`. Existing entries are kept; only missing ones are appended:
 * - `allowBuilds.<name>: true` in `pnpm-workspace.yaml` (created when absent, only when the
 *   project is not inside an enclosing pnpm workspace and pnpm 10+ is confirmed — see
 *   {@link findAncestorWorkspaceFile}, {@link confirmsPnpm10});
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
  if (!exists) {
    const workspaceFile = findAncestorWorkspaceFile(dir, options.homeDir);
    if (workspaceFile) workspaceSkipReason = { kind: 'nested-workspace', workspaceFile };
    else if (!confirmsPnpm10(dir, pkg, options.pnpmVersion)) workspaceSkipReason = { kind: 'pnpm-unconfirmed' };
  }
  const workspaceSkipped = workspaceSkipReason !== undefined;
  const doc = exists ? parseDocument(fs.readFileSync(workspacePath, 'utf8')) : new Document({});
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return undefined;

  const changes: NativeBuildAllowanceChange[] = [];
  const denied: string[] = [];
  let allowBuilds = workspaceSkipped ? undefined : doc.get('allowBuilds', true);
  // An empty `allowBuilds:` key holds a null scalar, which `setIn` cannot descend into.
  if (allowBuilds === null || (isScalar(allowBuilds) && allowBuilds.value === null)) {
    allowBuilds = doc.createNode({});
    doc.set('allowBuilds', allowBuilds);
  }
  if (!workspaceSkipped && (allowBuilds === undefined || isMap(allowBuilds))) {
    for (const name of GATEWAY_NATIVE_BUILD_DEPENDENCIES) {
      const current = doc.getIn(['allowBuilds', name]);
      if (current === false) denied.push(name);
      if (current !== undefined && current !== null) continue;
      doc.setIn(['allowBuilds', name], true);
      changes.push({ file: WORKSPACE_FILE, setting: `allowBuilds.${name}`, value: 'true' });
    }
  }

  let workspaceList = workspaceSkipped ? undefined : doc.get('onlyBuiltDependencies');
  if (!workspaceSkipped && (workspaceList === undefined || workspaceList === null) && pinsPnpmWithoutAllowBuilds(pkg)) {
    workspaceList = doc.createNode([]);
    doc.set('onlyBuiltDependencies', workspaceList);
  }
  if (isSeq(workspaceList)) {
    const present = new Set(workspaceList.items.map(item => String(isScalar(item) ? item.value : item)));
    for (const name of GATEWAY_NATIVE_BUILD_DEPENDENCIES) {
      if (present.has(name) || denied.includes(name)) continue;
      workspaceList.add(doc.createNode(name));
      changes.push({ file: WORKSPACE_FILE, setting: 'onlyBuiltDependencies', value: name });
    }
  }

  const packageList = pkg.pnpm?.onlyBuiltDependencies;
  if (Array.isArray(packageList)) {
    for (const name of GATEWAY_NATIVE_BUILD_DEPENDENCIES) {
      if (packageList.includes(name) || denied.includes(name)) continue;
      packageList.push(name);
      changes.push({ file: 'package.json', setting: 'pnpm.onlyBuiltDependencies', value: name });
    }
  }

  const workspaceChanged = changes.some(change => change.file === WORKSPACE_FILE);
  return {
    changes,
    denied,
    workspaceSkipped,
    ...(workspaceSkipReason ? { workspaceSkipReason } : {}),
    apply() {
      // lineWidth 0: keep long strings on one line instead of reflowing the user's file.
      if (workspaceChanged) fs.writeFileSync(workspacePath, doc.toString({ lineWidth: 0 }));
    },
  };
}

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
  const entries = `allowBuilds: { ${GATEWAY_NATIVE_BUILD_DEPENDENCIES.join(': true, ')}: true }`;
  if (plan.workspaceSkipReason?.kind === 'nested-workspace') {
    console.log(chalk.yellow(
      `  ! 项目位于 pnpm workspace 内，未在项目中创建 ${WORKSPACE_FILE}（会使它成为独立的 workspace 根）；`
      + `请在 ${plan.workspaceSkipReason.workspaceFile} 中加入 ${entries}`
      + `（nested in a pnpm workspace: add these allowBuilds entries to the root file）`,
    ));
  } else if (plan.workspaceSkipped) {
    console.log(chalk.gray(
      `  · 未确认 pnpm >= 10，未创建 ${WORKSPACE_FILE}（pnpm 9 本身会运行依赖构建脚本；升级到 pnpm 10+ 后再运行 zhin migrate，`
      + `或手动在 ${WORKSPACE_FILE} 加入 ${entries}）`
      + `（pnpm 10+ not confirmed, ${WORKSPACE_FILE} not created）`,
    ));
  }
  for (const name of plan.denied) {
    console.log(chalk.yellow(`  ! ${WORKSPACE_FILE}: allowBuilds.${name} 为 false，保留（denied by the project, kept; the Console terminal needs node-pty）`));
  }
  for (const change of plan.changes) {
    const target = change.setting.startsWith('allowBuilds.')
      ? `${change.file} ${change.setting}: ${change.value}`
      : `${change.file} ${change.setting}: + ${change.value}`;
    console.log(chalk.cyan(dryRun ? `  [dry-run] ${target}` : `  · ${target}`));
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
