/**
 * `zhin dev link <插件目录>`：把一个独立插件项目接进 bot，改插件源码即可热重载。
 *
 * 运行时只为「本地」来源的插件建立文件监听：主配置 `plugins` 里以 `./` 开头的引用
 * （见 @zhin.js/runtime source-ownership）。按包名引用、`pnpm add <目录>`、tarball
 * 或把目录加进 pnpm workspace 都会走 node_modules，不会热重载；`pnpm add <目录>`
 * 还会把插件自己 node_modules 里的 @zhin.js/* 一起带进来，触发多实例错误。
 *
 * 所以这里只做三件可撤销的事：
 *   1. 在 bot 的 `plugins/<实例名>` 建一个指向插件目录的链接；
 *   2. 在主配置 `plugins` 写入 `<实例名>: ./plugins/<实例名>`（以及空的实例配置）；
 *   3. 插件自己 node_modules 里的 zhin.js / @zhin.js/*（开发和单测装的 devDependencies）
 *      改为指向 bot 解析到的那一份。插件代码按真实路径解析 import，不这样做就会和 bot
 *      各用一份，运行时报 `Multiple package locations for ...`。
 * 不改两边的 package.json / 锁文件，不执行 pnpm install。记录写在 `.zhin/dev-plugin-links.json`，
 * `zhin dev unlink <实例名>` 只撤销这里添加过、且之后没被改过的内容；在插件目录重新
 * `pnpm install` 也会恢复它自己的依赖（之后需要再 link 一次）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { readApplicationPluginDeclaration } from '@zhin.js/runtime';
import { DevLinkError, collectZhinInstances, isZhinPackage } from './dev-link.js';
import { findConfigFile } from './config-file.js';

export const PLUGIN_LINK_STATE = path.join('.zhin', 'dev-plugin-links.json');
const INSTANCE_KEY = /^[a-z0-9][a-z0-9_-]*$/iu;

/** 插件 node_modules 里被改指向 bot 那一份的 zhin 包；`original` 是原链接内容，`backup` 是移开的原目录。 */
export interface RedirectedPackage {
  readonly name: string;
  readonly to: string;
  readonly original?: string;
  readonly backup?: string;
}

export interface PluginLinkRecord {
  readonly instanceKey: string;
  readonly redirected?: readonly RedirectedPackage[];
  readonly target: string;
  readonly link: string;
  readonly addedDeclaration: boolean;
  readonly addedConfig: boolean;
  readonly linkedAt: string;
}

interface PluginLinkState { version: 1; links: Record<string, PluginLinkRecord> }

export interface DevLinkPluginOptions {
  readonly instanceKey?: string;
  readonly log?: (message: string) => void;
}

const fail = (message: string): never => { throw new DevLinkError(message); };

/** 目录里的 package.json 是否声明了 zhin 清单（`zhin` 字段；入口可以写在 `zhin.entry` 或 `exports["./zhin"]`）。 */
export function isZhinPluginDirectory(dir: string): boolean {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    return typeof manifest.zhin === 'object' && manifest.zhin !== null && !Array.isArray(manifest.zhin);
  } catch {
    return false;
  }
}

/** `@scope/zhin-plugin-foo` / `zhin-plugin-foo` / `plugin-foo` → `foo`。 */
export function defaultInstanceKey(packageName: string): string {
  const base = packageName.replace(/^@[^/]+\//u, '');
  return base.replace(/^zhin-plugin-/u, '').replace(/^plugin-/u, '') || base;
}

function readState(project: string): PluginLinkState {
  const file = path.join(project, PLUGIN_LINK_STATE);
  if (!fs.existsSync(file)) return { version: 1, links: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PluginLinkState;
}

function writeState(project: string, state: PluginLinkState): void {
  const file = path.join(project, PLUGIN_LINK_STATE);
  if (Object.keys(state.links).length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

function configDocument(project: string) {
  const file = findConfigFile(project);
  if (!file) fail('Missing configVersion: 2 configuration; run zhin setup');
  return createConfigDocument(path.join(project, file!));
}

function pluginZhinPackages(pluginDir: string): string[] {
  const own = path.join(pluginDir, 'node_modules');
  if (!fs.existsSync(own)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(own)) {
    if (entry === 'zhin.js') names.push(entry);
    if (entry === '@zhin.js') for (const sub of fs.readdirSync(path.join(own, entry))) names.push(`${entry}/${sub}`);
  }
  return names.filter(isZhinPackage).sort();
}

const BACKUP_DIR = '.zhin-dev-link-backup';

/**
 * 插件 node_modules 里与 bot 解析到不同位置的 zhin 包。
 * `redirectable`：bot 里恰好有一份，可以改指向；`unresolved`：bot 里没有或有多份，保持原样。
 */
export function findSharedZhinCopies(project: string, pluginDir: string, instances = collectZhinInstances(project)) {
  const redirectable: { name: string; to: string }[] = [];
  const unresolved: string[] = [];
  for (const name of pluginZhinPackages(pluginDir)) {
    const mine = path.join(pluginDir, 'node_modules', name);
    if (!fs.existsSync(path.join(mine, 'package.json'))) continue;
    const theirs = instances.get(name) ?? [];
    if (theirs.length === 0) continue; // bot 不提供：插件自用（如 @zhin.js/testing），不影响运行时
    if (theirs.length > 1) { unresolved.push(name); continue; }
    if (fs.realpathSync(mine) !== theirs[0]) redirectable.push({ name, to: theirs[0] });
  }
  return { redirectable, unresolved };
}

function redirectPackage(pluginDir: string, name: string, to: string): RedirectedPackage {
  const at = path.join(pluginDir, 'node_modules', name);
  const stat = fs.lstatSync(at);
  let original: string | undefined, backup: string | undefined;
  if (stat.isSymbolicLink()) {
    original = fs.readlinkSync(at);
    fs.rmSync(at);
  } else {
    backup = path.join(BACKUP_DIR, name.replace('/', '__'));
    const backupPath = path.join(pluginDir, 'node_modules', backup);
    if (fs.existsSync(backupPath)) fail(`${backupPath} 已存在，无法移开 ${at}；请检查后手动处理`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.renameSync(at, backupPath);
  }
  fs.symlinkSync(to, at, process.platform === 'win32' ? 'junction' : 'dir');
  return { name, to, ...(original === undefined ? {} : { original }), ...(backup === undefined ? {} : { backup }) };
}

function restorePackage(pluginDir: string, entry: RedirectedPackage, log: (message: string) => void): void {
  const at = path.join(pluginDir, 'node_modules', entry.name);
  const stat = fs.lstatSync(at, { throwIfNoEntry: false });
  if (stat && (!stat.isSymbolicLink() || path.resolve(path.dirname(at), fs.readlinkSync(at)) !== entry.to)) {
    log(`跳过 ${entry.name}：插件依赖已被重新安装或改动，保持现状`);
    return;
  }
  if (stat) fs.rmSync(at);
  if (entry.original !== undefined) fs.symlinkSync(entry.original, at, process.platform === 'win32' ? 'junction' : 'dir');
  else if (entry.backup) fs.renameSync(path.join(pluginDir, 'node_modules', entry.backup), at);
}

export async function devLinkPlugin(projectArg: string, pluginArg: string, options: DevLinkPluginOptions = {}): Promise<PluginLinkRecord> {
  const log = options.log ?? ((message: string) => console.log(message));
  const project = path.resolve(projectArg);
  const pluginDir = path.resolve(pluginArg);
  if (!fs.existsSync(path.join(project, 'package.json'))) fail(`未找到 ${path.join(project, 'package.json')}`);
  if (!isZhinPluginDirectory(pluginDir)) fail(`${pluginDir} 不是 zhin 插件：package.json 缺少 zhin 字段`);
  const realProject = fs.realpathSync(project), realPlugin = fs.realpathSync(pluginDir);
  if (realPlugin === realProject || realPlugin.startsWith(realProject + path.sep)) {
    fail('插件已在 bot 目录内，直接在主配置 plugins 里用 ./ 路径引用即可，无需 link');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')) as { name?: unknown };
  if (typeof manifest.name !== 'string' || !manifest.name) fail(`${pluginDir}/package.json 缺少 name`);
  const instanceKey = options.instanceKey ?? defaultInstanceKey(manifest.name as string);
  if (!INSTANCE_KEY.test(instanceKey)) fail(`实例名 ${instanceKey} 只能包含字母、数字、- 和 _；用 --as <实例名> 指定`);
  const document = configDocument(project);
  const reference = `./plugins/${instanceKey}`;
  const linkPath = path.join(project, 'plugins', instanceKey);

  const state = readState(project);
  const previous = state.links[instanceKey];
  if (previous && previous.target !== realPlugin) fail(`实例 ${instanceKey} 已链接到 ${previous.target}；先执行 zhin dev unlink ${instanceKey}`);

  let existingLink = false;
  const stat = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (stat) {
    if (!stat.isSymbolicLink() || fs.realpathSync(linkPath) !== realPlugin) {
      fail(`${linkPath} 已存在且不是指向 ${realPlugin} 的链接；换一个实例名（--as）或先移走它`);
    }
    existingLink = true;
  }

  const current = await document.read();
  readApplicationPluginDeclaration(current.document);
  const plugins = (current.document.plugins ?? {}) as Record<string, unknown>;
  if (Object.hasOwn(plugins, instanceKey) && plugins[instanceKey] !== reference) {
    fail(`主配置 plugins.${instanceKey} 已指向 ${String(plugins[instanceKey])}；换一个实例名（--as）或先移除它`);
  }
  const addDeclaration = !Object.hasOwn(plugins, instanceKey);
  const addConfig = !Object.hasOwn(current.document, instanceKey);

  if (!existingLink) {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    // Windows 上目录链接用 junction（不需要管理员权限），junction 只接受绝对路径。
    if (process.platform === 'win32') fs.symlinkSync(realPlugin, linkPath, 'junction');
    // 相对路径从链接所在目录的真实路径算起（如 macOS 上 /var → /private/var），否则会成为悬空链接。
    else fs.symlinkSync(path.relative(fs.realpathSync(path.dirname(linkPath)), realPlugin), linkPath, 'dir');
  }
  const patches: import('@zhin.js/plugin-runtime').ConfigPatch[] = [];
  if (addDeclaration) patches.push({ op: 'set', path: ['plugins', instanceKey], value: reference });
  if (addConfig) patches.push({ op: 'set', path: [instanceKey], value: {} });
  try {
    if (patches.length) await (await document.prepare(current, patches)).commit();
  } catch (error) {
    if (!existingLink) fs.rmSync(linkPath, { force: true });
    throw error;
  }

  const record: PluginLinkRecord = {
    instanceKey,
    target: realPlugin,
    link: path.relative(project, linkPath),
    addedDeclaration: (previous?.addedDeclaration ?? false) || addDeclaration,
    addedConfig: (previous?.addedConfig ?? false) || addConfig,
    linkedAt: new Date().toISOString(),
  };
  const { redirectable, unresolved } = findSharedZhinCopies(project, realPlugin);
  const redirected = [...(previous?.redirected ?? [])];
  for (const { name, to } of redirectable) {
    const earlier = redirected.findIndex((entry) => entry.name === name);
    const next = redirectPackage(realPlugin, name, to);
    // 重复 link 时保留最初的原始链接，unlink 才能还原到 link 之前。
    if (earlier === -1) redirected.push(next);
    else redirected[earlier] = { ...redirected[earlier], to };
  }
  const finalRecord: PluginLinkRecord = { ...record, ...(redirected.length ? { redirected } : {}) };
  state.links[instanceKey] = finalRecord;
  writeState(project, state);

  log(`已链接 ${manifest.name as string} → ${record.link}，主配置 plugins.${instanceKey}: ${reference}`);
  if (redirectable.length) log(`插件 node_modules 里的 ${redirectable.map((entry) => entry.name).join(', ')} 已改为使用 bot 的同一份`);
  if (unresolved.length) log(`警告：bot 里 ${unresolved.join(', ')} 有多份，插件保持自己的版本；先在 bot 执行 zhin doctor 排查`);
  log(`启动开发模式（如 pnpm dev）后，修改 ${realPlugin} 下的文件会热重载。撤销：zhin dev unlink ${instanceKey}`);
  return finalRecord;
}

export function linkedPluginKeys(project: string): string[] {
  return Object.keys(readState(path.resolve(project)).links).sort();
}

export async function devUnlinkPlugin(projectArg: string, instanceKey: string, options: { log?: (message: string) => void } = {}): Promise<boolean> {
  const log = options.log ?? ((message: string) => console.log(message));
  const project = path.resolve(projectArg);
  const state = readState(project);
  const record = state.links[instanceKey];
  if (!record) fail(`没有通过 zhin dev link 链接的插件实例 ${instanceKey}`);
  const linkPath = path.join(project, record!.link);
  const stat = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) fs.rmSync(linkPath, { force: true });
  else if (stat) log(`警告：${linkPath} 已不是链接，保留不动`);

  const document = configDocument(project);
  const current = await document.read();
  const patches: import('@zhin.js/plugin-runtime').ConfigPatch[] = [];
  const plugins = (current.document.plugins ?? {}) as Record<string, unknown>;
  if (record!.addedDeclaration && plugins[instanceKey] === `./plugins/${instanceKey}`) patches.push({ op: 'remove', path: ['plugins', instanceKey] });
  const config = current.document[instanceKey];
  if (record!.addedConfig && config && typeof config === 'object' && Object.keys(config).length === 0) patches.push({ op: 'remove', path: [instanceKey] });
  else if (record!.addedConfig && config !== undefined) log(`保留已修改的实例配置 ${instanceKey}`);
  if (patches.length) await (await document.prepare(current, patches)).commit();

  if (fs.existsSync(record!.target)) for (const entry of record!.redirected ?? []) restorePackage(record!.target, entry, log);

  delete state.links[instanceKey];
  writeState(project, state);
  log(`已撤销插件链接 ${instanceKey}`);
  return true;
}
