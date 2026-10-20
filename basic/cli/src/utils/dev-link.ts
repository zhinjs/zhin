/**
 * `zhin dev link` / `zhin dev unlink`：让外部插件项目基于本地 zhin 源码联调。
 *
 * 为什么用「tarball overrides」而不是 `link:`：
 * zhin 要求一个 generation 内同名包只有一个物理位置（见 docs/authoring/local-dev.md）。
 * 多实例的根因是只替换了部分包，间接依赖（@zhin.js/runtime、@zhin.js/command 等）仍从
 * npm 解析；而 `link:` 指向源码目录时，该目录内的 `workspace:*` 依赖又会解析回源码仓库，
 * 同样产生两份。所以这里：
 *   1. 计算项目直接依赖的 zhin 包在本地 checkout 中的 **完整 workspace 依赖闭包**；
 *   2. 对闭包内每个包 `pnpm pack`（pnpm 会把 `workspace:` 改写成真实版本）；
 *   3. 把闭包内**每个**包都写入项目 `pnpm.overrides` 指向各自 tarball。
 * overrides 对整个依赖树生效（含传递依赖），因此每个包名只会解析到一份 tarball 内容，
 * 不依赖 checkout 里的 node_modules，也不会把 workspace: 带回项目。
 *
 * 状态格式与 `scripts/zhin-local.mjs`（pnpm zhin:local）一致，两者可互相 unlink。
 * 只写目标项目内的 package.json、pnpm-lock.yaml、node_modules 与 .zhin-local/。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readApplicationPluginDeclaration } from '@zhin.js/runtime';
import { readSourcePluginOrder } from '@zhin.js/config-file';
import { findConfigFile } from './config-file.js';

export const STATE_DIR = '.zhin-local';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
const CLOSURE_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

type Manifest = Record<string, any>;
export interface WorkspaceEntry { name: string; dir: string; manifest: Manifest }
export interface GitignoreRecord { existed: boolean; added: boolean; original?: string; linked?: string }
export interface LinkState {
  version: 1;
  repo: string;
  roots: string[];
  packages: string[];
  hadLockfile: boolean;
  linkedSha: string;
  gitignore?: GitignoreRecord;
  linkedAt: string;
}

export interface DevLinkOptions {
  /** zhin 源码 checkout 根目录 */
  repo: string;
  workspace?: (repo: string) => WorkspaceEntry[];
  build?: (names: string[], repo: string) => void;
  pack?: (entry: WorkspaceEntry, dest: string) => string;
  install?: (project: string) => void;
  log?: (message: string) => void;
  noInstall?: boolean;
  force?: boolean;
}

export class DevLinkError extends Error {}
const fail = (message: string): never => { throw new DevLinkError(message); };

export const isZhinPackage = (name: string): boolean => name === 'zhin.js' || name.startsWith('@zhin.js/');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** 项目直接依赖（含主配置 plugins 声明）中的 zhin 包，按是否存在于 checkout 分类。 */
export function detectZhinPackages(manifest: Manifest, workspaceNames: ReadonlySet<string>, document?: Readonly<Record<string, unknown>>) {
  if (manifest.zhin?.plugins?.length) throw new DevLinkError('Legacy zhin.plugins declarations; run zhin migrate instances');
  const found = new Set<string>();
  const undeclared: string[] = [];
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) if (isZhinPackage(name)) found.add(name);
  }
  for (const entry of document ? readApplicationPluginDeclaration(document).instances : []) {
    const name = entry.package;
    if (typeof name === 'string' && isZhinPackage(name) && !found.has(name)) { found.add(name); undeclared.push(name); }
  }
  const all = [...found].sort();
  return {
    known: all.filter((n) => workspaceNames.has(n)),
    unknown: all.filter((n) => !workspaceNames.has(n)),
    undeclared: undeclared.filter((n) => workspaceNames.has(n)).sort(),
  };
}

/** 从 roots 出发的 workspace 依赖闭包，依赖在前、使用方在后。 */
export function resolveWorkspaceClosure(packages: readonly WorkspaceEntry[], rootNames: readonly string[]): WorkspaceEntry[] {
  const byName = new Map(packages.map((e) => [e.name, e]));
  const visited = new Set<string>();
  const result: WorkspaceEntry[] = [];
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name); // 先标记：环依赖不会死循环
    const entry = byName.get(name);
    if (!entry) throw new DevLinkError(`Workspace package not found: ${name}`);
    const deps = new Set<string>();
    for (const field of CLOSURE_FIELDS) {
      for (const [dep, spec] of Object.entries<unknown>(entry.manifest[field] ?? {})) {
        if (typeof spec === 'string' && spec.startsWith('workspace:') && byName.has(dep)) deps.add(dep);
      }
    }
    for (const dep of [...deps].sort()) visit(dep);
    result.push(entry);
  };
  for (const root of rootNames) visit(root);
  return result;
}

/** 纯函数：给 manifest 写入闭包内每个包的 tarball override，保留已有 overrides。 */
export function applyLinkOverrides(manifest: Manifest, closure: readonly { name: string }[], tarballs: ReadonlyMap<string, string>): Manifest {
  const added: Record<string, string> = {};
  for (const { name } of closure) {
    const tarball = tarballs.get(name);
    if (!tarball) throw new DevLinkError(`Packed artifact is missing: ${name}`);
    added[name] = `file:${tarball}`;
  }
  const pnpm = manifest.pnpm && typeof manifest.pnpm === 'object' ? manifest.pnpm : {};
  const overrides = pnpm.overrides && typeof pnpm.overrides === 'object' ? pnpm.overrides : {};
  return { ...manifest, pnpm: { ...pnpm, overrides: { ...overrides, ...added } } };
}

function expandBrace(glob: string): string[] {
  const match = /\{([^}]+)\}/u.exec(glob);
  if (!match) return [glob];
  return match[1].split(',').flatMap((alt) => expandBrace(glob.slice(0, match.index) + alt.trim() + glob.slice(match.index + match[0].length)));
}

/** 读取 checkout 的 pnpm-workspace.yaml 并展开 workspace 包。 */
export function readWorkspaceEntries(repo: string): WorkspaceEntry[] {
  const file = path.join(repo, 'pnpm-workspace.yaml');
  if (!fs.existsSync(file)) fail(`${repo} 不是 zhin 源码仓库（缺少 pnpm-workspace.yaml）`);
  const globs: string[] = (parseYaml(fs.readFileSync(file, 'utf8')) as any)?.packages ?? [];
  const dirs = new Set<string>();
  for (const glob of globs) {
    for (const pattern of expandBrace(glob)) {
      if (pattern.startsWith('!')) continue;
      const star = pattern.indexOf('*');
      if (star === -1) {
        if (fs.existsSync(path.join(repo, pattern, 'package.json'))) dirs.add(pattern);
        continue;
      }
      const parent = pattern.slice(0, star).replace(/\/$/u, '');
      const abs = path.join(repo, parent);
      if (!fs.existsSync(abs)) continue;
      for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
        if (d.isDirectory() && fs.existsSync(path.join(abs, d.name, 'package.json'))) dirs.add(`${parent}/${d.name}`);
      }
    }
  }
  const entries: WorkspaceEntry[] = [];
  for (const dir of dirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, dir, 'package.json'), 'utf8'));
    if (manifest.name) entries.push({ name: manifest.name, dir: path.join(repo, dir), manifest });
  }
  return entries;
}

function readState(project: string): LinkState | undefined {
  const file = path.join(project, STATE_DIR, 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

function assertProject(project: string, repo: string): void {
  if (!fs.existsSync(path.join(project, 'package.json'))) fail(`未找到 ${path.join(project, 'package.json')}`);
  if (!fs.existsSync(repo)) fail(`zhin 源码路径不存在：${repo}`);
  const real = fs.realpathSync(project), realRepo = fs.realpathSync(repo);
  if (real === realRepo || real.startsWith(realRepo + path.sep)) fail('目标项目位于 zhin 仓库内，请直接使用 workspace:* 依赖，无需 link');
}

function assertGitClean(project: string, files: string[]): void {
  let out: string;
  try { out = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return; } // 非 git 项目：无法判断，依赖备份保证可恢复
  if (out.trim()) fail(`以下文件有未提交的改动，请先提交或撤销后再执行：\n${out}`);
}

const defaults = {
  workspace: readWorkspaceEntries,
  build: (names: string[], repo: string): void => {
    execFileSync('pnpm', [...names.flatMap((n) => ['--filter', `${n}...`]), 'build'], { cwd: repo, stdio: 'inherit' });
  },
  pack: (entry: WorkspaceEntry, dest: string): string => {
    const before = new Set(fs.readdirSync(dest));
    execFileSync('pnpm', ['pack', '--pack-destination', dest], { cwd: entry.dir, stdio: ['ignore', 'ignore', 'inherit'] });
    const files = fs.readdirSync(dest).filter((f) => f.endsWith('.tgz') && !before.has(f));
    if (files.length !== 1) fail(`打包 ${entry.name} 期望产出 1 个 tarball，实际 ${files.length}`);
    return files[0];
  },
  install: (project: string): void => { execFileSync('pnpm', ['install'], { cwd: project, stdio: 'inherit' }); },
  log: (m: string): void => console.log(m),
};

/** 幂等地把 .zhin-local/ 加入目标项目的 .gitignore。 */
export function ensureGitignore(project: string, log: (m: string) => void = () => {}): GitignoreRecord {
  const file = path.join(project, '.gitignore');
  const existed = fs.existsSync(file);
  const text = existed ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if ([STATE_DIR, `${STATE_DIR}/`, `/${STATE_DIR}`, `/${STATE_DIR}/`].some((v) => lines.includes(v))) return { existed, added: false };
  const next = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${STATE_DIR}/\n`;
  fs.writeFileSync(file, next);
  log(`已将 ${STATE_DIR}/ 加入 ${file}`);
  return { existed, added: true, original: text, linked: next };
}

/** 撤销 ensureGitignore：未被改动则原样恢复，否则只删除添加的那一行。 */
export function restoreGitignore(project: string, record: GitignoreRecord | undefined, log: (m: string) => void = () => {}): void {
  if (!record?.added) return;
  const file = path.join(project, '.gitignore');
  if (!fs.existsSync(file)) return;
  const current = fs.readFileSync(file, 'utf8');
  let next: string;
  if (current === record.linked) next = record.original ?? '';
  else {
    const lines = current.split('\n');
    const at = lines.lastIndexOf(`${STATE_DIR}/`);
    if (at === -1) return;
    lines.splice(at, 1);
    next = lines.join('\n');
  }
  if (!record.existed && next.trim() === '') fs.rmSync(file);
  else fs.writeFileSync(file, next);
  log(`已从 ${file} 移除 ${STATE_DIR}/`);
}

/** 相对 link 时被删除/新增的行，用于 --force 提示。 */
export function lineChanges(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n'), b = after.split('\n');
  return { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}

export function devLink(projectArg: string, options: DevLinkOptions): LinkState {
  const o = { ...defaults, ...options };
  const repo = path.resolve(o.repo);
  const project = path.resolve(projectArg);
  assertProject(project, repo);
  const pkgFile = path.join(project, 'package.json'), lockFile = path.join(project, 'pnpm-lock.yaml');
  const stateDir = path.join(project, STATE_DIR), backupDir = path.join(stateDir, 'backup'), packDir = path.join(stateDir, 'packs');
  let state = readState(project);
  const current = fs.readFileSync(pkgFile, 'utf8');
  if (state) {
    if (sha(current) !== state.linkedSha) fail(`package.json 在 link 之后被修改过，无法安全刷新。请先恢复改动或手动处理 ${STATE_DIR}/backup`);
    o.log('已处于 link 状态，重新构建并刷新 tarball');
  } else {
    if (fs.existsSync(stateDir)) fail(`${STATE_DIR}/ 已存在但缺少 state.json，状态未知，请检查后手动删除`);
    assertGitClean(project, ['package.json', 'pnpm-lock.yaml']);
  }
  const original: Manifest = state ? JSON.parse(fs.readFileSync(path.join(backupDir, 'package.json'), 'utf8')) : JSON.parse(current);
  const workspace = o.workspace(repo);
  const configFile = findConfigFile(project);
  if (!configFile) throw new DevLinkError('Missing configVersion: 2 configuration; run zhin setup');
  const configText = fs.readFileSync(path.join(project, configFile), 'utf8');
  readSourcePluginOrder(configText, configFile.endsWith('.json') ? 'JSON' : 'YAML');
  const config = configFile.endsWith('.json') ? JSON.parse(configText) : parseYaml(configText);
  const { known, unknown, undeclared } = detectZhinPackages(original, new Set(workspace.map((e) => e.name)), config);
  if (known.length === 0) fail('项目未直接依赖 zhin.js 或任何 @zhin.js/* 包');
  if (undeclared.length) o.log(`警告：以下包在主配置 plugins 中声明但未写入依赖，已一并使用本地版本：${undeclared.join(', ')}`);
  if (unknown.length) o.log(`警告：以下包不在本仓库中，保持 npm 版本：${unknown.join(', ')}`);
  const preset = Object.keys(original.pnpm?.overrides ?? {}).filter(isZhinPackage);
  if (preset.length) fail(`package.json 已有 zhin 相关 pnpm.overrides（${preset.join(', ')}），请先移除再 link`);

  const closure = resolveWorkspaceClosure(workspace, known);
  o.log(`构建并打包 ${closure.length} 个包…`);
  o.build(known, repo);
  if (!state) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'package.json'), current);
    if (fs.existsSync(lockFile)) fs.copyFileSync(lockFile, path.join(backupDir, 'pnpm-lock.yaml'));
  }
  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  const tarballs = new Map(closure.map((e) => [e.name, `./${STATE_DIR}/packs/${o.pack(e, packDir)}`]));
  const next = applyLinkOverrides(original, closure, tarballs);
  const indent = /^\{\n(\s+)/.exec(current)?.[1] ?? '  ';
  const text = JSON.stringify(next, null, indent) + (current.endsWith('\n') ? '\n' : '');
  fs.writeFileSync(pkgFile, text);
  fs.writeFileSync(path.join(stateDir, 'linked-package.json'), text);
  const gitignore = ensureGitignore(project, o.log);
  state = {
    version: 1,
    repo,
    roots: known,
    packages: closure.map((e) => e.name),
    hadLockfile: state ? state.hadLockfile : fs.existsSync(path.join(backupDir, 'pnpm-lock.yaml')),
    linkedSha: sha(text),
    gitignore: state?.gitignore?.added ? state.gitignore : gitignore,
    linkedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  if (!o.noInstall) o.install(project);
  o.log(`已 link：${known.join(', ')}（共 ${closure.length} 个 tarball）。恢复：zhin dev unlink`);
  return state;
}

export function devUnlink(projectArg: string, options: Partial<DevLinkOptions> = {}): boolean {
  const o = { ...defaults, ...options };
  const project = path.resolve(projectArg);
  if (!fs.existsSync(path.join(project, 'package.json'))) fail(`未找到 ${path.join(project, 'package.json')}`);
  const state = readState(project);
  const stateDir = path.join(project, STATE_DIR), backupDir = path.join(stateDir, 'backup');
  if (!state) {
    if (fs.existsSync(stateDir)) fail(`${STATE_DIR}/ 已存在但缺少 state.json，状态未知，请检查后手动处理`);
    o.log('未处于 link 状态，无需恢复');
    return false;
  }
  const pkgFile = path.join(project, 'package.json'), lockFile = path.join(project, 'pnpm-lock.yaml');
  const current = fs.readFileSync(pkgFile, 'utf8');
  if (sha(current) !== state.linkedSha) {
    if (!o.force) fail(`package.json 在 link 之后被修改过，拒绝覆盖。原始文件在 ${STATE_DIR}/backup/package.json；确认丢弃这些改动请加 --force`);
    const linkedFile = path.join(stateDir, 'linked-package.json');
    const { removed, added } = fs.existsSync(linkedFile)
      ? lineChanges(fs.readFileSync(linkedFile, 'utf8'), current)
      : { removed: [], added: current.split('\n') };
    o.log(`警告（--force）：将丢弃 link 之后对 package.json 的手动改动：\n${[...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n')}`);
  }
  if (!fs.existsSync(path.join(backupDir, 'package.json'))) fail(`备份缺失：${STATE_DIR}/backup/package.json`);
  fs.copyFileSync(path.join(backupDir, 'package.json'), pkgFile);
  if (state.hadLockfile) fs.copyFileSync(path.join(backupDir, 'pnpm-lock.yaml'), lockFile);
  else fs.rmSync(lockFile, { force: true });
  restoreGitignore(project, state.gitignore, o.log);
  fs.rmSync(stateDir, { recursive: true, force: true });
  if (!o.noInstall) o.install(project);
  o.log('已恢复原始 package.json 与 pnpm-lock.yaml');
  return true;
}

/**
 * 在项目依赖树中查找「同名 zhin 包解析到多个物理位置」的情况。
 *
 * 模拟 Node 解析：从项目顶层 node_modules 的每个包出发，沿 realpath 读取其
 * dependencies/peer/optional，再逐级向上在祖先 node_modules 里查找，收集可达的 zhin 包
 * realpath。pnpm `.pnpm/` 里不可达的历史残留目录不会误报；指向别处的 `link:`/file: 副本会被发现。
 * 返回 name → 不同 realpath（仅含 >=2 个的包）。
 */
export function findDuplicateZhinInstances(projectDir: string): Map<string, string[]> {
  const duplicates = new Map<string, string[]>();
  for (const [name, dirs] of collectZhinInstances(projectDir)) {
    if (dirs.length > 1) duplicates.set(name, dirs);
  }
  return duplicates;
}

/** 项目依赖树中可达的每个 zhin 包 → 它解析到的物理位置（realpath，已排序）。 */
export function collectZhinInstances(projectDir: string): Map<string, string[]> {
  const root = path.join(projectDir, 'node_modules');
  if (!fs.existsSync(root)) return new Map();
  const found = new Map<string, Set<string>>();
  const seen = new Set<string>();

  const resolveFrom = (fromDir: string, name: string): string | undefined => {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
      if (path.dirname(dir) === dir) return undefined;
    }
  };
  const visit = (realDir: string): void => {
    if (seen.has(realDir)) return;
    seen.add(realDir);
    let manifest: Manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(realDir, 'package.json'), 'utf8')); } catch { return; }
    if (typeof manifest.name === 'string' && isZhinPackage(manifest.name)) {
      if (!found.has(manifest.name)) found.set(manifest.name, new Set());
      found.get(manifest.name)!.add(realDir);
    }
    for (const field of CLOSURE_FIELDS) {
      for (const dep of Object.keys(manifest[field] ?? {})) {
        const resolved = resolveFrom(realDir, dep);
        if (resolved) visit(resolved);
      }
    }
  };

  const top: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(root, entry.name))) top.push(`${entry.name}/${sub}`);
    } else top.push(entry.name);
  }
  for (const name of top) {
    const dir = path.join(root, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) visit(fs.realpathSync(dir));
  }
  const instances = new Map<string, string[]>();
  for (const [name, dirs] of [...found].sort(([a], [b]) => a.localeCompare(b))) instances.set(name, [...dirs].sort());
  return instances;
}
