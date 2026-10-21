/**
 * Static checks of a plugin directory: package.json, the `zhin` manifest, the runtime entry,
 * the `files` whitelist versus convention directories, and prepack/postpack scripts.
 * Mirrors scripts/check-plugin-spec.mjs for a single plugin outside the monorepo.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CONVENTION_ASSET_DIRECTORIES,
  CONVENTION_SOURCE_DIRECTORIES,
} from '../commands/new-plugin-manifest.js';
import { filesWhitelistIncludes } from './files-whitelist.js';

export interface PluginCheckProblems {
  errors: string[];
  warnings: string[];
}

const RUNTIME_JAVASCRIPT = /\.[cm]?js$/u;
const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts|cts)$/u;
const DECLARATION = /\.d\.[cm]?ts$/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const RUNTIME_ENTRIES_BUILDER = /runtime-entries/u;

/** Reads package.json; a missing or invalid file is reported as an error. */
export function readPluginManifest(pluginDirectory: string, problems: PluginCheckProblems): Record<string, unknown> | undefined {
  const manifestPath = path.join(pluginDirectory, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    problems.errors.push('缺少 package.json（请在插件目录中运行，或传入插件目录）');
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    problems.errors.push('package.json 不是 JSON 对象');
  } catch (error) {
    problems.errors.push(`package.json 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  return undefined;
}

/** Runtime-entry TypeScript the prepack step must turn into sibling JavaScript (package-relative, posix). */
export function listRuntimeEntrySources(pluginDirectory: string): string[] {
  const sources: string[] = [];
  for (const candidate of ['plugin.ts', 'plugin.tsx']) {
    if (fs.existsSync(path.join(pluginDirectory, candidate))) sources.push(candidate);
  }
  for (const directory of CONVENTION_SOURCE_DIRECTORIES) {
    for (const file of listFiles(path.join(pluginDirectory, directory))) {
      const isSource = TYPESCRIPT_SOURCE.test(file) && !DECLARATION.test(file) && !TEST_FILE.test(file);
      if (isSource) sources.push(`${directory}/${file}`);
    }
  }
  return sources;
}

/** Files of an asset convention directory such as `skills/` (package-relative, posix). */
export function listAssetFiles(pluginDirectory: string): string[] {
  const assets: string[] = [];
  for (const directory of CONVENTION_ASSET_DIRECTORIES) {
    for (const file of listFiles(path.join(pluginDirectory, directory))) {
      assets.push(`${directory}/${file}`);
    }
  }
  return assets;
}

/** JavaScript path the tarball should contain for a runtime-entry source. */
export function compiledRuntimeEntry(source: string): string {
  return source.replace(/\.(?:ts|tsx|mts|cts)$/u, '.js');
}

export function checkPluginSource(pluginDirectory: string, manifest: Record<string, unknown>): PluginCheckProblems {
  const problems: PluginCheckProblems = { errors: [], warnings: [] };

  if (typeof manifest.name !== 'string' || manifest.name === '') {
    problems.errors.push('package.json 缺少 name');
  }
  if (manifest.private === true) {
    problems.warnings.push('package.json 标记了 private: true，npm 不会发布此包');
  }

  const zhinManifest = manifest.zhin;
  const hasZhinManifest = Boolean(zhinManifest) && typeof zhinManifest === 'object' && !Array.isArray(zhinManifest);
  if (!hasZhinManifest) {
    problems.errors.push('package.json 缺少 zhin 清单（至少需要 zhin.type 与 zhin.entry）');
  }
  const zhinFields = hasZhinManifest ? zhinManifest as Record<string, unknown> : {};
  if (hasZhinManifest && zhinFields.type !== 'plugin') {
    problems.warnings.push(`zhin.type 为 ${JSON.stringify(zhinFields.type)}，Plugin Runtime 插件应为 "plugin"`);
  }

  const files = Array.isArray(manifest.files)
    ? manifest.files.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  if (!files) {
    problems.warnings.push('未声明 files 白名单：npm 会打包整个目录（源码、测试与配置），建议参照 zhin new 生成的 files');
  }

  checkRuntimeEntry(pluginDirectory, zhinFields.entry, hasZhinManifest, files, problems);
  checkConventionDirectories(pluginDirectory, files, problems);
  checkPackScripts(pluginDirectory, manifest, problems);

  if (manifest.main === undefined && manifest.exports === undefined) {
    problems.warnings.push('未声明 main / exports：其他包无法 import 此插件的库 API（运行时入口仍是 zhin.entry）');
  }
  if (!fs.existsSync(path.join(pluginDirectory, 'README.md'))) {
    problems.warnings.push('缺少 README.md');
  }
  const hasTests = listFiles(path.join(pluginDirectory, 'tests')).some((file) => TEST_FILE.test(file));
  if (!hasTests) {
    problems.warnings.push('未找到测试（tests/**/*.test.ts）');
  }
  return problems;
}

function checkRuntimeEntry(
  pluginDirectory: string,
  entry: unknown,
  hasZhinManifest: boolean,
  files: string[] | undefined,
  problems: PluginCheckProblems,
): void {
  if (!hasZhinManifest) return;
  if (typeof entry !== 'string' || entry === '') {
    problems.errors.push('zhin.entry 未声明（发布包应为编译后的 JavaScript，如 ./plugin.js）');
    return;
  }
  if (!RUNTIME_JAVASCRIPT.test(entry)) {
    problems.errors.push(`zhin.entry -> ${entry} 不是 JavaScript：npm 包里没有 TypeScript 运行时，请指向 prepack 生成的 .js`);
    return;
  }
  const entryPath = path.join(pluginDirectory, entry);
  const sourceCandidates = ['.ts', '.tsx', '.mts'].map((extension) => entryPath.replace(RUNTIME_JAVASCRIPT, extension));
  const entryExists = [entryPath, ...sourceCandidates].some((candidate) => fs.existsSync(candidate));
  if (!entryExists) {
    problems.errors.push(`zhin.entry -> ${entry} 既不存在，也没有同名 .ts 源文件`);
  }
  if (files && !filesWhitelistIncludes(files, entry)) {
    problems.errors.push(`zhin.entry -> ${entry} 不在 files 白名单中，发布后插件无法加载`);
  }
}

function checkConventionDirectories(
  pluginDirectory: string,
  files: string[] | undefined,
  problems: PluginCheckProblems,
): void {
  if (!files) return;
  const uncoveredDirectories = new Set<string>();
  for (const source of listRuntimeEntrySources(pluginDirectory)) {
    if (!source.includes('/')) continue;
    if (!filesWhitelistIncludes(files, compiledRuntimeEntry(source))) {
      uncoveredDirectories.add(source.split('/')[0]);
    }
  }
  for (const directory of uncoveredDirectories) {
    problems.errors.push(`约定目录 ${directory}/ 的编译产物（${directory}/**/*.js）不在 files 白名单中`);
  }
  const uncoveredAssets = new Set<string>();
  for (const asset of listAssetFiles(pluginDirectory)) {
    if (!filesWhitelistIncludes(files, asset)) uncoveredAssets.add(asset.split('/')[0]);
  }
  for (const directory of uncoveredAssets) {
    problems.errors.push(`约定目录 ${directory}/ 不在 files 白名单中`);
  }
  const hasSchema = fs.existsSync(path.join(pluginDirectory, 'schema.json'));
  if (hasSchema && !filesWhitelistIncludes(files, 'schema.json')) {
    problems.warnings.push('schema.json 存在但不在 files 白名单中，Console 将拿不到配置 schema');
  }
}

function checkPackScripts(pluginDirectory: string, manifest: Record<string, unknown>, problems: PluginCheckProblems): void {
  const needsGeneratedEntries = listRuntimeEntrySources(pluginDirectory).length > 0;
  if (!needsGeneratedEntries) return;
  const scripts = manifest.scripts && typeof manifest.scripts === 'object'
    ? manifest.scripts as Record<string, unknown>
    : {};
  const prepack = typeof scripts.prepack === 'string' ? scripts.prepack : '';
  const postpack = typeof scripts.postpack === 'string' ? scripts.postpack : '';
  if (!RUNTIME_ENTRIES_BUILDER.test(prepack)) {
    problems.warnings.push('prepack 没有生成运行时 JS 入口（zhin new 生成的插件使用 node scripts/build-runtime-entries.mjs）');
  }
  if (RUNTIME_ENTRIES_BUILDER.test(prepack) && !(RUNTIME_ENTRIES_BUILDER.test(postpack) && postpack.includes('--clean'))) {
    problems.warnings.push('postpack 没有清理生成的运行时 JS 入口（... build-runtime-entries.mjs --clean）');
  }
}

/** Files below a directory, package-relative to that directory (posix); empty when missing. */
export function listFiles(directory: string, prefix = ''): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}
