/**
 * Where the Zhin project is for a CLI run (#1250 `start-no-project-check`,
 * `console-cli-store-in-cwd`, `doctor-non-project-advice`): commands that create `.zhin/`
 * (`zhin start`, `zhin console …`) or diagnose a project (`zhin doctor`) locate the project root
 * first instead of taking `process.cwd()` as it is, so a run from a sub-directory or an
 * unrelated directory never leaves a stray `.zhin/gateway.db` behind.
 *
 * A project root always has a `package.json` (the instance resolves `zhin.js/instance` from it):
 * - the directory itself: `package.json` plus a Root config file (any of
 *   `ROOT_CONFIG_FILE_NAMES`), or a `package.json` that depends on `zhin.js`;
 * - a directory above it: `package.json` plus `zhin.config.*` (the generic `config.*` names are
 *   too common to claim a parent directory), or a `package.json` that depends on `zhin.js`.
 * The nearest such directory wins, unless it is a member of the pnpm workspace above it
 * (`pnpm-workspace.yaml#packages`) whose root is itself a project: then the workspace root wins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_CONFIG_FILE_NAMES } from '@zhin.js/plugin-runtime';
import { expandWorkspaceBraces, workspaceGlobToRegExp, workspacePackageGlobs } from './workspace-packages.js';

/** The command that scaffolds a new project (the `create-zhin-app` package). */
export const CREATE_PROJECT_COMMAND = 'npm create zhin-app';

/** Whether `dir/package.json` declares `zhin.js` (dependencies or devDependencies). */
export function declaresZhin(dir: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, Record<string, unknown> | undefined>;
    return manifest.dependencies?.['zhin.js'] !== undefined || manifest.devDependencies?.['zhin.js'] !== undefined;
  } catch {
    return false;
  }
}

/** Root config files present in `dir` (several of them is a conflict the instance refuses). */
export function rootConfigFilesIn(dir: string): string[] {
  return ROOT_CONFIG_FILE_NAMES.filter(name => fs.existsSync(path.join(dir, name)));
}

/**
 * Whether `dir` is a project root candidate. `nearby` is true for the directory the command runs
 * in, where the generic `config.*` names count too.
 */
function isProjectDir(dir: string, nearby: boolean): boolean {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return false;
  const configs = rootConfigFilesIn(dir);
  if (configs.some(name => nearby || name.startsWith('zhin.config.'))) return true;
  return declaresZhin(dir);
}

/** Whether `member` is a package of the pnpm workspace rooted at `workspaceRoot`. */
export function isWorkspaceMember(workspaceRoot: string, member: string): boolean {
  const relative = path.relative(workspaceRoot, member).split(path.sep).join('/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const globs = workspacePackageGlobs(workspaceRoot);
  const matches = (list: readonly string[]): boolean =>
    list.flatMap(expandWorkspaceBraces).some(glob => workspaceGlobToRegExp(glob).test(relative));
  return matches(globs.filter(glob => !glob.startsWith('!')))
    && !matches(globs.filter(glob => glob.startsWith('!')).map(glob => glob.slice(1)));
}

/** The nearest directory above `dir` holding a `pnpm-workspace.yaml`. */
function enclosingWorkspace(dir: string): string | undefined {
  for (let current = path.dirname(dir); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    if (path.dirname(current) === current) return undefined;
  }
}

/**
 * The project root for `cwd`, or undefined when there is none (see the module comment). Run from
 * `plugins/foo/` it finds the project, not the member package; a stray `config.json` in a parent
 * directory never takes over a project below it.
 */
export function locateProjectRoot(cwd: string): string | undefined {
  const start = path.resolve(cwd);
  let nearest: string | undefined;
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (isProjectDir(dir, dir === start)) { nearest = dir; break; }
    if (path.dirname(dir) === dir) return undefined;
  }
  const workspace = enclosingWorkspace(nearest);
  if (workspace && isWorkspaceMember(workspace, nearest) && isProjectDir(workspace, workspace === start)) return workspace;
  return nearest;
}

export type ProjectRootCheck =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly message: string };

export interface RequireProjectRootOptions {
  /**
   * `'root'` (default): `cwd` itself must be the project root; from a sub-directory the check
   * fails and names the root. `'nearest'`: use the root found up the tree.
   */
  readonly from?: 'root' | 'nearest';
  /** The command to suggest re-running at the root, arguments included (e.g. `['zhin', 'start', '--foreground']`). */
  readonly command?: readonly string[];
}

/** `value` quoted for the shell the user runs (POSIX single quotes; double quotes on Windows) when it needs it. */
export function shellQuote(value: string, platform: NodeJS.Platform = process.platform): string {
  if (value !== '' && /^[\w@%+=:,./-]+$/u.test(value)) return value;
  if (platform === 'win32') return `"${value.replace(/"/gu, '""')}"`;
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

/** `cd <root> && <command…>`, every part quoted as needed. */
export function rerunAtRoot(root: string, command: readonly string[]): string {
  return `cd ${shellQuote(root)} && ${command.map(part => shellQuote(part)).join(' ')}`;
}

/** Message for a directory with no project anywhere up the tree. */
export function notAProjectMessage(cwd: string): string {
  const resolved = path.resolve(cwd);
  const configs = rootConfigFilesIn(resolved);
  if (configs.length > 0 && !fs.existsSync(path.join(resolved, 'package.json'))) {
    return `${resolved} 有配置文件 ${configs.join(', ')}，但缺少 package.json：实例从项目的 package.json 解析 zhin.js，`
      + `请运行 pnpm init && pnpm add zhin.js（或用 ${CREATE_PROJECT_COMMAND} 新建项目）。`;
  }
  return `${resolved} 不是 Zhin 项目（本目录及上级目录都没有带 package.json 的 zhin.config.yml，也没有依赖 zhin.js 的 package.json）。`
    + `新建项目：${CREATE_PROJECT_COMMAND}；已有项目请先 cd 到项目根目录再运行。`;
}

/** Message when the project root holds more than one Root config file, else undefined. */
export function conflictingConfigMessage(root: string): string | undefined {
  const configs = rootConfigFilesIn(root);
  return configs.length > 1
    ? `项目根 ${root} 同时有多个配置文件（${configs.join(', ')}），实例只接受一个：请合并后只保留其中一个`
    : undefined;
}

/**
 * Checks that `cwd` is (or, with `from: 'nearest'`, is inside) a Zhin project (see the module
 * comment) with a single Root config file. Reads files only; never creates anything.
 */
export function requireProjectRoot(cwd: string, options: RequireProjectRootOptions = {}): ProjectRootCheck {
  const resolved = path.resolve(cwd);
  const root = locateProjectRoot(resolved);
  if (!root) return { ok: false, message: notAProjectMessage(resolved) };
  if ((options.from ?? 'root') === 'root' && root !== resolved) {
    const rerun = options.command ? `：${rerunAtRoot(root, options.command)}` : '';
    return { ok: false, message: `当前目录不是项目根：项目根在 ${root}，请在那里运行${rerun}` };
  }
  const conflict = conflictingConfigMessage(root);
  if (conflict) return { ok: false, message: conflict };
  return { ok: true, root };
}
