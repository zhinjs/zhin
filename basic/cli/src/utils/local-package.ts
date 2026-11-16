/**
 * Local lookup for `zhin info` (#1250 `cli-info-local-workspace-plugin`): a plugin that lives in this
 * project's pnpm workspace (`plugins/media-ai`) or is installed into its `node_modules` is described
 * from disk before the npm registry is asked. Only `package.json` is read — no plugin code runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findInstalledPackageRoot } from './package-capabilities.js';
import { findProjectRoot } from './project-packages.js';
import { listWorkspacePackageDirs, workspaceRelative } from './workspace-packages.js';

export interface LocalPackage {
  /** `workspace`: a member of this project's workspace (or the project itself); `installed`: in `node_modules`. */
  readonly source: 'workspace' | 'installed';
  /** Package directory (for a workspace member linked into `node_modules`, the member directory). */
  readonly root: string;
  /** `plugins/media-ai` for a workspace member, `.` for the project itself. */
  readonly relative?: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

function readManifest(dir: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function realpath(dir: string): string {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

function insideWorkspace(projectRoot: string, dir: string): string | undefined {
  const relative = path.relative(realpath(projectRoot), realpath(dir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  if (relative.split(path.sep).includes('node_modules')) return undefined;
  return relative === '' ? '.' : relative.split(path.sep).join('/');
}

/** This project's workspace member (or the project itself) named `packageName`, else its installed copy. */
export function findLocalPackage(packageName: string, cwd = process.cwd()): LocalPackage | undefined {
  const projectRoot = findProjectRoot(cwd);
  for (const dir of [projectRoot, ...listWorkspacePackageDirs(projectRoot)]) {
    const manifest = readManifest(dir);
    if (manifest?.name !== packageName) continue;
    return { source: 'workspace', root: dir, relative: dir === projectRoot ? '.' : workspaceRelative(projectRoot, dir), manifest };
  }
  const installed = findInstalledPackageRoot(packageName, cwd);
  const manifest = installed ? readManifest(installed) : undefined;
  if (!installed || manifest?.name !== packageName) return undefined;
  // pnpm links workspace members into node_modules: report them as workspace packages.
  const relative = insideWorkspace(projectRoot, installed);
  if (relative !== undefined) return { source: 'workspace', root: realpath(installed), relative, manifest };
  return { source: 'installed', root: installed, manifest };
}
