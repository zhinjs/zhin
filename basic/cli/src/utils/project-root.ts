/**
 * Where the Zhin project is for a CLI run (#1250 `start-no-project-check`,
 * `console-cli-store-in-cwd`, `doctor-non-project-advice`): commands that create `.zhin/`
 * (`zhin start`, `zhin console …`) or diagnose a project (`zhin doctor`) locate the project root
 * first instead of taking `process.cwd()` as it is, so a run from a sub-directory or an
 * unrelated directory never leaves a stray `.zhin/gateway.db` behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findConfigFile } from '@zhin.js/gateway/project';

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

/**
 * The project root for `cwd`, or undefined when there is none: the nearest directory up the
 * tree holding a Zhin config file (`zhin.config.yml`), else the nearest whose package.json
 * depends on `zhin.js`. Run from `plugins/foo/` it finds the project, not the member package.
 */
export function locateProjectRoot(cwd: string): string | undefined {
  let byManifest: string | undefined;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (findConfigFile(dir)) return dir;
    if (!byManifest && declaresZhin(dir)) byManifest = dir;
    if (path.dirname(dir) === dir) return byManifest;
  }
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
  /** The command to suggest re-running at the root (e.g. `zhin start`). */
  readonly command?: string;
}

/** Message for a directory with no project anywhere up the tree. */
export function notAProjectMessage(cwd: string): string {
  return `${path.resolve(cwd)} 不是 Zhin 项目（本目录及上级目录都没有 zhin.config.yml 或依赖 zhin.js 的 package.json）。`
    + `新建项目：${CREATE_PROJECT_COMMAND}；已有项目请先 cd 到项目根目录再运行。`;
}

/**
 * Checks that `cwd` is (or, with `from: 'nearest'`, is inside) a Zhin project whose root has a
 * package.json. Reads files only; never creates anything.
 */
export function requireProjectRoot(cwd: string, options: RequireProjectRootOptions = {}): ProjectRootCheck {
  const resolved = path.resolve(cwd);
  const root = locateProjectRoot(resolved);
  if (!root) return { ok: false, message: notAProjectMessage(resolved) };
  if ((options.from ?? 'root') === 'root' && root !== resolved) {
    const rerun = options.command ? `：cd ${root} && ${options.command}` : '';
    return { ok: false, message: `当前目录不是项目根：项目根在 ${root}，请在那里运行${rerun}` };
  }
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    return { ok: false, message: `项目根 ${root} 缺少 package.json（新建项目：${CREATE_PROJECT_COMMAND}）` };
  }
  return { ok: true, root };
}
