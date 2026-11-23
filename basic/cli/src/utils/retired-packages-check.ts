/**
 * Retired `@zhin.js/*` packages in a project (#1250 `retired-package-not-flagged`): which
 * package.json (the root or a pnpm workspace member) still declares one, and which source files
 * still import it. The catalog itself is `RETIRED_ZHIN_PACKAGES` of `@zhin.js/gateway/project`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findRetiredDependencies, findRetiredImports, type RetiredDependency, type RetiredImportUse } from '@zhin.js/gateway/project';
import { listWorkspacePackageDirs, workspaceRelative } from './workspace-packages.js';

export interface ProjectRetiredDependency extends RetiredDependency {
  /** `package.json` of the root, or `plugins/foo/package.json` of a workspace member. */
  readonly manifest: string;
}

function readManifest(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** Retired packages declared by the root `package.json` and every pnpm workspace member's. */
export function findProjectRetiredDependencies(root: string): ProjectRetiredDependency[] {
  const dirs = [root, ...listWorkspacePackageDirs(root).filter(dir => path.resolve(dir) !== path.resolve(root))];
  return dirs.flatMap(dir => {
    const relative = workspaceRelative(root, dir);
    const manifest = relative && relative !== '.' ? `${relative}/package.json` : 'package.json';
    return findRetiredDependencies(readManifest(path.join(dir, 'package.json'))).map(hit => ({ ...hit, manifest }));
  });
}

/** One doctor/migrate line per retired dependency: where it is declared and what to do. */
export function formatRetiredDependency(hit: ProjectRetiredDependency): string {
  return `${hit.manifest} 的 ${hit.field} 依赖 ${hit.name}（${hit.specifier}）：${hit.retired.action}`;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', '.zhin', '.turbo']);
/** Upper bound on scanned files, so a huge checkout does not stall `zhin migrate`. */
const MAX_SOURCE_FILES = 5000;

export interface ProjectRetiredImport extends RetiredImportUse {
  /** Project-relative path with `/` separators. */
  readonly file: string;
}

/**
 * Imports of retired packages in the project's own sources (dependency and build directories and
 * hidden directories are skipped). Read only: the caller prints the edits.
 */
export function findProjectRetiredImports(root: string): ProjectRetiredImport[] {
  const uses: ProjectRetiredImport[] = [];
  let scanned = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (scanned >= MAX_SOURCE_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) walk(full);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.endsWith('.d.ts')) continue;
      scanned += 1;
      let text: string;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (!text.includes('@zhin.js/')) continue;
      const file = path.relative(root, full).split(path.sep).join('/');
      for (const use of findRetiredImports(text)) uses.push({ ...use, file });
    }
  };
  walk(root);
  return uses;
}

/** `src/a.ts:3 '@zhin.js/config-yaml' → '@zhin.js/runtime'` (or the action when nothing replaces it). */
export function formatRetiredImport(use: ProjectRetiredImport): string {
  return use.replacement
    ? `${use.file}:${use.line} '${use.specifier}' → '${use.replacement}'`
    : `${use.file}:${use.line} '${use.specifier}'：${use.retired.action}`;
}

/** `zhin doctor`'s check result (the `CheckResult` shape): warn per retired dependency, ok otherwise. */
export function retiredPackagesResult(root: string): { name: string; status: 'ok' | 'warn'; message: string; fix?: string } {
  const name = '已停更的 Zhin 包';
  let hits: ProjectRetiredDependency[];
  try {
    hits = findProjectRetiredDependencies(root);
  } catch (error) {
    return { name, status: 'warn', message: `无法检查：${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
  if (hits.length === 0) return { name, status: 'ok', message: '没有依赖已并入或停更的 @zhin.js 包' };
  return {
    name,
    status: 'warn',
    message: `${hits.map(formatRetiredDependency).join('；')}。这些包的最后版本仍依赖旧的 Zhin 包，会拖进第二份实例；pnpm.overrides 只能掩盖，删除依赖才能解决`,
    fix: `${[...new Set(hits.map(hit => hit.manifest))].map(file => `改写 import 后从 ${file} 删除 ${hits.filter(hit => hit.manifest === file).map(hit => hit.name).join('、')}`).join('；')}，然后运行 pnpm install（zhin migrate 会列出要改的 import）`,
  };
}
