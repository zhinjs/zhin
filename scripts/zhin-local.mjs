#!/usr/bin/env node
/**
 * 外部项目一键切换到本地 zhin 源码：
 *   pnpm zhin:local link <project>    构建 + 打包闭包 → 写 tarball overrides → pnpm install
 *   pnpm zhin:local unlink <project>  原样恢复 package.json / pnpm-lock.yaml → pnpm install
 *
 * 只写目标项目内的 package.json、pnpm-lock.yaml、node_modules 与 .zhin-local/。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';
import { resolveWorkspacePackClosure, withWorkspaceTarballOverrides } from './workspace-pack-closure.mjs';

export const STATE_DIR = '.zhin-local';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const isZhinPackage = (name) => name === 'zhin.js' || name.startsWith('@zhin.js/');
const sha = (text) => createHash('sha256').update(text).digest('hex');

/** 项目直接依赖中的 zhin 包，分为本仓库存在的与未知的。 */
export function detectZhinPackages(manifest, workspaceNames) {
  const found = new Set();
  const undeclared = [];
  for (const field of DEP_FIELDS) for (const name of Object.keys(manifest[field] ?? {})) if (isZhinPackage(name)) found.add(name);
  for (const entry of manifest.zhin?.plugins ?? []) {
    const name = typeof entry === 'string' ? entry : entry?.package;
    if (typeof name === 'string' && isZhinPackage(name) && !found.has(name)) { found.add(name); undeclared.push(name); }
  }
  const all = [...found].sort();
  return { known: all.filter((n) => workspaceNames.has(n)), unknown: all.filter((n) => !workspaceNames.has(n)), undeclared: undeclared.filter((n) => workspaceNames.has(n)).sort() };
}

function readState(project) {
  const file = path.join(project, STATE_DIR, 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

function fail(message) { const e = new Error(message); e.userFacing = true; throw e; }

function assertProject(project, repo) {
  if (!fs.existsSync(path.join(project, 'package.json'))) fail(`未找到 ${path.join(project, 'package.json')}`);
  const real = fs.realpathSync(project), realRepo = fs.realpathSync(repo);
  if (real === realRepo || real.startsWith(realRepo + path.sep)) fail('目标项目位于 zhin 仓库内，请直接使用 workspace:* 依赖，无需 link');
}

function assertGitClean(project, files) {
  let out;
  try { out = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return; } // 非 git 项目：无法判断，依赖备份保证可恢复
  if (out.trim()) fail(`以下文件有未提交的改动，请先提交或撤销后再执行：\n${out}`);
}

const defaults = {
  repo: repoRoot,
  workspace: () => [...readWorkspaceGraph().values()].map((e) => ({ name: e.name, dir: path.join(repoRoot, e.dir), manifest: JSON.parse(fs.readFileSync(path.join(repoRoot, e.dir, 'package.json'), 'utf8')) })),
  build: (names, repo) => execFileSync('pnpm', [...names.flatMap((n) => ['--filter', `${n}...`]), 'build'], { cwd: repo, stdio: 'inherit' }),
  pack: (entry, dest) => {
    const before = new Set(fs.readdirSync(dest));
    execFileSync('pnpm', ['pack', '--pack-destination', dest], { cwd: entry.dir, stdio: ['ignore', 'ignore', 'inherit'] });
    const files = fs.readdirSync(dest).filter((f) => f.endsWith('.tgz') && !before.has(f));
    if (files.length !== 1) fail(`打包 ${entry.name} 期望产出 1 个 tarball，实际 ${files.length}`);
    return files[0];
  },
  install: (project) => execFileSync('pnpm', ['install'], { cwd: project, stdio: 'inherit' }),
  log: (m) => console.log(m),
};

/** 幂等地把 .zhin-local/ 加入目标项目的 .gitignore。 */
export function ensureGitignore(project, log = () => {}) {
  const file = path.join(project, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if ([STATE_DIR, `${STATE_DIR}/`, `/${STATE_DIR}`, `/${STATE_DIR}/`].some((v) => lines.includes(v))) return false;
  fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${STATE_DIR}/\n`);
  log(`已将 ${STATE_DIR}/ 加入 ${file}`);
  return true;
}

/** 返回相对 link 时内容被删除/新增的行，用于 --force 提示。 */
export function lineChanges(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  return { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}

export function link(projectArg, opts = {}) {
  const o = { ...defaults, ...opts };
  const project = path.resolve(projectArg);
  assertProject(project, o.repo);
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
  const original = state ? JSON.parse(fs.readFileSync(path.join(backupDir, 'package.json'), 'utf8')) : JSON.parse(current);
  const workspace = o.workspace();
  const { known, unknown, undeclared } = detectZhinPackages(original, new Set(workspace.map((e) => e.name)));
  if (known.length === 0) fail('项目未直接依赖 zhin.js 或任何 @zhin.js/* 包');
  if (undeclared.length) o.log(`警告：以下包在 zhin.plugins 中声明但未写入依赖，已一并使用本地版本：${undeclared.join(', ')}`);
  if (unknown.length) o.log(`警告：以下包不在本仓库中，保持 npm 版本：${unknown.join(', ')}`);
  const preset = Object.keys(original.pnpm?.overrides ?? {}).filter(isZhinPackage);
  if (preset.length) fail(`package.json 已有 zhin 相关 pnpm.overrides（${preset.join(', ')}），请先移除再 link`);

  const closure = resolveWorkspacePackClosure(workspace, known);
  o.log(`构建并打包 ${closure.length} 个包…`);
  o.build(known, o.repo);
  if (!state) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'package.json'), current);
    if (fs.existsSync(lockFile)) fs.copyFileSync(lockFile, path.join(backupDir, 'pnpm-lock.yaml'));
  }
  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  const packed = new Map(closure.map((e) => [e.name, { tarball: `./${STATE_DIR}/packs/${o.pack(e, packDir)}` }]));
  const next = withWorkspaceTarballOverrides(original, closure, packed);
  const indent = /^\{\n(\s+)/.exec(current)?.[1] ?? '  ';
  const text = JSON.stringify(next, null, indent) + (current.endsWith('\n') ? '\n' : '');
  fs.writeFileSync(pkgFile, text);
  state = { version: 1, repo: o.repo, roots: known, packages: closure.map((e) => e.name), hadLockfile: state ? state.hadLockfile : fs.existsSync(path.join(backupDir, 'pnpm-lock.yaml')), linkedSha: sha(text), linkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(stateDir, 'linked-package.json'), text);
  ensureGitignore(project, o.log);
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  if (!o.noInstall) o.install(project);
  o.log(`已 link：${known.join(', ')}（共 ${closure.length} 个 tarball）。恢复：pnpm zhin:local unlink ${projectArg}`);
  return state;
}

export function unlink(projectArg, opts = {}) {
  const o = { ...defaults, ...opts };
  const project = path.resolve(projectArg);
  assertProject(project, o.repo);
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
    const { removed, added } = fs.existsSync(linkedFile) ? lineChanges(fs.readFileSync(linkedFile, 'utf8'), current) : { removed: [], added: current.split('\n') };
    o.log(`警告（--force）：将丢弃 link 之后对 package.json 的手动改动：\n${[...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n')}`);
  }
  if (!fs.existsSync(path.join(backupDir, 'package.json'))) fail(`备份缺失：${STATE_DIR}/backup/package.json`);
  fs.copyFileSync(path.join(backupDir, 'package.json'), pkgFile);
  if (state.hadLockfile) fs.copyFileSync(path.join(backupDir, 'pnpm-lock.yaml'), lockFile);
  else fs.rmSync(lockFile, { force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  if (!o.noInstall) o.install(project);
  o.log('已恢复原始 package.json 与 pnpm-lock.yaml');
  return true;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, project, ...rest] = process.argv.slice(2);
  const noInstall = rest.includes('--no-install');
  const force = rest.includes('--force');
  try {
    if (!project || !['link', 'unlink'].includes(command) || rest.some((a) => !['--no-install', '--force'].includes(a)) || (force && command !== 'unlink')) fail('用法：pnpm zhin:local link <项目路径> [--no-install] | unlink <项目路径> [--force] [--no-install]');
    // pnpm 脚本的 cwd 是仓库根目录；相对路径按调用者所在目录解析
    (command === 'link' ? link : unlink)(path.resolve(process.env.INIT_CWD ?? process.cwd(), project), { noInstall, force });
  } catch (error) {
    console.error(error.userFacing ? `zhin:local：${error.message}` : error);
    process.exitCode = 1;
  }
}
