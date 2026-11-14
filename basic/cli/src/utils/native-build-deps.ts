/**
 * Native build scripts of the management gateway's dependency tree (#1250).
 *
 * `@zhin.js/gateway` depends on `node-pty` (Console terminal), `ssh2` and, through it,
 * `cpu-features`; their install scripts compile native addons. pnpm 10+ skips dependency build
 * scripts unless the package is allowed — pnpm 11 only through `allowBuilds` in
 * `pnpm-workspace.yaml` (it ignores the `pnpm` field of `package.json`), pnpm 10.0–10.25 only
 * through `onlyBuiltDependencies`. Without the allowance `node-pty` installs without its binding.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
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
  /** Writes the workspace file (the caller writes `package.json`, already updated in `pkg`). */
  apply(): void;
}

/**
 * Plans the build-script allowance for the gateway's native dependencies in a pnpm project that
 * declares `@zhin.js/gateway`. Existing decisions are kept; only missing ones are appended:
 * - `allowBuilds.<name>: true` in `pnpm-workspace.yaml` (created when absent; a non-boolean value
 *   such as pnpm 11's `set this to true or false` placeholder is replaced);
 * - `onlyBuiltDependencies` in `pnpm-workspace.yaml` when that list exists or the project pins
 *   pnpm < 10.26, and in `package.json#pnpm.onlyBuiltDependencies` when that list exists
 *   (mutated in `pkg`; never created — pnpm 11 warns about the `pnpm` field).
 * Returns undefined when nothing applies (no gateway, not pnpm, unreadable workspace file).
 */
export function planNativeBuildAllowance(dir: string, pkg: Record<string, any>): NativeBuildAllowancePlan | undefined {
  if (!declaresGateway(pkg) || !usesPnpm(dir, pkg)) return undefined;
  const workspacePath = path.join(dir, WORKSPACE_FILE);
  const exists = fs.existsSync(workspacePath);
  const doc = exists ? parseDocument(fs.readFileSync(workspacePath, 'utf8')) : new Document({});
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return undefined;

  const changes: NativeBuildAllowanceChange[] = [];
  const denied: string[] = [];
  const allowBuilds = doc.get('allowBuilds');
  if (allowBuilds === undefined || allowBuilds === null || isMap(allowBuilds)) {
    for (const name of GATEWAY_NATIVE_BUILD_DEPENDENCIES) {
      const current = doc.getIn(['allowBuilds', name]);
      if (current === false) denied.push(name);
      // A boolean is the project's decision. Anything else — notably the `set this to true or false`
      // placeholder pnpm 11 writes for every build script it ignored — is not a decision: pnpm keeps
      // failing the install with ERR_PNPM_IGNORED_BUILDS until it is replaced.
      if (typeof current === 'boolean') continue;
      doc.setIn(['allowBuilds', name], true);
      changes.push({ file: WORKSPACE_FILE, setting: `allowBuilds.${name}`, value: 'true' });
    }
  }

  let workspaceList = doc.get('onlyBuiltDependencies');
  if (workspaceList === undefined && pinsPnpmWithoutAllowBuilds(pkg)) {
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
    apply() {
      if (workspaceChanged) fs.writeFileSync(workspacePath, doc.toString());
    },
  };
}

/**
 * `zhin migrate` step: appends the missing allowances (dry-run only prints them). Returns whether
 * `package.json` content changed (the workspace file is written here).
 */
export function syncNativeBuildAllowance(dir: string, pkg: Record<string, any>, dryRun: boolean): boolean {
  const plan = planNativeBuildAllowance(dir, pkg);
  if (!plan) return false;
  for (const name of plan.denied) {
    console.log(chalk.yellow(`  ! ${WORKSPACE_FILE}: allowBuilds.${name} 为 false（项目已拒绝），保留；Console 终端需要 node-pty 的原生模块`));
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
