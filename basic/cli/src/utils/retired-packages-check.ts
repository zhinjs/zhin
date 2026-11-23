/**
 * Retired `@zhin.js/*` packages in a project (#1250 `retired-package-not-flagged`): which
 * package.json (the root or a pnpm workspace member) still declares one, and which source files
 * still import one or a deleted subpath (`@zhin.js/agent/tools`). The catalogs themselves are
 * `RETIRED_ZHIN_PACKAGES` and `REMOVED_ZHIN_SUBPATHS` of `@zhin.js/gateway/project`.
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
/** Dependency, build output and tool directories; `lib` too, unless it holds the package's own sources (see {@link libHoldsSources}). */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'lib', 'dist', 'build', 'out', 'coverage', '.git', '.zhin', '.turbo']);
/** Upper bound on scanned source files, so a huge checkout does not stall `zhin migrate`. */
const MAX_SOURCE_FILES = 5000;
/** Upper bound on visited directory entries (files and directories), for trees with few sources but many files. */
const MAX_DIRECTORY_ENTRIES = 20_000;

export interface ProjectRetiredImport extends RetiredImportUse {
  /** Project-relative path with `/` separators. */
  readonly file: string;
}

export interface ProjectRetiredImportScan {
  readonly uses: readonly ProjectRetiredImport[];
  /** Source files read. */
  readonly scannedFiles: number;
  /** Set when a limit stopped the walk: the uses cover only the first `scannedFiles` files. */
  readonly truncated: boolean;
}

export interface ProjectRetiredImportScanLimits {
  /** Default 5000. */
  readonly maxSourceFiles?: number;
  /** Default 20000. */
  readonly maxDirectoryEntries?: number;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, out);
}

/**
 * Whether `dir/lib` is where the package in `dir` keeps its own JavaScript sources rather than build
 * output: its `package.json` `main` / `module` / `exports` point into `lib/` and `dir` has no `src`
 * directory (a package written in plain JavaScript). Such a `lib` is scanned.
 */
export function libHoldsSources(dir: string): boolean {
  if (fs.existsSync(path.join(dir, 'src'))) return false;
  const manifest = readManifest(path.join(dir, 'package.json')) as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest !== 'object') return false;
  const targets: string[] = [];
  collectStrings([manifest.main, manifest.module, manifest.exports], targets);
  return targets.some(target => /^(?:\.\/)?lib\//u.test(target) && /\.[cm]?jsx?$/u.test(target));
}

/**
 * Imports of retired packages in the project's own sources. Dependency, build output (`dist`,
 * `build`, `out`, `lib` unless it holds the package's sources) and hidden directories are skipped;
 * the walk stops after `maxSourceFiles` source files or `maxDirectoryEntries` visited entries and
 * then reports `truncated`. Read only: the caller prints the edits.
 */
export function scanProjectRetiredImports(root: string, limits: ProjectRetiredImportScanLimits = {}): ProjectRetiredImportScan {
  const maxFiles = limits.maxSourceFiles ?? MAX_SOURCE_FILES;
  const maxEntries = limits.maxDirectoryEntries ?? MAX_DIRECTORY_ENTRIES;
  const uses: ProjectRetiredImport[] = [];
  let scanned = 0;
  let visited = 0;
  let truncated = false;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return;
      if (visited >= maxEntries) {
        truncated = true;
        return;
      }
      visited += 1;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (SKIPPED_DIRECTORIES.has(entry.name) && !(entry.name === 'lib' && libHoldsSources(dir))) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.endsWith('.d.ts')) continue;
      if (scanned >= maxFiles) {
        truncated = true;
        return;
      }
      scanned += 1;
      let text: string;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (!text.includes('@zhin.js/')) continue;
      const file = path.relative(root, full).split(path.sep).join('/');
      for (const use of findRetiredImports(text)) uses.push({ ...use, file });
    }
  };
  walk(root);
  return { uses, scannedFiles: scanned, truncated };
}

/** The doctor/migrate note for a truncated scan (Chinese). */
export function formatTruncatedScan(scan: ProjectRetiredImportScan): string {
  return `仅扫描了前 ${scan.scannedFiles} 个源文件（项目文件过多，已达扫描上限），其余文件里的 import 未检查：可在子目录中自行搜索 '@zhin.js/'`;
}

/**
 * `src/a.ts:3 '@zhin.js/config-yaml' → '@zhin.js/runtime'`, plus the action for a deleted subpath
 * (whose replacement covers only some exports); the action alone when nothing replaces the specifier.
 */
export function formatRetiredImport(use: ProjectRetiredImport): string {
  if (!use.replacement) return `${use.file}:${use.line} '${use.specifier}'：${use.action}`;
  const rewrite = `${use.file}:${use.line} '${use.specifier}' → '${use.replacement}'`;
  return use.removedSubpath ? `${rewrite}：${use.action}` : rewrite;
}

/** Imports doctor lists in full; the rest are counted. */
const DOCTOR_IMPORT_LINES = 5;

/**
 * `zhin doctor`'s check result (the `CheckResult` shape): warn per retired dependency and per
 * import of a deleted subpath or of a retired package no manifest declares; ok otherwise.
 */
export function retiredPackagesResult(root: string, limits: ProjectRetiredImportScanLimits = {}): { name: string; status: 'ok' | 'warn'; message: string; fix?: string } {
  const name = '已停更的 Zhin 包';
  let hits: ProjectRetiredDependency[];
  let imports: ProjectRetiredImport[];
  let scan: ProjectRetiredImportScan;
  try {
    hits = findProjectRetiredDependencies(root);
    const declared = new Set(hits.map(hit => hit.name));
    scan = scanProjectRetiredImports(root, limits);
    imports = scan.uses.filter(use => !use.retired || !declared.has(use.retired.name));
  } catch (error) {
    return { name, status: 'warn', message: `无法检查：${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
  const truncatedNote = scan.truncated ? `（${formatTruncatedScan(scan)}）` : '';
  if (hits.length === 0 && imports.length === 0) return { name, status: 'ok', message: `没有依赖已并入或停更的 @zhin.js 包，也没有 import 已删除的子路径${truncatedNote}` };
  const messages: string[] = [];
  const fixes: string[] = [];
  if (hits.length > 0) {
    messages.push(`${hits.map(formatRetiredDependency).join('；')}。这些包的最后版本仍依赖旧的 Zhin 包，会拖进第二份实例；pnpm.overrides 只能掩盖，删除依赖才能解决`);
    fixes.push(`${[...new Set(hits.map(hit => hit.manifest))].map(file => `改写 import 后从 ${file} 删除 ${hits.filter(hit => hit.manifest === file).map(hit => hit.name).join('、')}`).join('；')}，然后运行 pnpm install（zhin migrate 会列出要改的 import）`);
  }
  if (imports.length > 0) {
    const shown = imports.slice(0, DOCTOR_IMPORT_LINES).map(formatRetiredImport);
    const more = imports.length > DOCTOR_IMPORT_LINES ? `；另有 ${imports.length - DOCTOR_IMPORT_LINES} 处` : '';
    messages.push(`要改写的 import：${shown.join('；')}${more}`);
    if (hits.length === 0) fixes.push('按上面的提示改写 import（zhin migrate 会列出全部位置）');
  }
  if (scan.truncated) messages.push(formatTruncatedScan(scan));
  return { name, status: 'warn', message: messages.join('。'), fix: fixes.join('；') };
}
